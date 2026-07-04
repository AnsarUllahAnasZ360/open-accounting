"use client";

import { Building2, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shown when a signed-in user no longer has an accessible workspace — the owner
 * deleted it, or the member's access was removed/suspended. Renders instead of
 * the app shell (which would otherwise crash firing an unauthorized read), and
 * intentionally issues NO workspace-scoped queries of its own.
 */
export function WorkspaceUnavailableScreen({
  userEmail,
  onSignOut,
}: {
  userEmail?: string;
  onSignOut: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-xs">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Building2 className="size-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Workspace unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your last workspace was suspended or deleted, or your access to it was removed. There&apos;s nothing to show
          here anymore.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          If this is unexpected, ask the workspace owner to restore your access or send you a fresh invite
          {userEmail ? (
            <>
              {" "}for <span className="font-medium text-foreground">{userEmail}</span>
            </>
          ) : null}
          .
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={onSignOut} data-testid="workspace-unavailable-signout">
            <LogOut data-icon="inline-start" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
