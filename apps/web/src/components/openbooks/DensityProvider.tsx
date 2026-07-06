"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Density = "comfortable" | "compact";

const STORAGE_KEY = "ob:density";

type DensityContextValue = {
  density: Density;
  setDensity: (density: Density) => void;
  toggle: () => void;
};

const DensityContext = createContext<DensityContextValue>({
  density: "comfortable",
  setDensity: () => {},
  toggle: () => {},
});

/**
 * Information density for power users: "comfortable" (default) vs "compact"
 * (tighter table rows / spacing). Persisted to localStorage and reflected as
 * `data-density` on <html>, which the `[data-density="compact"]` CSS in
 * globals.css keys off (see `--ob-row-py`).
 */
export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>("comfortable");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // ignore storage access errors
    }
    if (stored === "compact" || stored === "comfortable") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the persisted density after hydration (external-system sync).
      setDensityState(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
  }, [density]);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage access errors
    }
  }, []);

  const toggle = useCallback(
    () => setDensity(density === "compact" ? "comfortable" : "compact"),
    [density, setDensity],
  );

  return (
    <DensityContext.Provider value={{ density, setDensity, toggle }}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity() {
  return useContext(DensityContext);
}
