import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireWorkspacePermission, roleHasPermission } from "./authz";
import { assertNotDemoWrite } from "./demoWorkspace";
import { baseEquivalentMinor, periodLabel } from "./payrollMath";
import { resolveAccrualFxRateMicros } from "./payroll";

// ---------------------------------------------------------------------------
// Employee roster CRUD + rich profile (payroll). Adding/editing an employee is
// config, not a ledger event — payroll only posts when a run is approved. All
// writes are `payroll.prepare`-gated (Owner + Accountant + HR — HR owns the
// roster), blocked on demo workspaces, and audited. Reads are `payroll.view`-
// gated. Bank details (`payTo`) are returned only to callers who can prepare
// payroll.
// ---------------------------------------------------------------------------

async function loadEntityForPayrollWrite(ctx: MutationCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) throw new ConvexError("OpenBooks business not found.");
  const { userId } = await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.prepare");
  await assertNotDemoWrite(ctx, entity.workspaceId);
  return { entity, userId };
}

async function loadEmployeeForWrite(ctx: MutationCtx, employeeId: Id<"employees">) {
  const employee = await ctx.db.get(employeeId);
  if (!employee) throw new ConvexError("Employee not found.");
  const { entity, userId } = await loadEntityForPayrollWrite(ctx, employee.entityId);
  return { employee, entity, userId };
}

// Read gate: anyone with payroll.view (Owner, Accountant, HR). `canPrepare`
// tells callers whether to expose bank details (payTo).
async function loadEntityForPayrollRead(ctx: QueryCtx, entityId: Id<"entities">) {
  const entity = await ctx.db.get(entityId);
  if (!entity) throw new ConvexError("OpenBooks business not found.");
  const { userId, membership } = await requireWorkspacePermission(ctx, entity.workspaceId, "payroll.view");
  const canPrepare = roleHasPermission(membership.role, "payroll.prepare");
  return { entity, userId, canPrepare };
}

function normalizeCurrency(input: string) {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ConvexError("Currency must be a 3-letter code (e.g. USD).");
  }
  return code;
}

function assertSalary(minor: number) {
  if (!Number.isInteger(minor) || minor <= 0) {
    throw new ConvexError("Monthly salary must be a positive amount.");
  }
}

function moneyLabel(minor: number, currency: string) {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Structured bank details stored inside the loose `payTo` field. Only returned
// to payroll.prepare holders.
const payToValidator = v.object({
  bankName: v.optional(v.string()),
  accountTitle: v.optional(v.string()),
  ibanOrAccountNumber: v.optional(v.string()),
});

const employmentTypeValidator = v.union(
  v.literal("full_time"),
  v.literal("part_time"),
  v.literal("contractor"),
);

const payFrequencyValidator = v.union(
  v.literal("hourly"),
  v.literal("weekly"),
  v.literal("semimonthly"),
  v.literal("monthly"),
);

// Optional profile fields shared by create + update. Kept as a spreadable
// object so both mutations validate the same shape.
const profileArgs = {
  title: v.optional(v.string()),
  email: v.optional(v.string()),
  department: v.optional(v.string()),
  phone: v.optional(v.string()),
  city: v.optional(v.string()),
  employmentType: v.optional(employmentTypeValidator),
  startDate: v.optional(v.string()),
  payFrequency: v.optional(payFrequencyValidator),
  paymentMethod: v.optional(v.string()),
  photoStorageId: v.optional(v.id("_storage")),
  payTo: v.optional(payToValidator),
};

type ProfilePatch = Record<string, unknown>;

// Copy provided optional profile fields onto a patch. Trimmed strings; empty
// strings are still written (so a field can be cleared) except where a default
// applies. `payTo`/`emergencyContact`/`photoStorageId` pass through as-is.
function applyProfileFields(patch: ProfilePatch, args: Record<string, unknown>) {
  const stringFields = [
    "title",
    "email",
    "department",
    "phone",
    "city",
    "startDate",
    "paymentMethod",
  ] as const;
  for (const key of stringFields) {
    const value = args[key];
    if (value !== undefined) patch[key] = typeof value === "string" ? value.trim() : value;
  }
  if (args.employmentType !== undefined) patch.employmentType = args.employmentType;
  if (args.payFrequency !== undefined) patch.payFrequency = args.payFrequency;
  if (args.photoStorageId !== undefined) patch.photoStorageId = args.photoStorageId;
  if (args.payTo !== undefined) patch.payTo = args.payTo;
}

export const createEmployee = mutation({
  args: {
    entityId: v.id("entities"),
    name: v.string(),
    country: v.string(),
    currency: v.string(),
    monthlySalaryMinor: v.number(),
    ...profileArgs,
  },
  handler: async (ctx, args) => {
    const { entity, userId } = await loadEntityForPayrollWrite(ctx, args.entityId);
    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Enter the employee's name.");
    const currency = normalizeCurrency(args.currency);
    assertSalary(args.monthlySalaryMinor);
    const now = Date.now();

    const insert: ProfilePatch = {
      entityId: entity._id,
      name,
      country: args.country.trim() || "—",
      currency,
      monthlySalaryMinor: args.monthlySalaryMinor,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    applyProfileFields(insert, args as Record<string, unknown>);
    // Don't persist empty-string optionals from applyProfileFields.
    for (const key of Object.keys(insert)) {
      if (insert[key] === "") delete insert[key];
    }
    const employeeId = await ctx.db.insert("employees", insert as any);

    // Seed the salary-history log with the hire event (no previous amount).
    await ctx.db.insert("employeeCompensationEvents", {
      entityId: entity._id,
      employeeId,
      newAmountMinor: args.monthlySalaryMinor,
      currency,
      effectiveDate: (args.startDate?.trim() || todayIso()),
      changedBy: userId,
      note: "Hire",
      createdAt: now,
    });

    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "payroll.employee.created",
      entityType: "employee",
      entityId: employeeId,
      summary: `Added ${name} to payroll (${moneyLabel(args.monthlySalaryMinor, currency)}/mo)`,
      createdAt: now,
    });

    return { employeeId };
  },
});

export const updateEmployee = mutation({
  args: {
    employeeId: v.id("employees"),
    name: v.optional(v.string()),
    country: v.optional(v.string()),
    currency: v.optional(v.string()),
    monthlySalaryMinor: v.optional(v.number()),
    active: v.optional(v.boolean()),
    // Salary-change metadata (only used when monthlySalaryMinor changes).
    salaryEffectiveDate: v.optional(v.string()),
    salaryNote: v.optional(v.string()),
    ...profileArgs,
  },
  handler: async (ctx, args) => {
    const { employee, entity, userId } = await loadEmployeeForWrite(ctx, args.employeeId);

    const now = Date.now();
    const patch: ProfilePatch = { updatedAt: now };

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 2) throw new ConvexError("Enter the employee's name.");
      patch.name = name;
    }
    if (args.country !== undefined) patch.country = args.country.trim() || "—";
    const currency = args.currency !== undefined ? normalizeCurrency(args.currency) : employee.currency;
    if (args.currency !== undefined) patch.currency = currency;

    let salaryChanged = false;
    if (args.monthlySalaryMinor !== undefined) {
      assertSalary(args.monthlySalaryMinor);
      if (args.monthlySalaryMinor !== employee.monthlySalaryMinor) {
        salaryChanged = true;
        patch.monthlySalaryMinor = args.monthlySalaryMinor;
      }
    }

    if (args.active !== undefined) {
      patch.active = args.active;
      // Reactivation clears the exit stamp so the employee is drafted again.
      if (args.active === true) {
        patch.exitDate = undefined;
        patch.exitReason = undefined;
      }
    }

    applyProfileFields(patch, args as Record<string, unknown>);

    await ctx.db.patch(employee._id, patch);

    // Append (never overwrite) the salary-history log on a real change.
    if (salaryChanged && args.monthlySalaryMinor !== undefined) {
      await ctx.db.insert("employeeCompensationEvents", {
        entityId: entity._id,
        employeeId: employee._id,
        previousAmountMinor: employee.monthlySalaryMinor,
        newAmountMinor: args.monthlySalaryMinor,
        currency,
        effectiveDate: (args.salaryEffectiveDate?.trim() || todayIso()),
        changedBy: userId,
        ...(args.salaryNote?.trim() ? { note: args.salaryNote.trim() } : {}),
        createdAt: now,
      });
    }

    const summary =
      args.active === false
        ? `Deactivated ${patch.name ?? employee.name} on payroll`
        : args.active === true
          ? `Reactivated ${patch.name ?? employee.name} on payroll`
          : salaryChanged
            ? `Changed ${patch.name ?? employee.name}'s salary to ${moneyLabel(args.monthlySalaryMinor!, currency)}/mo`
            : `Updated ${patch.name ?? employee.name}'s payroll record`;
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "payroll.employee.updated",
      entityType: "employee",
      entityId: employee._id,
      summary,
      createdAt: now,
    });

    return { employeeId: employee._id };
  },
});

/**
 * Terminate an employee. Requires a date + reason. Sets active:false and stamps
 * the exit; excluded from future run drafts (the draft path filters on active).
 * Never hard-deletes — the employee moves to "Former Employees" and can be
 * reactivated via updateEmployee({ active: true }).
 */
export const markExited = mutation({
  args: {
    employeeId: v.id("employees"),
    exitDate: v.string(),
    exitReason: v.string(),
  },
  handler: async (ctx, args) => {
    const { employee, entity, userId } = await loadEmployeeForWrite(ctx, args.employeeId);
    const exitDate = args.exitDate.trim();
    const exitReason = args.exitReason.trim();
    if (!exitDate) throw new ConvexError("Enter the termination date.");
    if (!exitReason) throw new ConvexError("Enter a termination reason.");

    const now = Date.now();
    await ctx.db.patch(employee._id, {
      active: false,
      exitDate,
      exitReason,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "payroll.employee.exited",
      entityType: "employee",
      entityId: employee._id,
      summary: `Terminated ${employee.name} on payroll (${exitReason})`,
      createdAt: now,
    });

    return { employeeId: employee._id };
  },
});

/**
 * Bulk-add employees from a CSV / spreadsheet upload. Upserts by name
 * (case-insensitive within the entity): a new name is created (with a hire
 * salary-history event); an existing name is updated (with an increment event
 * if the salary changed). Salaries arrive in each row's native currency and are
 * stored as-is. payroll.prepare-gated + demo-blocked. Bounded at 500 rows.
 */
export const bulkImportEmployees = mutation({
  args: {
    entityId: v.id("entities"),
    rows: v.array(
      v.object({
        name: v.string(),
        email: v.optional(v.string()),
        title: v.optional(v.string()),
        department: v.optional(v.string()),
        country: v.optional(v.string()),
        city: v.optional(v.string()),
        currency: v.string(),
        monthlySalaryMinor: v.number(),
        phone: v.optional(v.string()),
        employmentType: v.optional(employmentTypeValidator),
        startDate: v.optional(v.string()),
        payFrequency: v.optional(payFrequencyValidator),
        paymentMethod: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { entity, userId } = await loadEntityForPayrollWrite(ctx, args.entityId);
    if (args.rows.length === 0) throw new ConvexError("No rows to import.");
    if (args.rows.length > 500) throw new ConvexError("Maximum 500 employees per import.");

    const now = Date.now();
    const existing = await ctx.db
      .query("employees")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(2000);
    const byName = new Map(existing.map((e) => [e.name.toLowerCase().trim(), e]));

    let created = 0;
    let updated = 0;

    for (const row of args.rows) {
      const name = row.name.trim();
      if (name.length < 2) continue;
      const currency = normalizeCurrency(row.currency);
      assertSalary(row.monthlySalaryMinor);

      // Optional profile fields, trimmed; empty strings dropped.
      const profile: ProfilePatch = {};
      applyProfileFields(profile, {
        email: row.email,
        title: row.title,
        department: row.department,
        city: row.city,
        phone: row.phone,
        employmentType: row.employmentType,
        startDate: row.startDate,
        payFrequency: row.payFrequency,
        paymentMethod: row.paymentMethod,
      });
      for (const key of Object.keys(profile)) {
        if (profile[key] === "") delete profile[key];
      }

      const match = byName.get(name.toLowerCase());
      if (match) {
        const salaryChanged = row.monthlySalaryMinor !== match.monthlySalaryMinor;
        await ctx.db.patch(match._id, {
          currency,
          monthlySalaryMinor: row.monthlySalaryMinor,
          ...(row.country?.trim() ? { country: row.country.trim() } : {}),
          ...profile,
          updatedAt: now,
        });
        if (salaryChanged) {
          await ctx.db.insert("employeeCompensationEvents", {
            entityId: entity._id,
            employeeId: match._id,
            previousAmountMinor: match.monthlySalaryMinor,
            newAmountMinor: row.monthlySalaryMinor,
            currency,
            effectiveDate: (row.startDate?.trim() || todayIso()),
            changedBy: userId,
            note: "Bulk import",
            createdAt: now,
          });
        }
        updated++;
      } else {
        const insert: ProfilePatch = {
          entityId: entity._id,
          name,
          country: row.country?.trim() || "—",
          currency,
          monthlySalaryMinor: row.monthlySalaryMinor,
          active: true,
          createdAt: now,
          updatedAt: now,
          ...profile,
        };
        const employeeId = await ctx.db.insert("employees", insert as any);
        await ctx.db.insert("employeeCompensationEvents", {
          entityId: entity._id,
          employeeId,
          newAmountMinor: row.monthlySalaryMinor,
          currency,
          effectiveDate: (row.startDate?.trim() || todayIso()),
          changedBy: userId,
          note: "Hire (bulk import)",
          createdAt: now,
        });
        // Guard against duplicate rows in the same file → update, not re-create.
        byName.set(name.toLowerCase(), {
          ...(insert as unknown as Doc<"employees">),
          _id: employeeId,
          _creationTime: now,
        });
        created++;
      }
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "payroll.employee.bulk_imported",
      entityType: "entity",
      entityId: entity._id,
      summary: `Bulk-imported employees (${created} added, ${updated} updated)`,
      createdAt: now,
    });

    return { created, updated };
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function publicEmployee(employee: Doc<"employees">, canPrepare: boolean) {
  const { payTo, ...rest } = employee;
  return {
    ...rest,
    // Bank details only to preparers (roster managers).
    payTo: canPrepare ? (payTo ?? null) : null,
    hasBankDetails: Boolean(payTo),
  };
}

/** Roster for the People / Former Employees tabs (both returned; filter client-side). */
export const listEmployees = query({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    const { entity, canPrepare } = await loadEntityForPayrollRead(ctx, args.entityId);
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(500);
    // Salaries are stored/managed in each employee's native currency; we also
    // surface the USD (base) equivalent so the roster can show both. Cache the
    // rate per currency so N employees never trigger N redundant FX lookups.
    const rateByCurrency = new Map<string, number>();
    const rateFor = async (currency: string) => {
      const cached = rateByCurrency.get(currency);
      if (cached !== undefined) return cached;
      const rate = await resolveAccrualFxRateMicros(ctx, entity.currency, currency);
      rateByCurrency.set(currency, rate);
      return rate;
    };
    const rows = await Promise.all(
      employees.map(async (employee) => ({
        ...publicEmployee(employee, canPrepare),
        baseCurrency: entity.currency,
        monthlyBaseEquivalentMinor: baseEquivalentMinor(
          employee.monthlySalaryMinor,
          await rateFor(employee.currency),
        ),
      })),
    );
    return {
      canPrepare,
      baseCurrency: entity.currency,
      employees: rows.sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

/** Full profile for the employee detail view. */
export const getEmployee = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) return null;
    const { entity, canPrepare } = await loadEntityForPayrollRead(ctx, employee.entityId);
    let photoUrl: string | null = null;
    if (employee.photoStorageId) {
      photoUrl = await ctx.storage.getUrl(employee.photoStorageId);
    }
    const rateMicros = await resolveAccrualFxRateMicros(ctx, entity.currency, employee.currency);
    return {
      ...publicEmployee(employee, canPrepare),
      photoUrl,
      canPrepare,
      baseCurrency: entity.currency,
      monthlyBaseEquivalentMinor: baseEquivalentMinor(employee.monthlySalaryMinor, rateMicros),
    };
  },
});

/** Full salary-change log for the Salary History tab (newest first). */
export const salaryHistory = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) return [];
    await loadEntityForPayrollRead(ctx, employee.entityId);
    const events = await ctx.db
      .query("employeeCompensationEvents")
      .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
      .take(500);
    return events
      .map((e) => ({
        id: e._id,
        previousAmountMinor: e.previousAmountMinor ?? null,
        newAmountMinor: e.newAmountMinor,
        currency: e.currency,
        effectiveDate: e.effectiveDate,
        changedBy: e.changedBy,
        note: e.note ?? null,
        createdAt: e.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Every payroll run this employee appeared in (Payroll History tab). */
export const employeePayrollHistory = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) return [];
    await loadEntityForPayrollRead(ctx, employee.entityId);
    const lines = await ctx.db
      .query("payrollRunLines")
      .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
      .take(500);
    const rows = await Promise.all(
      lines.map(async (line) => {
        const run = await ctx.db.get(line.runId);
        return {
          lineId: line._id,
          runId: line.runId,
          period: run?.period ?? "",
          periodLabel: run?.period ? periodLabel(run.period) : "",
          status: run?.status ?? "draft",
          currency: line.currency,
          baseSalaryMinor: line.baseSalaryMinor,
          bonusMinor: line.bonusMinor ?? 0,
          adjustmentMinor: line.adjustmentMinor,
          finalLocalMinor: line.finalLocalMinor,
          baseEquivalentMinor: line.baseEquivalentMinor,
          paid: line.paid,
        };
      }),
    );
    return rows.sort((a, b) => b.period.localeCompare(a.period));
  },
});

/** Attached files for the Documents tab, with signed download URLs. */
export const employeeDocuments = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) return [];
    await loadEntityForPayrollRead(ctx, employee.entityId);
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
      .take(200);
    const rows = await Promise.all(
      docs.map(async (doc) => ({
        id: doc._id,
        fileName: doc.fileName ?? "Document",
        mimeType: doc.mimeType ?? null,
        url: doc.storageId ? await ctx.storage.getUrl(doc.storageId) : null,
        createdAt: doc.createdAt,
      })),
    );
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// ---------------------------------------------------------------------------
// Documents (reuse Convex file storage; payroll.prepare-gated)
// ---------------------------------------------------------------------------

/** Signed URL the client POSTs an employee document file to. */
export const generateEmployeeDocUploadUrl = mutation({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args) => {
    await loadEntityForPayrollWrite(ctx, args.entityId);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Record an uploaded file against an employee (contract, ID copy, etc.). */
export const attachEmployeeDocument = mutation({
  args: {
    employeeId: v.id("employees"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { employee, entity, userId } = await loadEmployeeForWrite(ctx, args.employeeId);
    const now = Date.now();
    const documentId = await ctx.db.insert("documents", {
      entityId: entity._id,
      kind: "employee-doc",
      employeeId: employee._id,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      vendor: employee.name,
      date: todayIso(),
      totalMinor: 0,
      currency: entity.currency,
      status: "matched",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      workspaceId: entity.workspaceId,
      actorUserId: userId,
      action: "payroll.employee.document.added",
      entityType: "employee",
      entityId: employee._id,
      summary: `Attached ${args.fileName} to ${employee.name}`,
      createdAt: now,
    });
    return { documentId };
  },
});

/** Remove an employee document (and its stored file). */
export const removeEmployeeDocument = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new ConvexError("Document not found.");
    if (doc.kind !== "employee-doc") throw new ConvexError("Not an employee document.");
    await loadEntityForPayrollWrite(ctx, doc.entityId);
    if (doc.storageId) await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(doc._id);
    return { ok: true };
  },
});
