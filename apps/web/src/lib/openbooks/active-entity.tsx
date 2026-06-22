"use client";

import { createContext, useContext, type ReactNode } from "react";

export type ActiveEntity = {
  id?: string;
  name: string;
  currency?: string;
  isDemo?: boolean;
  // Set when the portfolio scope ('All businesses') is active. A synthetic
  // entity with NO id (Epic E5-T2/T3).
  isPortfolio?: boolean;
};

export type EntityOption = {
  id?: string;
  name: string;
  currency?: string;
  isDemo?: boolean;
  active: boolean;
};

/**
 * First-class scope value (Epic E5-T2). `'all'` is the portfolio mode (aggregate
 * every active entity in the workspace); the object form targets a single
 * entity. This mirrors the server-side `scopeValidator` in convex/entityScope.ts.
 *
 * Note: this lives in the ActiveEntity context as the converged scope provider.
 * If/when E12-T8 ships a dedicated `useActiveScope()`, this is the single seam to
 * unify against — do NOT ship two scope providers.
 */
export type Scope = "all" | { entityId: string };

export type ActiveEntityContextValue = {
  workspaceName: string;
  role: string;
  activeEntity: ActiveEntity;
  entities: EntityOption[];
  selectEntity: (entityId: string) => void;
  // Portfolio scope (Epic E5-T2). `scope === 'all'` renders the portfolio
  // roll-up; the object form is a single business. `selectScope` persists the
  // choice across reload.
  scope: Scope;
  selectScope: (scope: Scope) => void;
};

const FALLBACK: ActiveEntityContextValue = {
  workspaceName: "open books",
  role: "member",
  activeEntity: { name: "Your business" },
  entities: [],
  selectEntity: () => {},
  scope: "all",
  selectScope: () => {},
};

const ActiveEntityContext = createContext<ActiveEntityContextValue>(FALLBACK);

export function ActiveEntityProvider({
  value,
  children,
}: {
  value: ActiveEntityContextValue;
  children: ReactNode;
}) {
  return <ActiveEntityContext.Provider value={value}>{children}</ActiveEntityContext.Provider>;
}

export function useActiveEntity() {
  return useContext(ActiveEntityContext);
}

/**
 * Portfolio scope hook (Epic E5-T2). Convenience accessor for the scope value +
 * setter so consumers don't need the whole ActiveEntity context. This is the
 * `useActiveScope()` seam referenced by E5/E12 — kept colocated with the
 * provider so there is exactly one scope source.
 */
export function useActiveScope(): { scope: Scope; selectScope: (scope: Scope) => void } {
  const { scope, selectScope } = useContext(ActiveEntityContext);
  return { scope, selectScope };
}

/**
 * Translate a scope into the `entityArg`-shaped object every screen query
 * expects (Epic E5-T2). Returns `{}` for portfolio scope (until each per-view
 * portfolio backend lands in E5-T6/T8, 'all' temporarily resolves to the
 * deterministic default entity server-side, so no data regresses) or
 * `{ entityId }` for a single entity. Generalizes the old `entityArg` helper.
 */
export function scopeArg(scope: Scope): { entityId?: string } {
  if (scope === "all") return {};
  return { entityId: scope.entityId };
}
