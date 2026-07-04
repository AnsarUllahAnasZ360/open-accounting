"use client";

import { useAction } from "convex/react";
import { getErrorMessage } from "@/lib/errors";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkError,
  type PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { clearPlaidOAuthSession, readPlaidOAuthSession } from "@/lib/openbooks/plaid-oauth";

type Phase = "loading" | "opening" | "linking" | "done" | "error" | "no-session";

// Auto-fires open() as soon as the Plaid SDK reports ready. One-shot guard
// prevents a re-render from triggering a second open() call.
function AutoOpenLink({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit: (error: PlaidLinkError | null) => void;
}) {
  const [opened, setOpened] = useState(false);
  const { open, ready, error } = usePlaidLink({ token, onSuccess, onExit });

  useEffect(() => {
    if (error) onExit(null);
  }, [error, onExit]);

  useEffect(() => {
    if (!ready || opened) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpened(true);
    open();
  }, [open, opened, ready]);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Opening Plaid Link…
    </div>
  );
}

export function PlaidLinkScreen() {
  const exchangePublicToken = useAction(api.plaid.exchangePublicTokenAndPreviewAccounts);

  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState<{ linkToken: string; entityId: string } | null>(null);

  useEffect(() => {
    const stored = readPlaidOAuthSession();
    if (!stored.linkToken || !stored.entityId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("no-session");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession({ linkToken: stored.linkToken, entityId: stored.entityId });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("opening");
  }, []);

  const post = useCallback((data: unknown) => {
    window.opener?.postMessage(data, window.location.origin);
  }, []);

  const onSuccess = useCallback(
    (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!session) return;
      setPhase("linking");
      setMessage("Bank authorized. Reading accounts…");
      void exchangePublicToken({
        entityId: session.entityId as Id<"entities">,
        publicToken,
        previewOnly: true,
      })
        .then((result) => {
          clearPlaidOAuthSession();
          if (result.mode === "fixture" || !result.accessTokenPersisted) {
            const msg = result.persistenceBlocker ?? "Plaid finished but no bank token was stored.";
            setPhase("error");
            setError(msg);
            post({ type: "plaid-link-error", message: msg });
            return;
          }
          const accounts = (result.accounts ?? []).map((account) => ({
            plaidAccountId: account.plaidAccountId,
            name: account.name,
            mask: account.mask,
            subtype: account.subtype,
            balanceMinor: account.balanceMinor,
            currency: account.currency,
            plaidItemId: account.plaidItemId,
            entityId: session.entityId,
            include: true,
          }));
          const institutionName =
            result.institutionName ?? metadata.institution?.name ?? "Your bank";
          const plaidItemId =
            ("plaidItemId" in result ? (result.plaidItemId as string | null) : null) ?? null;

          post({ type: "plaid-link-success", accounts, institutionName, plaidItemId });
          setPhase("done");
          setMessage("Bank connected. You can close this tab.");
          window.setTimeout(() => window.close(), 1500);
        })
        .catch((caught) => {
          const msg = getErrorMessage(caught, "Reading accounts failed.");
          setPhase("error");
          setError(msg);
          post({ type: "plaid-link-error", message: msg });
        });
    },
    [session, exchangePublicToken, post],
  );

  const onExit = useCallback(
    (plaidError: PlaidLinkError | null) => {
      if (!plaidError) {
        setPhase("opening");
        post({ type: "plaid-link-exit" });
        return;
      }
      const msg =
        plaidError.display_message ||
        plaidError.error_message ||
        plaidError.error_code ||
        "Plaid Link exited with an error.";
      setPhase("error");
      setError(msg);
      post({ type: "plaid-link-error", message: msg });
    },
    [post],
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-xl rounded-[14px] border bg-card p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            ob
          </span>
          <div>
            <h1 className="text-base font-semibold">Connect bank account</h1>
            <p className="text-sm text-muted-foreground">
              Plaid Link will open shortly. Complete the flow to connect your bank.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {phase === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Preparing Plaid Link…
            </div>
          ) : null}

          {phase === "no-session" ? (
            <div className="rounded-[10px] border border-dashed p-4 text-sm text-muted-foreground">
              Session expired or this tab was opened directly. Return to OpenBooks and click
              "Connect bank account" again to start a fresh Plaid Link session.
            </div>
          ) : null}

          {phase === "opening" && session ? (
            <AutoOpenLink
              token={session.linkToken}
              onSuccess={onSuccess}
              onExit={onExit}
            />
          ) : null}

          {phase === "linking" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {message}
            </div>
          ) : null}

          {phase === "done" ? (
            <div className="rounded-[10px] bg-ob-green-50 p-3 text-sm text-ob-green-800">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[10px] bg-negative-surface p-3 text-sm text-negative">
              {error}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
