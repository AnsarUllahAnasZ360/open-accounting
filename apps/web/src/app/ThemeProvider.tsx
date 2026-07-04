"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * App-wide theme provider (next-themes). Sets `class="dark"` on <html> so the
 * `.dark` token block in globals.css takes over. `defaultTheme="system"` follows
 * the OS until the owner picks a theme; `disableTransitionOnChange` avoids a
 * color flash when switching.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
