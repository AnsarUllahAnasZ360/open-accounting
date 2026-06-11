"use client";

import { useQuery } from "convex/react";

import { api } from "../../../../../convex/_generated/api";

export function LeadsPanel() {
  const leads = useQuery(api.requestAccess.list, {});

  if (leads === undefined) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-xs">
        Loading request-access leads...
      </div>
    );
  }

  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">Request-access leads</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Captured from the invite-only landing page.
        </p>
      </div>
      <div className="divide-y">
        {leads.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No leads yet.</div>
        ) : (
          leads.map((lead) => (
            <div key={lead._id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_140px_120px]">
              <div>
                <div className="font-medium">{lead.email}</div>
                <div className="text-muted-foreground">
                  {[lead.name, lead.company].filter(Boolean).join(" · ") || "No name or company"}
                </div>
                {lead.message ? <div className="mt-1 text-muted-foreground">{lead.message}</div> : null}
              </div>
              <div className="money-figures text-muted-foreground">
                {new Date(lead.updatedAt).toLocaleDateString("en-US")}
              </div>
              <div className="text-muted-foreground">{lead.status}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
