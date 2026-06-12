"use client";

import { useMutation, useQuery } from "convex/react";
import { Copy, Mail } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function avatar(initials: string, pending: boolean) {
  return pending ? ["#fffaeb", "#b54708"] : ["#f0f0f0", "#525252"];
}

export function TeamSection() {
  const data = useQuery(api.team.list, {});

  if (data === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading team…</div>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="team-section">
      <div className="overflow-hidden rounded-[14px] border bg-card shadow-xs">
        {data.members.map((member) => {
          const [bg, fg] = member.role === "owner" ? ["#17540f", "#ffffff"] : avatar(member.initials, member.pending);
          return (
            <div key={member.id} className="flex items-center gap-3 border-t px-[18px] py-3.5 first:border-t-0" data-testid="team-member">
              <span
                className="flex size-[30px] items-center justify-center rounded-full text-[11px] font-semibold"
                style={{ background: bg, color: fg }}
              >
                {member.initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{member.name}</div>
                <div className="text-[11.5px] text-muted-foreground">{member.email}</div>
              </div>
              {member.pending ? (
                <span className="inline-flex h-5 items-center rounded-full bg-[#fffaeb] px-2 text-[10.5px] font-medium text-[#b54708]">Invite sent</span>
              ) : null}
              <span
                title={member.roleDesc}
                className="inline-flex h-6 cursor-help items-center rounded-full bg-muted px-2.5 text-[11.5px] font-medium text-[#525252]"
              >
                {member.roleLabel}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-muted-foreground/80">
        Owner: everything · Staff: transactions, payroll &amp; bills, no settings · Accountant: read everything + journal entries.
      </p>
      {data.canManage ? <InviteModal emailDeliveryConfigured={data.emailDeliveryConfigured} /> : null}
    </div>
  );
}

function InviteModal({ emailDeliveryConfigured }: { emailDeliveryConfigured: boolean }) {
  const invite = useMutation(api.team.invite);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ message: string; inviteUrl: string } | null>(null);

  async function submit() {
    if (!email.trim()) {
      setError("Enter an email.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await invite({ email: email.trim(), role });
      setResult({
        message:
          emailDeliveryConfigured
            ? `Invite ${res.status === "updated" ? "updated" : "sent"} to ${email.trim()}.`
            : `Invite created for ${email.trim()}. Email delivery is wired to Plunk when configured; share this link now.`,
        inviteUrl: res.inviteUrl,
      });
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid="team-invite">
          <Mail className="size-4" /> Invite by email
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="team-invite-modal">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            Creates a pending workspace invite.{" "}
            {emailDeliveryConfigured ? "An email goes out now." : "Email delivery is wired to Plunk when configured."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input data-testid="team-invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
          </div>
          <div className="grid gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger data-testid="team-invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Staff — transactions, payroll &amp; bills</SelectItem>
                <SelectItem value="admin">Accountant — read all + journal entries</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {result ? (
            <div className="rounded-lg border border-[#dcefd2] bg-[#f1f8ee] p-3" data-testid="team-invite-result">
              <p className="text-[12.5px] text-[#17540f]">{result.message}</p>
              <div className="mt-2 flex gap-2">
                <Input data-testid="team-invite-link" value={result.inviteUrl} readOnly />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy invite link"
                  onClick={() => void navigator.clipboard.writeText(result.inviteUrl)}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Close</Button>
          <Button size="sm" data-testid="team-invite-submit" disabled={busy} onClick={submit}>
            {busy ? "Inviting…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
