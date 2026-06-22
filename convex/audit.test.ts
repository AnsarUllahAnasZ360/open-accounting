import { describe, expect, it } from "vitest";

import { auditActorKind } from "./audit";
import type { Doc } from "./_generated/dataModel";

// Build a minimal auditEvents doc; only the fields auditActorKind reads matter.
function event(partial: Partial<Doc<"auditEvents">>): Doc<"auditEvents"> {
  return {
    _id: "audit1" as Doc<"auditEvents">["_id"],
    _creationTime: 0,
    action: "x.y",
    entityType: "test",
    summary: "",
    createdAt: 0,
    ...partial,
  } as Doc<"auditEvents">;
}

describe("auditActorKind (E12-T7 server-side actor classification)", () => {
  it("classifies system actions by the action prefix", () => {
    expect(auditActorKind(event({ action: "system.sync" }))).toBe("system");
  });

  it("classifies AI by action prefix or pipeline summary", () => {
    expect(auditActorKind(event({ action: "ai.categorized" }))).toBe("ai");
    expect(auditActorKind(event({ action: "tx.posted", summary: "Pipeline AI posted" }))).toBe("ai");
    expect(auditActorKind(event({ action: "tx.posted", summary: "AI-confirmed by owner" }))).toBe("ai");
  });

  it("classifies rules by action prefix or rule: summary", () => {
    expect(auditActorKind(event({ action: "rule.created" }))).toBe("rule");
    expect(auditActorKind(event({ action: "tx.posted", summary: "rule: groceries → 6010" }))).toBe("rule");
  });

  it("falls back to user when there is an actorUserId, else system", () => {
    expect(
      auditActorKind(event({ action: "team.invited", actorUserId: "u1" as Doc<"auditEvents">["actorUserId"] })),
    ).toBe("user");
    expect(auditActorKind(event({ action: "team.invited" }))).toBe("system");
  });

  it("does not misclassify a user team action as AI/rule", () => {
    // A 'team.role_changed' written by an owner is a person action, not AI/rule.
    const ev = event({
      action: "team.role_changed",
      summary: "Changed Sam from HR to Accountant",
      actorUserId: "u2" as Doc<"auditEvents">["actorUserId"],
    });
    expect(auditActorKind(ev)).toBe("user");
  });
});
