"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";

import { Amount } from "@/components/openbooks/primitives";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Animate an integer from its previous value to the next on change, using rAF
 * with an ease-out curve. Honors `prefers-reduced-motion` (snaps instantly).
 * Returns the integer to display this frame.
 */
export function useCountUp(value: number, durationMs = 600) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (fromRef.current === value) return;
    if (prefersReducedMotion()) {
      fromRef.current = value;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snap to value when the OS requests reduced motion (external-system sync).
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return display;
}

/**
 * A number that counts up to its value on change. `format` turns the integer
 * into the display string (e.g. minor-unit money via formatMinorMoney).
 */
export function AnimatedNumber({
  value,
  format,
  className,
  durationMs = 600,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  durationMs?: number;
}) {
  const display = useCountUp(value, durationMs);
  return <span className={className}>{format(display)}</span>;
}

/**
 * Drop-in for {@link Amount} that counts the figure up on change — reuses
 * Amount's currency formatting, tabular figures, and income/expense tone, so it
 * stays visually identical, just animated. Use for hero/KPI money figures.
 */
export function AnimatedAmount({
  amountMinor,
  durationMs = 600,
  ...rest
}: ComponentProps<typeof Amount> & { durationMs?: number }) {
  const display = useCountUp(amountMinor, durationMs);
  return <Amount amountMinor={display} {...rest} />;
}
