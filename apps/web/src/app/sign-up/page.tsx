"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function SignUpPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to sign-in after 3 seconds
    const timer = setTimeout(() => {
      router.push("/sign-in");
    }, 3000);

    return () => clearTimeout(timer);
  }, [router]);

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
            <Link href="/#request-access">Request access</Link>
          </Button>
        </div>
      </header>
      <section className="mx-auto grid max-w-[1080px] gap-8 px-4 py-14 lg:grid-cols-[1fr_380px] lg:px-6">
        <div>
          <div className="inline-flex h-7 items-center rounded-full bg-[#f1f8ee] px-3 text-[12.5px] font-medium text-[#17540f]">
            Invite-only workspaces
          </div>
          <h1 className="mt-6 max-w-xl text-[44px] font-semibold leading-[1.06] tracking-normal">
            Account creation requires an invite.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            OpenBooks is invite-only. If you have an invite link from your workspace owner or a team member, use that link to create your account.
          </p>
        </div>
        <div className="mx-auto w-full max-w-sm">
          <div className="rounded-lg border bg-card p-5 shadow-xs">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="size-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">No direct sign-up</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  New accounts can only be created via an invite link. Ask your workspace owner for an invitation.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <Button asChild className="w-full">
                <Link href="/sign-in">Sign in to existing account</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/">Back to home</Link>
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Redirecting to sign-in in 3 seconds...
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
