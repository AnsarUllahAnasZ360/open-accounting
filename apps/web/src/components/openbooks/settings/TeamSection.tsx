"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Copy, Mail, Trash2 } from "lucide-react";
// ConvexError surfaces its `.data` payload on the client; we read it when present
// (clear server messages like the last-owner guard) and fall back to `.message`.
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Avatar tint by role/state, routed through semantic tokens: the owner wears the
// one brand green; a pending invite uses the warning surface; everyone else is
// neutral.
function avatarTint(role: string, pending: boolean) {
  if (role === "owner") return "bg-ob-green-800 text-white";
  if (pending) return "bg-warning-surface text-warning";
  return "bg-muted text-muted-foreground";
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof ConvexError) return String(err.data);
  if (err instanceof Error) return err.message;
  return fallback;
}

type ManageableRole = "owner" | "accountant" | "hr";

export function TeamSection() {
  const data = useQuery(api.team.list, {});

  if (data === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading team…</div>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="team-section">
      <div className="overflow-hidden rounded-[14px] border bg-card shadow-xs">
        {data.members.map((member) => (
          <MemberRow key={member.id} member={member} canManage={data.canManage} />
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground/80">
        Owner: everything · Accountant: books, reports, rules, imports, and ledger corrections · HR: payroll only.
      </p>
      {data.canManage ? <InviteModal emailDeliveryConfigured={data.emailDeliveryConfigured} /> : null}
    </div>
  );
}

type MemberRowData = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  roleDesc: string;
  initials: string;
  pending: boolean;
  isLastOwner: boolean;
  isSelf: boolean;
};

function MemberRow({ member, canManage }: { member: MemberRowData; canManage: boolean }) {
  const changeRole = useMutation(api.team.changeRole);
  const removeMember = useMutation(api.team.removeMember);
  const revokeInvite = useMutation(api.team.revokeInvite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The last owner can be neither demoted nor removed (server enforces this too).
  const roleLocked = !canManage || member.isLastOwner;

  async function onRoleChange(next: ManageableRole) {
    if (next === member.role) return;
    setBusy(true);
    setError("");
    try {
      await changeRole({ memberId: member.id as Id<"workspaceMembers">, newRole: next });
    } catch (err) {
      setError(errorMessage(err, "Could not change the role."));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    setError("");
    try {
      await removeMember({ memberId: member.id as Id<"workspaceMembers"> });
      setConfirmOpen(false);
    } catch (err) {
      setError(errorMessage(err, "Could not remove the member."));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke() {
    setBusy(true);
    setError("");
    try {
      await revokeInvite({ inviteId: member.id as Id<"invites"> });
    } catch (err) {
      setError(errorMessage(err, "Could not revoke the invite."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-t px-[18px] py-3.5 first:border-t-0"
      data-testid="team-member"
      data-pending={member.pending ? "true" : "false"}
    >
      <span
        className={cn(
          "flex size-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
          avatarTint(member.role, member.pending),
        )}
      >
        {member.initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{member.name}</div>
        <div className="text-[11.5px] text-muted-foreground">{member.email}</div>
        {error ? <div className="mt-1 text-[11.5px] text-destructive" data-testid="team-member-error">{error}</div> : null}
      </div>

      {member.pending ? (
        <>
          <span className="inline-flex h-5 items-center rounded-full bg-warning-surface px-2 text-[10.5px] font-medium text-warning">
            Invite sent
          </span>
          <span
            title={member.roleDesc}
            className="inline-flex h-6 cursor-help items-center rounded-full bg-muted px-2.5 text-[11.5px] font-medium text-muted-foreground"
          >
            {member.roleLabel}
          </span>
          {canManage ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[12px] text-muted-foreground hover:text-destructive"
              data-testid="team-revoke-invite"
              disabled={busy}
              onClick={onRevoke}
            >
              Revoke
            </Button>
          ) : null}
        </>
      ) : roleLocked ? (
        <span
          title={member.isLastOwner ? "The last owner can't be demoted." : member.roleDesc}
          className="inline-flex h-6 cursor-help items-center rounded-full bg-muted px-2.5 text-[11.5px] font-medium text-muted-foreground"
          data-testid="team-role-locked"
        >
          {member.roleLabel}
        </span>
      ) : (
        <>
          <Select
            value={member.role}
            onValueChange={(v) => void onRoleChange(v as ManageableRole)}
            disabled={busy}
          >
            <SelectTrigger className="h-8 w-[150px]" data-testid="team-role-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="accountant">Accountant</SelectItem>
                <SelectItem value="hr">HR</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${member.name}`}
                data-testid="team-remove"
                disabled={busy}
              >
                <Trash2 className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="team-remove-modal">
              <DialogHeader>
                <DialogTitle>Remove {member.name}?</DialogTitle>
                <DialogDescription>
                  They lose all access to this workspace immediately. Their past entries and audit history stay intact —
                  removal never rewrites the books.
                </DialogDescription>
              </DialogHeader>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="team-remove-confirm"
                  disabled={busy}
                  onClick={onRemove}
                >
                  {busy ? "Removing…" : "Remove member"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function InviteModal({ emailDeliveryConfigured }: { emailDeliveryConfigured: boolean }) {
  const invite = useMutation(api.team.invite);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"accountant" | "hr">("hr");
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
      setError(errorMessage(err, "Could not create the invite."));
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
                <SelectGroup>
                  <SelectItem value="hr">HR — payroll only</SelectItem>
                  <SelectItem value="accountant">Accountant — books, imports, reports &amp; ledger corrections</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {result ? (
            <div className="rounded-lg border border-ob-green-100 bg-ob-green-50 p-3" data-testid="team-invite-result">
              <p className="text-[12.5px] text-ob-green-800">{result.message}</p>
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
