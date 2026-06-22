"use client";

import { useAction } from "convex/react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";

export function StripeOAuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const completeOAuth = useAction(api.connections.completeStripeOAuth);
  const [status, setStatus] = useState<"working" | "success" | "error">("working");
  const [message, setMessage] = useState("Completing Stripe connection...");
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const immediateError =
    searchParams.get("error_description") ||
    searchParams.get("error") ||
    (!code || !state ? "Stripe did not return the required OAuth code and state." : "");

  useEffect(() => {
    if (immediateError || !code || !state) return;
    let cancelled = false;
    void completeOAuth({ code, state })
      .then((result) => {
        if (cancelled) return;
        setStatus("success");
        setMessage(`Connected ${result.connectedAccountId} to ${result.entityName}.`);
        window.setTimeout(() => router.push("/settings/connections"), 900);
      })
      .catch((caught) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(caught instanceof Error ? caught.message : "Could not complete Stripe OAuth.");
      });
    return () => {
      cancelled = true;
    };
  }, [code, completeOAuth, immediateError, router, state]);

  const effectiveStatus = immediateError ? "error" : status;
  const effectiveMessage = immediateError || message;
  const Icon = effectiveStatus === "error" ? CircleAlert : CheckCircle2;

  return (
    <div className="mx-auto max-w-lg rounded-[14px] border bg-card p-5 shadow-xs">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {effectiveStatus === "working" ? "Completing Stripe OAuth" : effectiveStatus === "success" ? "Stripe connected" : "Stripe connection failed"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{effectiveMessage}</p>
          <Button className="mt-4" size="sm" variant="outline" onClick={() => router.push("/settings/connections")}>
            Back to connections
          </Button>
        </div>
      </div>
    </div>
  );
}
