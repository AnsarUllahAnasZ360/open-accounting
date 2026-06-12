"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { CheckCircle2, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import { SignInForm } from "@/components/openbooks/SignInForm";
import { Button } from "@/components/ui/button";

export function InviteAcceptScreen({ token }: { token: string }) {
  const invite = useQuery(api.team.lookupInvite, { token });

  if (invite === undefined) {
    return (
      <InviteShell>
        <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground shadow-xs">
          Checking invite...
        </div>
      </InviteShell>
    );
  }

  if (invite.status === "invalid") {
    return (
      <InviteShell>
        <StatusCard
          icon={<TriangleAlert className="size-4" />}
          title="Invite link not found"
          body="Ask the workspace owner for a fresh OpenBooks invite. For safety, invite links can be replaced when the owner resends access."
        />
      </InviteShell>
    );
  }

  if (invite.status === "accepted") {
    return (
      <InviteShell>
        <StatusCard
          icon={<CheckCircle2 className="size-4" />}
          title="Invite already accepted"
          body="This invite has already been used. Sign in with the account that accepted it to open the workspace."
          action={
            <Button asChild className="mt-4 w-full">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          }
        />
      </InviteShell>
    );
  }

  if (invite.status === "revoked") {
    return (
      <InviteShell>
        <StatusCard
          icon={<TriangleAlert className="size-4" />}
          title="Invite revoked"
          body="This invite was revoked by the workspace owner. Request a new invite before creating an account."
        />
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="inline-flex h-7 items-center rounded-full bg-[#f1f8ee] px-3 text-[12.5px] font-medium text-[#17540f]">
            Workspace invite
          </div>
          <h1 className="mt-6 max-w-xl text-[42px] font-semibold leading-[1.06] tracking-normal">
            Join {invite.workspaceName}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            You have been invited as <strong className="font-semibold text-foreground">{invite.roleLabel}</strong>.
            OpenBooks creates the account only for the invited email address.
          </p>
          <div className="mt-6 rounded-lg border bg-card p-4 shadow-xs">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f1f8ee] text-[#17540f]">
                <ShieldCheck className="size-4" />
              </span>
              <div>
                <div className="text-sm font-medium">Access level</div>
                <p className="mt-1 text-sm text-muted-foreground">{invite.roleDesc}</p>
              </div>
            </div>
          </div>
        </div>
        <SignInForm
          defaultEmail={invite.email}
          lockEmail
          submitLabel="Create invited account"
        />
      </div>
    </InviteShell>
  );
}

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-[60px] max-w-[1080px] items-center justify-between px-4 lg:px-6">
          <Link className="flex items-center gap-2.5" href="/">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              ob
            </span>
            <span className="text-[15px] font-semibold">open books</span>
          </Link>
          <Button asChild variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </header>
      <section className="mx-auto max-w-[1080px] px-4 py-14 lg:px-6">{children}</section>
    </main>
  );
}

function StatusCard({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md rounded-lg border bg-card p-5 shadow-xs">
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <h1 className="mt-4 text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
