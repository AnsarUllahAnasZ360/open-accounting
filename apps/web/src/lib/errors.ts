import { ConvexError } from "convex/values";
import { toast } from "sonner";

const DEFAULT_FALLBACK = "Something went wrong. Please try again.";

/**
 * Strip Convex's transport decoration from a raw error message so the owner sees
 * a plain sentence instead of "[CONVEX M(entities:create)] [Request ID: …]
 * Server Error Uncaught ConvexError: … at handler (../convex/entities.ts:156)".
 *
 * Used for plain `throw new Error(...)` server errors (which arrive as a single
 * decorated string). Application errors thrown via `ConvexError` carry a clean
 * payload in `.data` and are handled before this ever runs.
 */
function stripConvexDecoration(raw: string): string {
  let message = raw;
  // Drop the stack trace — everything from the first "\n    at …" line onward.
  const stackAt = message.search(/\n\s*at\s/);
  if (stackAt >= 0) message = message.slice(0, stackAt);
  message = message
    .replace(/\[CONVEX[^\]]*\]/gi, "")
    .replace(/\[Request ID:[^\]]*\]/gi, "")
    .replace(/Uncaught\s+(Convex)?Error:?/gi, "")
    .replace(/Server Error:?/gi, "")
    .trim();
  // Collapse any leftover internal whitespace/newlines into single spaces.
  message = message.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  return message;
}

/**
 * Resolve any thrown value into a clean, owner-facing message.
 *
 * Order of preference:
 *   1. `ConvexError.data` — the deliberate, user-facing payload our mutations
 *      throw (a string, or an object with a `.message`/`.code`).
 *   2. A de-decorated `Error.message` (plain server `throw new Error`).
 *   3. A plain string error.
 *   4. The provided fallback.
 */
export function getErrorMessage(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      if (typeof record.message === "string" && record.message.trim()) {
        return record.message.trim();
      }
    }
    // ConvexError with a non-string payload — fall back to its decorated message.
    if (error.message) {
      const cleaned = stripConvexDecoration(error.message);
      if (cleaned) return cleaned;
    }
    return fallback;
  }
  if (error instanceof Error && error.message) {
    const cleaned = stripConvexDecoration(error.message);
    return cleaned || fallback;
  }
  if (typeof error === "string" && error.trim()) {
    return stripConvexDecoration(error) || fallback;
  }
  return fallback;
}

/**
 * Convenience for the common `catch` body: surface a clean message as a toast
 * and return it (so callers can also keep an inline status line if they want).
 */
export function toastError(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
  const message = getErrorMessage(error, fallback);
  toast.error(message);
  return message;
}
