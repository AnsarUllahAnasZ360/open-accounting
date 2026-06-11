"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type State = "idle" | "submitting" | "error";

const INVITE_ONLY_MESSAGE = "OpenBooks is invite-only. Request access from the landing page.";

export function SignInForm() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

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
      router.push("/dashboard");
    } catch {
      try {
        await signIn("password", {
          email,
          password,
          name,
          flow: "signUp",
        });
        router.push("/dashboard");
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "";
        setError(message.includes("OpenBooks is invite-only") ? message : INVITE_ONLY_MESSAGE);
        setState("error");
      }
    }
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
            Invite-only while the ledger core is being verified.
          </p>
        </div>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
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
        {state === "submitting" ? "Checking access" : "Sign in"}
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
