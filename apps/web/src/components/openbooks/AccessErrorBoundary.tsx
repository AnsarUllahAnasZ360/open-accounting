"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Component, type ReactNode } from "react";

import { WorkspaceUnavailableScreen } from "@/components/openbooks/WorkspaceUnavailableScreen";

/** Whether a thrown error is a workspace access/permission denial from Convex. */
function isAccessDenied(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? "");
  return /access or permission|do not have access/i.test(message);
}

function AccessDeniedFallback() {
  const { signOut } = useAuthActions();
  return <WorkspaceUnavailableScreen onSignOut={() => void signOut()} />;
}

/**
 * Catches "You do not have access or permission…" errors that a Convex query can
 * throw when a user's workspace is deleted or their access is revoked mid-session
 * (Convex `useQuery` surfaces query errors by throwing during render). Instead of
 * the raw Next.js error overlay, it shows the calm "workspace unavailable" card.
 * Any OTHER error is re-thrown so genuine bugs still surface normally.
 */
export class AccessErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      if (isAccessDenied(this.state.error)) return <AccessDeniedFallback />;
      // Not an access issue — let the real error propagate.
      throw this.state.error;
    }
    return this.props.children;
  }
}
