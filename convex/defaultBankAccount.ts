import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export async function ensureDefaultBankAccountForEntity(
  ctx: MutationCtx,
  entity: Doc<"entities">,
) {
  const existing = await ctx.db
    .query("bankAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .first();
  if (existing) return existing._id;

  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .take(200);
  const ledgerAccount =
    accounts.find((account) => account.number === "1010" && account.type === "asset" && account.subtype === "bank") ??
    accounts.find((account) => account.type === "asset" && account.subtype === "bank");
  if (!ledgerAccount) {
    throw new Error("Seeded chart of accounts is missing an asset bank account.");
  }

  const now = Date.now();
  return await ctx.db.insert("bankAccounts", {
    entityId: entity._id,
    ledgerAccountId: ledgerAccount._id,
    name: ledgerAccount.name,
    mask: "CSV",
    kind: "checking",
    balanceMinor: 0,
    includeInSync: false,
    createdAt: now,
    updatedAt: now,
  });
}
