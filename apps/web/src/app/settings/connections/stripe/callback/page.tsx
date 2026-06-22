import { Suspense } from "react";

import { AppShell } from "@/components/openbooks/AppShell";
import { StripeOAuthCallback } from "@/components/openbooks/StripeOAuthCallback";

export default function StripeCallbackPage() {
  return (
    <AppShell>
      <div className="flex w-full flex-col gap-5">
        <Suspense fallback={<div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading Stripe callback...</div>}>
          <StripeOAuthCallback />
        </Suspense>
      </div>
    </AppShell>
  );
}
