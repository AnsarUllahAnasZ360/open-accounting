"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type State = "idle" | "submitting" | "error";

export function SignInForm({
  devAuthBypass = false,
  defaultEmail = "",
  lockEmail = false,
  submitLabel = "Sign in",
}: {
  devAuthBypass?: boolean;
  defaultEmail?: string;
  lockEmail?: boolean;
  submitLabel?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const resetCode = searchParams.get("code");
  const resetEmail = searchParams.get("email") ?? defaultEmail;
  // Clone-the-demo intent (Epic E4-T10). The public /demo "Clone this to your own
  // account" CTA links here with ?demo=1. We carry that intent through sign-up so
  // the post-auth landing can pre-seed onboarding with demo data — the demo
  // pre-seed backend is owned by E11; this is E4's handoff so the signal is not
  // dropped on the floor between the CTA and onboarding.
  const fromDemoClone = searchParams.get("demo") === "1";
  const postAuthRoute = fromDemoClone ? "/dashboard?demo=1" : "/dashboard";

  async function onResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetCode) return;
    setState("submitting");
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const newPassword = String(form.get("newPassword") ?? "");
    try {
      await signIn("password", {
        email,
        code: resetCode,
        newPassword,
        flow: "reset-verification",
      });
      router.push("/dashboard");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(message || "Could not reset this password. Request a fresh reset email.");
      setState("error");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setError("");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    try {
      await signIn("password", {
        email,
        password,
        flow: "signIn",
      });
      router.push(postAuthRoute);
    } catch {
      try {
        await signIn("password", {
          email,
          password,
          name,
          flow: "signUp",
        });
        router.push(postAuthRoute);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "";
        setError(message || "Check your email and password, or create a new OpenBooks account.");
        setState("error");
      }
    }
  }

  if (resetCode) {
    return (
      <form className="rounded-lg border bg-card p-5 shadow-xs" onSubmit={onResetSubmit}>
        <div className="mb-5 flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockKeyhole className="size-4" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Reset password</h1>
            <p className="mt-1 text-sm text-muted-foreground">Choose a new password for your OpenBooks account.</p>
          </div>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="reset-email">Work email</Label>
            <Input id="reset-email" name="email" type="email" autoComplete="email" defaultValue={resetEmail} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required />
          </div>
        </div>
        <Button className="mt-4 w-full" disabled={state === "submitting"} type="submit">
          {state === "submitting" ? "Updating password" : "Update password"}
          <ArrowRight className="size-4" />
        </Button>
        {state === "error" ? (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </form>
    );
  }

  return (
    <form className="rounded-lg border bg-card p-5 shadow-xs" onSubmit={onSubmit}>
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LockKeyhole className="size-4" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Sign in to OpenBooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start a workspace or join one with an invite.
          </p>
        </div>
      </div>
      {devAuthBypass ? (
        <div className="mb-4 rounded-lg border border-[#dcefd2] bg-[#f1f8ee] p-3">
          <div className="text-sm font-medium text-[#17540f]">Local dev mode is enabled.</div>
          <p className="mt-1 text-sm text-[#3b6f32]">
            Continue as the bootstrapped owner workspace without entering a password.
          </p>
          <Button
            className="mt-3 w-full"
            type="button"
            onClick={() => router.push("/dashboard")}
          >
            Continue as local dev owner
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={defaultEmail}
            readOnly={lockEmail}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" />
        </div>
      </div>
      <Button className="mt-4 w-full" disabled={state === "submitting"} type="submit">
        {state === "submitting" ? "Checking access" : submitLabel}
        <ArrowRight className="size-4" />
      </Button>
      {state === "error" ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </form>
  );
}
