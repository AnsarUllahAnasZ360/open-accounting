"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, KeyRound, UserRound } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/openbooks/primitives";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "America/Denver",
  "Europe/London",
  "Asia/Karachi",
  "Asia/Kolkata",
  "UTC",
];

const AVATAR_COLORS = [
  { label: "Ledger green", value: "#17540f" },
  { label: "OpenBooks green", value: "#2ca01c" },
  { label: "Graphite", value: "#454545" },
  { label: "Neutral", value: "#525252" },
  { label: "Amber", value: "#b54708" },
];

type ProfileData = NonNullable<FunctionReturnType<typeof api.profile.me>>;

export function ProfileScreen() {
  const data = useQuery(api.profile.me, {});

  if (data === undefined) {
    return (
      <div className="space-y-5">
        <PageHeader title="Profile" description="Your identity inside OpenBooks" />
        <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">
          Loading profile...
        </div>
      </div>
    );
  }

  return <ProfileForm data={data as ProfileData} />;
}

function ProfileForm({ data }: { data: ProfileData }) {
  const update = useMutation(api.profile.update);
  const [displayName, setDisplayName] = useState(data.profile.displayName);
  const [timezone, setTimezone] = useState(data.profile.timezone);
  const [avatarColor, setAvatarColor] = useState(data.profile.avatarColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const initials = useMemo(() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
    return displayName.trim().slice(0, 2).toUpperCase() || data.profile.initials;
  }, [data.profile.initials, displayName]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await update({ displayName, timezone, avatarColor });
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="profile-screen">
      <PageHeader title="Profile" description="Your identity inside OpenBooks" />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <form className="rounded-[14px] border bg-card p-5 shadow-xs" onSubmit={onSubmit}>
          <div className="flex items-start gap-3">
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: avatarColor }}
              data-testid="profile-avatar"
            >
              {initials}
            </span>
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight">Personal details</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This is how your name appears in the sidebar, team list, and audit trail.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="profile-display-name">Display name</Label>
              <Input
                id="profile-display-name"
                data-testid="profile-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" value={data.user.email ?? ""} readOnly />
            </div>

            <div className="grid gap-2">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger data-testid="profile-timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Avatar color</Label>
              <div className="flex flex-wrap gap-2" data-testid="profile-avatar-colors">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    aria-label={color.label}
                    data-active={avatarColor === color.value ? "true" : "false"}
                    onClick={() => setAvatarColor(color.value)}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border transition-colors",
                      avatarColor === color.value ? "border-foreground" : "border-transparent",
                    )}
                    style={{ backgroundColor: color.value }}
                  >
                    {avatarColor === color.value ? <Check className="size-4 text-white" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
          {saved ? <p className="mt-4 text-sm text-primary" data-testid="profile-saved">Profile saved.</p> : null}

          <div className="mt-5 flex justify-end">
            <Button type="submit" disabled={busy} data-testid="profile-save">
              {busy ? "Saving..." : "Save profile"}
            </Button>
          </div>
        </form>

        <div className="space-y-5">
          <section className="rounded-[14px] border bg-card p-5 shadow-xs">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UserRound className="size-4" />
              </span>
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight">Workspace access</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your role controls what actions are available in each workspace.
                </p>
              </div>
            </div>
            <div className="mt-4 divide-y rounded-[10px] border" data-testid="profile-memberships">
              {data.memberships.map((membership) => (
                <div key={membership.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{membership.workspaceName}</span>
                    <span className="block text-[11.5px] text-muted-foreground">Joined workspace</span>
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-medium">
                    {membership.roleLabel}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[14px] border bg-card p-5 shadow-xs">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <KeyRound className="size-4" />
              </span>
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight">Password</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Password reset needs the email reset provider before OpenBooks can change credentials from this page.
                </p>
              </div>
            </div>
            <Button className="mt-4 w-full" variant="outline" disabled data-testid="profile-password-disabled">
              Password reset not enabled
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
