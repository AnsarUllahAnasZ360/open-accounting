"use client";

import { useAction } from "convex/react";
import { CheckCircle2 } from "lucide-react";
import { FormEvent, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type FormState = "idle" | "submitting" | "success" | "error";

export function RequestAccessFormClient() {
  const submitLead = useAction(api.requestAccess.submitAndNotify);
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState("submitting");
    setError("");

    const form = new FormData(formElement);
    try {
      await submitLead({
        email: String(form.get("email") ?? ""),
        name: String(form.get("name") ?? ""),
        company: String(form.get("company") ?? ""),
        message: String(form.get("message") ?? ""),
        source: "landing",
      });
      formElement.reset();
      setState("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request could not be saved.");
      setState("error");
    }
  }

  return (
    <form className="rounded-lg border bg-card p-4 shadow-xs" onSubmit={onSubmit}>
      <div className="mb-4">
        <h2 className="text-base font-semibold">Request access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us where OpenBooks should help first.
        </p>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="company">Company</Label>
          <Input id="company" name="company" autoComplete="organization" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="message">What should OpenBooks help with?</Label>
          <Textarea id="message" name="message" rows={3} />
        </div>
      </div>
      <Button className="mt-4 w-full" disabled={state === "submitting"} type="submit">
        {state === "submitting" ? "Saving request" : "Request access"}
      </Button>
      {state === "success" ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border bg-primary/5 p-3 text-sm text-primary">
          <CheckCircle2 className="mt-0.5 size-4" />
          <span>Request saved. Ansar can review it from Settings once M2 lands.</span>
        </div>
      ) : null}
      {state === "error" ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </form>
  );
}
