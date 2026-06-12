"use client";

import { createContext, useContext, type ReactNode } from "react";

export type ActiveEntity = {
  id?: string;
  name: string;
  currency?: string;
  isDemo?: boolean;
};

export type EntityOption = {
  id?: string;
  name: string;
  currency?: string;
  isDemo?: boolean;
  active: boolean;
};

export type ActiveEntityContextValue = {
  workspaceName: string;
  role: string;
  activeEntity: ActiveEntity;
  entities: EntityOption[];
  selectEntity: (entityId: string) => void;
};

const FALLBACK: ActiveEntityContextValue = {
  workspaceName: "open books",
  role: "member",
  activeEntity: { name: "Your business" },
  entities: [],
  selectEntity: () => {},
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
