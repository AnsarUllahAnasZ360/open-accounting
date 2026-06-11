/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("request access intake", () => {
  it("stores a pending lead with normalized email and company context", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.requestAccess.submit, {
      email: " Founder@Example.COM ",
      name: "Avery Founder",
      company: "Example Studio",
      source: "landing",
    });

    expect(result).toMatchObject({ status: "stored" });

    const leads = await t.run(async (ctx) => {
      return await ctx.db.query("accessLeads").collect();
    });

    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      email: "founder@example.com",
      name: "Avery Founder",
      company: "Example Studio",
      source: "landing",
      status: "pending",
    });
  });
});
