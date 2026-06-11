import { action, mutation } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function cleanOptional(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const submit = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    message: v.optional(v.string()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = normalizeEmail(args.email);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }

    const lead = {
      email,
      name: cleanOptional(args.name),
      company: cleanOptional(args.company),
      message: cleanOptional(args.message),
      source: cleanOptional(args.source) ?? "landing",
      status: "pending" as const,
      updatedAt: now,
    };

    const existing = await ctx.db
      .query("accessLeads")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, lead);
      return { status: "stored", id: existing._id };
    }

    const id = await ctx.db.insert("accessLeads", {
      ...lead,
      createdAt: now,
    });

    return { status: "stored", id };
  },
});

function plunkBaseUrl() {
  return (process.env.PLUNK_API_BASE_URL ?? "https://api.plunk.zikrainfotech.com").replace(
    /\/$/,
    "",
  );
}

async function notifyOwner(args: {
  email: string;
  name?: string;
  company?: string;
  message?: string;
}) {
  const secret = process.env.PLUNK_SECRET_KEY;
  const from = process.env.PLUNK_FROM_EMAIL;
  const owner = process.env.OWNER_EMAIL;

  if (!secret || !from || !owner) {
    return "skipped" as const;
  }

  const rows = [
    ["Email", args.email],
    ["Name", args.name],
    ["Company", args.company],
    ["Message", args.message],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value ?? "")}</p>`)
    .join("");

  const response = await fetch(`${plunkBaseUrl()}/v1/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: owner,
      from,
      fromName: process.env.PLUNK_FROM_NAME ?? "OpenBooks",
      subject: "New OpenBooks access request",
      body: `<p>A new request-access lead was submitted.</p>${rows}`,
    }),
  });

  if (!response.ok) {
    return "failed" as const;
  }

  const payload = (await response.json()) as { success?: boolean };
  return payload.success === false ? ("failed" as const) : ("sent" as const);
}

export const submitAndNotify = action({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    message: v.optional(v.string()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const result: { status: string; id: Id<"accessLeads"> } = await ctx.runMutation(
      api.requestAccess.submit,
      args,
    );
    const notification = await notifyOwner({
      email: normalizeEmail(args.email),
      name: cleanOptional(args.name),
      company: cleanOptional(args.company),
      message: cleanOptional(args.message),
    });

    return { ...result, notification };
  },
});
