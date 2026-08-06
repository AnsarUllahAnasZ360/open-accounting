"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { mapAuthError } from "@/lib/auth-errors";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type State = "idle" | "submitting" | "error";

export function SignUpForm({
  defaultEmail = "",
  lockEmail = false,
  submitLabel = "Create account",
}: {
  defaultEmail?: string;
  lockEmail?: boolean;
  submitLabel?: string;
}) {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordsMatch, setPasswordsMatch] = useState(true);

  function validatePassword(password: string): string {
    if (!password) return "";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return "";
  }

  function onPasswordChange(e: React.ChangeEvent<HTMLInputElement>) {
    const password = e.currentTarget.value;
    const error = validatePassword(password);
    setPasswordError(error);
  }

  function onConfirmPasswordChange(
    e: React.ChangeEvent<HTMLInputElement>,
    password: string
  ) {
    const confirmPassword = e.currentTarget.value;
    setPasswordsMatch(password === confirmPassword);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPasswordError("");
    setPasswordsMatch(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    const name = String(form.get("name") ?? "").trim();

    // Validate password
    const passError = validatePassword(password);
    if (passError) {
      setPasswordError(passError);
      return;
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      setPasswordsMatch(false);
      return;
    }

    setState("submitting");

    try {
      await signIn("password", {
        email,
        password,
        name,
        flow: "signUp",
      });
      router.push("/dashboard");
    } catch (caught) {
      const message = mapAuthError(caught);
      setError(message);
      setState("error");
    }
  }

  return (
    <form className="rounded-lg border bg-card p-5 shadow-xs" onSubmit={onSubmit}>
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LockKeyhole className="size-4" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Create OpenBooks Account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lockEmail
              ? "Set up your account with the invited email"
              : "Sign up to start a new workspace or join with an invite"}
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="signup-email">Work email</Label>
          <Input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={defaultEmail}
            readOnly={lockEmail}
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            onChange={onPasswordChange}
            required
          />
          {passwordError && (
            <div className="text-xs text-destructive">{passwordError}</div>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="signup-confirm-password">Confirm password</Label>
          <Input
            id="signup-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            onChange={(e) => {
              const password = (
                document.getElementById("signup-password") as HTMLInputElement
              )?.value;
              onConfirmPasswordChange(e, password);
            }}
            required
          />
          {!passwordsMatch && (
            <div className="text-xs text-destructive">
              Passwords don't match.
            </div>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="signup-name">Name (optional)</Label>
          <Input id="signup-name" name="name" autoComplete="name" />
        </div>
      </div>

      <Button
        className="mt-4 w-full"
        disabled={
          state === "submitting" ||
          !!passwordError ||
          !passwordsMatch
        }
        type="submit"
      >
        {state === "submitting" ? "Creating account" : submitLabel}
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
