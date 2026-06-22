"use client";

import { useEffect, useState } from "react";

/**
 * Tracks whether the viewport is below the lg breakpoint (1024px), the line at
 * which slide-overs switch from a right-side Sheet to a bottom Drawer. SSR-safe:
 * starts false and corrects on mount.
 */
export function useIsMobile(query = "(max-width: 1023px)") {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return isMobile;
}
