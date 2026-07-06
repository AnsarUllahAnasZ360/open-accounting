import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Role = "owner" | "accountant" | "hr";

/**
 * A USD entity with the payroll chart (5000 expense, 2200 payable) and one
 * member per role (owner / accountant / hr) so the permission split (Owner +
 * Accountant manage, HR view-only) can be exercised end to end.
 */
async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "WS",
      slug: "ws",
      createdAt: now,
      updatedAt: now,
    });
    const makeUser = async (role: Role) => {
      const userId = await ctx.db.insert("users", { email: `${role}@ex.com`, name: role });
      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId,
        role,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return userId;
    };
    const owner = await makeUser("owner");
    const accountant = await makeUser("accountant");
    const hr = await makeUser("hr");
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme",
      slug: "acme",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    const account = (number: string, name: string, type: "asset" | "liability" | "expense") =>
      ctx.db.insert("ledgerAccounts", {
        entityId,
        number,
        name,
        type,
        subtype: type,
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    const expenseId = await account("5000", "Payroll", "expense");
    const payableId = await account("2200", "Payroll Payable", "liability");
    return { workspaceId, owner, accountant, hr, entityId, expenseId, payableId };
  });
}

function authAs(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({ subject: `${userId}|s`, tokenIdentifier: `test|${userId}`, issuer: "test" });
}

async function entryLines(t: TestConvex<typeof schema>, entryId: string) {
  return await t.run(async (ctx) =>
    ctx.db.query("journalLines").withIndex("by_entry", (q) => q.eq("entryId", entryId as never)).collect(),
  );
}

describe("payroll bonus is ledger-neutral", () => {
  it("a one-time bonus flows into the posted expense but never the base salary", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authAs(t, ids.owner);

    const { employeeId } = await owner.mutation(api.employees.createEmployee, {
      entityId: ids.entityId,
      name: "Ahmed Ali",
      country: "Pakistan",
      currency: "USD",
      monthlySalaryMinor: 500_000,
    });
    const { runId } = await owner.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });

    const draft = (await owner.query(api.payroll.runDetail, { runId }))!;
    const line = draft.lines[0];
    await owner.mutation(api.payroll.updateRunLine, { lineId: line.id as Id<"payrollRunLines">, bonusMinor: 100_000 });

    const afterBonus = (await owner.query(api.payroll.runDetail, { runId }))!;
    expect(afterBonus.lines[0].bonusMinor).toBe(100_000);
    expect(afterBonus.lines[0].baseSalaryMinor).toBe(500_000);
    expect(afterBonus.lines[0].finalLocalMinor).toBe(600_000);

    const approved = await owner.mutation(api.payroll.approveRun, { runId });
    expect(approved.baseTotalMinor).toBe(600_000);
    const lines = await entryLines(t, approved.entryId);
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(credit); // balanced
    expect(lines.find((l) => l.accountId === ids.expenseId)?.debitMinor).toBe(600_000);

    // The employee's monthly salary is untouched by the run bonus.
    const employee = (await owner.query(api.employees.getEmployee, { employeeId }))!;
    expect(employee.monthlySalaryMinor).toBe(500_000);
  });

  it("a deduction subtracts from the line total and posts the reduced expense", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authAs(t, ids.owner);

    await owner.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Sara Ahmed", country: "PK", currency: "USD", monthlySalaryMinor: 500_000,
    });
    const { runId } = await owner.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    const draft = (await owner.query(api.payroll.runDetail, { runId }))!;
    const line = draft.lines[0];

    // $500 base + $100 bonus − $150 deduction = $450 net.
    await owner.mutation(api.payroll.updateRunLine, {
      lineId: line.id as Id<"payrollRunLines">, bonusMinor: 100_000, deductionMinor: 150_000,
    });
    const after = (await owner.query(api.payroll.runDetail, { runId }))!;
    expect(after.lines[0].bonusMinor).toBe(100_000);
    expect(after.lines[0].deductionMinor).toBe(150_000);
    expect(after.lines[0].finalLocalMinor).toBe(450_000);

    const approved = await owner.mutation(api.payroll.approveRun, { runId });
    expect(approved.baseTotalMinor).toBe(450_000);
    const lines = await entryLines(t, approved.entryId);
    expect(lines.reduce((s, l) => s + l.debitMinor, 0)).toBe(lines.reduce((s, l) => s + l.creditMinor, 0));
    expect(lines.find((l) => l.accountId === ids.expenseId)?.debitMinor).toBe(450_000);
  });
});

describe("salary history is appended, never overwritten", () => {
  it("logs a hire event on create and an increment event on each salary change", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authAs(t, ids.owner);

    const { employeeId } = await owner.mutation(api.employees.createEmployee, {
      entityId: ids.entityId,
      name: "Bilal Khan",
      country: "Pakistan",
      currency: "USD",
      monthlySalaryMinor: 500_000,
    });
    let history = await owner.query(api.employees.salaryHistory, { employeeId });
    expect(history).toHaveLength(1);
    expect(history[0].previousAmountMinor).toBeNull();
    expect(history[0].newAmountMinor).toBe(500_000);

    await owner.mutation(api.employees.updateEmployee, {
      employeeId,
      monthlySalaryMinor: 650_000,
      salaryNote: "Annual increment",
    });
    history = await owner.query(api.employees.salaryHistory, { employeeId });
    expect(history).toHaveLength(2);
    expect(history[0].previousAmountMinor).toBe(500_000);
    expect(history[0].newAmountMinor).toBe(650_000);
    expect(history[0].note).toBe("Annual increment");

    // A no-op save (same salary) does NOT add a history row.
    await owner.mutation(api.employees.updateEmployee, { employeeId, monthlySalaryMinor: 650_000 });
    history = await owner.query(api.employees.salaryHistory, { employeeId });
    expect(history).toHaveLength(2);
  });
});

describe("termination and reactivation", () => {
  it("markExited excludes from future drafts; reactivation restores and clears the exit stamp", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authAs(t, ids.owner);

    const a = await owner.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Stayer", country: "US", currency: "USD", monthlySalaryMinor: 300_000,
    });
    const b = await owner.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Leaver", country: "US", currency: "USD", monthlySalaryMinor: 400_000,
    });

    await owner.mutation(api.employees.markExited, {
      employeeId: b.employeeId, exitDate: "2026-04-30", exitReason: "Resigned",
    });
    const left = (await owner.query(api.employees.getEmployee, { employeeId: b.employeeId }))!;
    expect(left.active).toBe(false);
    expect(left.exitReason).toBe("Resigned");

    // A new run drafts only the remaining active employee.
    const { runId } = await owner.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-05" });
    const detail = (await owner.query(api.payroll.runDetail, { runId }))!;
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0].employeeName).toBe("Stayer");

    // Reactivation restores and clears the exit stamp.
    await owner.mutation(api.employees.updateEmployee, { employeeId: b.employeeId, active: true });
    const back = (await owner.query(api.employees.getEmployee, { employeeId: b.employeeId }))!;
    expect(back.active).toBe(true);
    expect(back.exitDate ?? null).toBeNull();
    void a;
  });
});

describe("bulk employee import", () => {
  it("creates new employees and updates existing ones by name, in native currency", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authAs(t, ids.owner);

    await owner.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Ahmed Ali", country: "Pakistan", currency: "PKR", monthlySalaryMinor: 500_000,
    });

    const res = await owner.mutation(api.employees.bulkImportEmployees, {
      entityId: ids.entityId,
      rows: [
        { name: "Ahmed Ali", currency: "PKR", monthlySalaryMinor: 650_000, city: "Lahore" }, // update
        { name: "Sara Khan", currency: "PKR", monthlySalaryMinor: 400_000, country: "Pakistan", city: "Karachi" }, // new
        { name: "John Smith", currency: "USD", monthlySalaryMinor: 900_000, country: "USA" }, // new, USD-native
      ],
    });
    expect(res.created).toBe(2);
    expect(res.updated).toBe(1);

    const roster = await owner.query(api.employees.listEmployees, { entityId: ids.entityId });
    const ahmed = roster.employees.find((e) => e.name === "Ahmed Ali")!;
    expect(ahmed.monthlySalaryMinor).toBe(650_000);
    expect(ahmed.currency).toBe("PKR");
    expect(ahmed.city).toBe("Lahore");
    const john = roster.employees.find((e) => e.name === "John Smith")!;
    expect(john.currency).toBe("USD");
    expect(john.monthlyBaseEquivalentMinor).toBe(900_000); // USD-native → equals native

    // The salary change on the existing employee was logged (hire + increment).
    const history = await owner.query(api.employees.salaryHistory, { employeeId: ahmed._id as Id<"employees"> });
    expect(history).toHaveLength(2);
  });

  it("HR (a preparer) can bulk import employees", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const hr = authAs(t, ids.hr);
    const res = await hr.mutation(api.employees.bulkImportEmployees, {
      entityId: ids.entityId, rows: [{ name: "By HR", currency: "USD", monthlySalaryMinor: 100_000 }],
    });
    expect(res.created).toBe(1);
  });
});

describe("maker-checker: HR prepares, Owner/Accountant approve", () => {
  it("accountant can prepare AND approve payroll", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const accountant = authAs(t, ids.accountant);
    const created = await accountant.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "By Accountant", country: "US", currency: "USD", monthlySalaryMinor: 500_000,
    });
    expect(created.employeeId).toBeDefined();
    const { runId } = await accountant.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    const approved = await accountant.mutation(api.payroll.approveRun, { runId });
    expect(approved.baseTotalMinor).toBe(500_000);
  });

  it("HR prepares + submits, but cannot approve/settle; the approver approves the submitted run", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const hr = authAs(t, ids.hr);
    const accountant = authAs(t, ids.accountant);

    // HR manages the roster and drafts a run (the maker).
    const emp = await hr.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Prepared By HR", country: "PK", currency: "PKR", monthlySalaryMinor: 500_000,
    });
    expect(emp.employeeId).toBeDefined();
    const { runId } = await hr.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });

    const draft = (await hr.query(api.payroll.runDetail, { runId }))!;
    expect(draft.canPrepare).toBe(true);
    expect(draft.canApprove).toBe(false);
    expect(draft.editable).toBe(true);
    const roster = await hr.query(api.employees.listEmployees, { entityId: ids.entityId });
    expect(roster.canPrepare).toBe(true);

    // HR adds a bonus on the draft, then submits for approval.
    await hr.mutation(api.payroll.updateRunLine, {
      lineId: draft.lines[0].id as Id<"payrollRunLines">, bonusMinor: 50_000,
    });
    await hr.mutation(api.payroll.submitRunForApproval, { runId });
    const submitted = (await hr.query(api.payroll.runDetail, { runId }))!;
    expect(submitted.run.status).toBe("submitted");
    expect(submitted.editable).toBe(false); // locked from further HR edits

    // HR cannot approve, settle, or send back (no payroll.approve).
    await expect(hr.mutation(api.payroll.approveRun, { runId })).rejects.toThrow();
    await expect(hr.mutation(api.payroll.markRunPaid, { runId })).rejects.toThrow();
    await expect(hr.mutation(api.payroll.sendRunBack, { runId, note: "nope" })).rejects.toThrow();

    // The checker (Accountant) approves the submitted run → posts to the ledger.
    const approved = await accountant.mutation(api.payroll.approveRun, { runId });
    expect(approved.baseTotalMinor).toBeGreaterThan(0);
    const posted = (await accountant.query(api.payroll.runDetail, { runId }))!;
    expect(posted.run.status).toBe("approved");
  });

  it("an approver can send a submitted run back to draft for changes", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const hr = authAs(t, ids.hr);
    const owner = authAs(t, ids.owner);

    await hr.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Reopen Me", country: "US", currency: "USD", monthlySalaryMinor: 500_000,
    });
    const { runId } = await hr.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await hr.mutation(api.payroll.submitRunForApproval, { runId });

    await owner.mutation(api.payroll.sendRunBack, { runId, note: "Fix Ahmed's bonus" });
    const back = (await hr.query(api.payroll.runDetail, { runId }))!;
    expect(back.run.status).toBe("draft");
    expect(back.editable).toBe(true); // HR can edit + resubmit
  });

  it("submitting notifies approvers; approving notifies the submitter (not the actor)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const hr = authAs(t, ids.hr);
    const accountant = authAs(t, ids.accountant);

    await hr.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Notify Me", country: "US", currency: "USD", monthlySalaryMinor: 500_000,
    });
    const { runId } = await hr.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    await hr.mutation(api.payroll.submitRunForApproval, { runId });

    // Approver is notified, with a link to the run.
    const acctInbox = await accountant.query(api.notifications.list, { workspaceId: ids.workspaceId });
    const submitNote = acctInbox.notifications.find((n) => n.kind === "payroll.run.submitted");
    expect(submitNote).toBeTruthy();
    expect(submitNote!.link).toContain(runId);
    expect(acctInbox.unreadCount).toBeGreaterThanOrEqual(1);

    // The submitter is NOT notified about their own action.
    const hrAfterSubmit = await hr.query(api.notifications.list, { workspaceId: ids.workspaceId });
    expect(hrAfterSubmit.notifications.some((n) => n.kind === "payroll.run.submitted")).toBe(false);

    // Approving notifies the submitter (HR).
    await accountant.mutation(api.payroll.approveRun, { runId });
    const hrInbox = await hr.query(api.notifications.list, { workspaceId: ids.workspaceId });
    const approvedNote = hrInbox.notifications.find((n) => n.kind === "payroll.run.approved");
    expect(approvedNote).toBeTruthy();

    // Mark-read clears the unread flag.
    await hr.mutation(api.notifications.markRead, { notificationId: approvedNote!.id as Id<"notifications"> });
    const hrInbox2 = await hr.query(api.notifications.list, { workspaceId: ids.workspaceId });
    expect(hrInbox2.notifications.find((n) => n.id === approvedNote!.id)!.read).toBe(true);
  });

  it("payslipByToken is a capability: right token reads with no session, wrong/short token is null", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authAs(t, ids.owner);

    await owner.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Tokened", country: "US", currency: "USD", monthlySalaryMinor: 500_000,
    });
    const { runId } = await owner.mutation(api.payroll.startRun, { entityId: ids.entityId, period: "2026-04" });
    const detail = (await owner.query(api.payroll.runDetail, { runId }))!;
    const lineId = detail.lines[0].id as Id<"payrollRunLines">;

    const token = "a".repeat(48);
    await t.run(async (ctx) => {
      await ctx.db.patch(lineId, { payslipToken: token });
    });

    // No identity attached to `t` → unauthenticated read succeeds ONLY via token.
    const good = await t.query(api.payroll.payslipByToken, { lineId, token });
    expect(good).not.toBeNull();
    expect(good!.finalLocalMinor).toBe(500_000);

    expect(await t.query(api.payroll.payslipByToken, { lineId, token: "b".repeat(48) })).toBeNull();
    expect(await t.query(api.payroll.payslipByToken, { lineId, token: "short" })).toBeNull();
  });

  it("bank details (payTo) are returned to payroll preparers (incl. HR)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authAs(t, ids.owner);
    const hr = authAs(t, ids.hr);

    const { employeeId } = await owner.mutation(api.employees.createEmployee, {
      entityId: ids.entityId, name: "Banked", country: "US", currency: "USD", monthlySalaryMinor: 500_000,
      payTo: { bankName: "Big Bank", accountTitle: "Banked", ibanOrAccountNumber: "PK00 0000" },
    });

    // HR onboards employees (a preparer), so it sees the bank details it enters.
    const asOwner = (await owner.query(api.employees.getEmployee, { employeeId }))!;
    expect(asOwner.payTo).not.toBeNull();
    const asHr = (await hr.query(api.employees.getEmployee, { employeeId }))!;
    expect(asHr.payTo).not.toBeNull();
    expect(asHr.hasBankDetails).toBe(true);
  });
});
