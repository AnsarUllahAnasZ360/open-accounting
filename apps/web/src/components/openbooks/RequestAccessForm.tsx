import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RequestAccessFormClient } from "./RequestAccessFormClient";

function StaticRequestAccessForm() {
  return (
    <form className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="mb-4">
        <h2 className="text-base font-semibold">Request access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          OpenBooks is invite-only while the ledger core is being verified.
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
      <button
        className="mt-4 h-8 w-full rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground opacity-60"
        disabled
        type="button"
      >
        Request access
      </button>
      <p className="mt-3 text-sm text-muted-foreground">
        Intake storage activates when the Convex app URL is configured.
      </p>
    </form>
  );
}

export function RequestAccessForm() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <StaticRequestAccessForm />;
  }

  return <RequestAccessFormClient />;
}
