"use client";

import { useCallback, useState } from "react";

/**
 * A persisted "Data view": a named snapshot of a surface's filter state. The
 * filter shape is owned by the consuming screen (generic `TFilters`), so this
 * store stays surface-agnostic. Persistence is per browser via localStorage —
 * the SavedViews UI is written against these helpers so a future Convex-backed
 * (cross-device) store is a drop-in swap with the same shape.
 */
export type SavedView<TFilters> = {
  id: string;
  name: string;
  builtIn?: boolean;
  filters: TFilters;
};

const VERSION = 1;

function storageKey(surface: string, entityId: string) {
  return `openbooks.savedViews.${surface}.${entityId}`;
}

export function createViewId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `view_${Math.random().toString(36).slice(2)}`;
}

export function loadSavedViews<TFilters>(surface: string, entityId: string): SavedView<TFilters>[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(surface, entityId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; views?: SavedView<TFilters>[] };
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.views)) return [];
    return parsed.views;
  } catch {
    return [];
  }
}

export function saveSavedViews<TFilters>(
  surface: string,
  entityId: string,
  views: SavedView<TFilters>[],
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(surface, entityId),
      JSON.stringify({ version: VERSION, views }),
    );
  } catch {
    // Private mode / quota — saved views are a convenience, never block the UI.
  }
}

/**
 * Manage a surface's USER-created views in localStorage. Built-in views are
 * merged ahead of these by the screen, so this hook only owns mutable state.
 */
export function useSavedViews<TFilters>(surface: string, entityId: string | undefined) {
  const [userViews, setUserViews] = useState<SavedView<TFilters>[]>([]);
  // Load from localStorage when the (surface, entity) key changes, via the
  // render-phase "adjust state on input change" pattern rather than an effect.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = entityId ? `${surface}:${entityId}` : null;
  if (key !== loadedKey) {
    setLoadedKey(key);
    setUserViews(entityId ? loadSavedViews<TFilters>(surface, entityId) : []);
  }

  const persist = useCallback(
    (next: SavedView<TFilters>[]) => {
      setUserViews(next);
      if (entityId) saveSavedViews(surface, entityId, next);
    },
    [surface, entityId],
  );

  const add = useCallback(
    (name: string, filters: TFilters) => {
      const view: SavedView<TFilters> = { id: createViewId(), name, filters };
      persist([...userViews, view]);
      return view;
    },
    [persist, userViews],
  );

  const remove = useCallback(
    (id: string) => persist(userViews.filter((view) => view.id !== id)),
    [persist, userViews],
  );

  const rename = useCallback(
    (id: string, name: string) =>
      persist(userViews.map((view) => (view.id === id ? { ...view, name } : view))),
    [persist, userViews],
  );

  const replaceFilters = useCallback(
    (id: string, filters: TFilters) =>
      persist(userViews.map((view) => (view.id === id ? { ...view, filters } : view))),
    [persist, userViews],
  );

  return { userViews, add, remove, rename, replaceFilters };
}
