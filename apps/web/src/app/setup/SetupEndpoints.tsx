"use client";

import { useQuery } from "convex/react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";

// E13-T7: the authenticated owner sees the REAL copyable redirect/webhook URLs
// from `connections.webhookConfig` (which requires `connections.manage`). A
// logged-out prospect sees the URL SHAPE derived from the public app origin —
// no specific deployment's private values are leaked. Reuses the copy-row
// pattern from ConnectionsSection's WebhookField.

const ENDPOINTS: Array<{
  key: "stripeWebhookUrl" | "plaidWebhookUrl" | "plaidRedirectUri" | "stripeRedirectUri";
  label: string;
  shape: string;
  hint: string;
}> = [
  {
    key: "stripeWebhookUrl",
    label: "Stripe webhook URL",
    shape: "https://<your-deployment>.convex.site/stripe/webhook",
    hint: "Add as a webhook endpoint in Stripe → Developers → Webhooks. Required for a live Stripe connection.",
  },
  {
    key: "plaidWebhookUrl",
    label: "Plaid webhook URL",
    shape: "https://<your-deployment>.convex.site/plaid/webhook",
    hint: "Set as your Plaid item webhook so syncs trigger on new activity.",
  },
  {
    key: "plaidRedirectUri",
    label: "Plaid redirect URI",
    shape: "https://<your-app>/settings/connections/plaid/callback",
    hint: "Add to your Plaid app's allowed redirect URIs for OAuth banks.",
  },
  {
    key: "stripeRedirectUri",
    label: "Stripe redirect URI",
    shape: "https://<your-app>/settings/connections/stripe/callback",
    hint: "Add to your Stripe Connect OAuth settings.",
  },
];

function CopyRow({ label, value, hint, isShape }: { label: string; value: string; hint: string; isShape: boolean }) {
  const [copied, setCopied] = useState(false);
  function onCopy() {
    if (!value || isShape) return;
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }
  return (
    <div className="grid gap-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded-[8px] border bg-muted/40 px-2.5 py-2 font-mono text-[12px]"
          title={value}
          data-testid={`setup-endpoint-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
        >
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isShape}
          onClick={onCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : isShape ? "Sign in" : "Copy"}
        </Button>
      </div>
      <p className="text-[11.5px] leading-5 text-muted-foreground">{hint}</p>
    </div>
  );
}

export function SetupEndpoints() {
  // null = not signed in or lacks connections.manage (the query returns nothing
  // for those callers); undefined = still loading. Both fall back to URL shapes.
  const webhook = useQuery(api.connections.webhookConfig, {});
  const authed = Boolean(webhook);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          {authed
            ? "These are your deployment's real endpoints — copy each into the matching provider dashboard."
            : "Sign in to your own deployment to see the exact, copyable URLs. The shapes below show what you'll register."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {ENDPOINTS.map((endpoint) => {
          const real = webhook?.[endpoint.key];
          const value = real && real.length > 0 ? real : endpoint.shape;
          return (
            <CopyRow
              key={endpoint.key}
              label={endpoint.label}
              value={value}
              hint={endpoint.hint}
              isShape={!real || real.length === 0}
            />
          );
        })}
      </div>
    </div>
  );
}
