"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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
        setError(message || "Check your email and password, or create a new OpenBooks account.");
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
