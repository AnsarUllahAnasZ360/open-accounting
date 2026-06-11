import Link from "next/link";

import { SignInForm } from "@/components/openbooks/SignInForm";
import { Button } from "@/components/ui/button";

export default function SignInPage() {
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

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
            Owner and invited users only
          </div>
          <h1 className="mt-6 max-w-xl text-[44px] font-semibold leading-[1.06] tracking-normal">
            Your books stay private until the ledger is ready.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            OpenBooks keeps public sign-up disabled. The owner account is bootstrapped from the configured env
            credential, and every other user must be invited or request access first.
          </p>
        </div>
        {convexConfigured ? (
          <SignInForm />
        ) : (
          <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground shadow-xs">
            Configure `NEXT_PUBLIC_CONVEX_URL` to activate sign-in locally.
          </div>
        )}
      </section>
    </main>
  );
}
