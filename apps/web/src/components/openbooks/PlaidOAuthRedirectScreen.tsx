"use client";

import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkError } from "react-plaid-link";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { clearPlaidOAuthSession, readPlaidOAuthSession } from "@/lib/openbooks/plaid-oauth";

type OAuthSession = {
  linkToken: string;
  entityId: string;
  receivedRedirectUri: string;
};

function OAuthLinkResume({
  token,
  receivedRedirectUri,
  onSuccess,
  onExit,
}: {
  token: string;
  receivedRedirectUri: string;
  onSuccess: (publicToken: string) => void;
  onExit: (error: PlaidLinkError | ErrorEvent | null) => void;
}) {
  const [opened, setOpened] = useState(false);
  const { open, ready, error } = usePlaidLink({
    token,
    receivedRedirectUri,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (error) onExit(error);
  }, [error, onExit]);

  useEffect(() => {
    if (!ready || opened) return;
    // Fire Plaid Link exactly once when the SDK reports ready. The guard above
    // makes this a one-shot trigger, not a render-driven state sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpened(true);
    open();
  }, [open, opened, ready]);

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Returning to Plaid Link...
    </div>
  );
}

export function PlaidOAuthRedirectScreen() {
  const router = useRouter();
  const exchangePublicToken = useAction(api.plaid.exchangePublicTokenAndPreviewAccounts);

  const [session, setSession] = useState<OAuthSession | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // One-time read of the persisted OAuth session on mount (browser-only); a
    // sync from an external store, not a render-driven state cascade.
    const stored = readPlaidOAuthSession();
    if (!stored.linkToken || !stored.entityId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(null);
      return;
    }
    setSession({
      linkToken: stored.linkToken,
      entityId: stored.entityId,
      receivedRedirectUri: window.location.href,
    });
  }, []);

  const onSuccess = useCallback(
    (publicToken: string) => {
      if (!session?.entityId) return;
      setError("");
      setMessage("Plaid returned authorization. Saving the bank connection server-side.");
      void exchangePublicToken({
        entityId: session.entityId as Id<"entities">,
        publicToken,
      })
        .then((result) => {
          clearPlaidOAuthSession();
          const touched = (result.accountsCreated ?? 0) + (result.accountsUpdated ?? 0);
          setMessage(`${touched} bank account${touched === 1 ? "" : "s"} saved. Returning to Connections.`);
          window.setTimeout(() => router.push("/settings/connections"), 900);
        })
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : "Plaid OAuth could not be completed.");
        });
    },
    [exchangePublicToken, router, session],
  );

  const onExit = useCallback((plaidError: PlaidLinkError | ErrorEvent | null) => {
    if (!plaidError) {
      setMessage("Plaid Link was closed before a bank account was connected.");
      return;
    }
    const maybePlaid = plaidError as Partial<PlaidLinkError> & { message?: string };
    setError(
      maybePlaid.display_message ||
        maybePlaid.error_message ||
        maybePlaid.error_code ||
        maybePlaid.message ||
        "Plaid Link exited with an error.",
    );
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-xl rounded-[14px] border bg-card p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            ob
          </span>
          <div>
            <h1 className="text-base font-semibold">Bank connection</h1>
            <p className="text-sm text-muted-foreground">Complete the bank authorization and choose which accounts to sync.</p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {session === undefined ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading bank connection...
            </div>
          ) : null}

          {session === null ? (
            <div className="rounded-[10px] border border-dashed p-4 text-sm text-muted-foreground">
              Start again from Settings &gt; Connections so OpenBooks can create a fresh Plaid Link token.
            </div>
          ) : null}

          {session ? (
            <OAuthLinkResume
              token={session.linkToken}
              receivedRedirectUri={session.receivedRedirectUri}
              onSuccess={onSuccess}
              onExit={onExit}
            />
          ) : null}

          {message ? <div className="rounded-[10px] bg-primary/5 p-3 text-sm text-primary">{message}</div> : null}
          {error ? <div className="rounded-[10px] bg-negative-surface p-3 text-sm text-negative">{error}</div> : null}
        </div>
      </section>
    </main>
  );
}
