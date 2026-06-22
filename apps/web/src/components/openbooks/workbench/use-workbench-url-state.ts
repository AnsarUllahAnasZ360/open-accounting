"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * URL-synced toolbar state (Epic E0.4). Period / search / filters / saved-view
 * live in the URL query string so they survive sub-tab switches and deep-links
 * (acceptance #4). Values are written with `router.replace` (history-preserving,
 * no scroll jump) so changing a filter does not push a new history entry per
 * keystroke.
 *
 * Sidebar child navigation changes only the PATH, so the query string — and
 * therefore this state — carries across section subroutes for
 * free. This hook is intentionally minimal and non-breaking: a section reads a
 * param with `get`, writes one with `set`, and may seed local state from the
 * initial URL without becoming fully URL-controlled.
 */
export function useWorkbenchUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A stable snapshot string so callers can memoize against "the current query".
  const queryString = searchParams.toString();

  // Hold the latest pathname/query in a ref so `setParams` keeps a STABLE
  // identity across renders. Without this, the setter's identity would change on
  // every URL write — re-firing any effect that mirrors state into the URL and
  // risking an update loop. The ref is updated in an effect (never during
  // render) per the react-hooks rules.
  const latest = useRef({ pathname, queryString });
  useEffect(() => {
    latest.current = { pathname, queryString };
  }, [pathname, queryString]);

  const get = useCallback(
    (key: string): string | null => searchParams.get(key),
    [searchParams],
  );

  const getAll = useCallback(
    (key: string): string[] => searchParams.getAll(key),
    [searchParams],
  );

  // Write one or more params. `null`/`""`/`[]` removes the key so cleared
  // filters drop out of the URL instead of lingering as empty params.
  const setParams = useCallback(
    (updates: Record<string, string | string[] | null | undefined>) => {
      const { pathname: currentPath, queryString: currentQuery } = latest.current;
      const next = new URLSearchParams(currentQuery);
      for (const [key, value] of Object.entries(updates)) {
        next.delete(key);
        if (value == null) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            if (v) next.append(key, v);
          }
        } else if (value !== "") {
          next.set(key, value);
        }
      }
      const qs = next.toString();
      // No-op guard: don't replace when nothing actually changed (prevents a
      // redundant history churn / effect re-run on mount).
      if (qs === currentQuery) return;
      router.replace(qs ? `${currentPath}?${qs}` : currentPath, { scroll: false });
    },
    [router],
  );

  const setParam = useCallback(
    (key: string, value: string | string[] | null | undefined) => {
      setParams({ [key]: value });
    },
    [setParams],
  );

  return useMemo(
    () => ({ get, getAll, setParam, setParams, queryString }),
    [get, getAll, setParam, setParams, queryString],
  );
}
