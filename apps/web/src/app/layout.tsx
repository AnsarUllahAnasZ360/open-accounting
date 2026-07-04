import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { DensityProvider } from "@/components/openbooks/DensityProvider";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ThemeProvider } from "./ThemeProvider";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenBooks",
  description: "Open-source AI-assisted bookkeeping for small service businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      {/* suppressHydrationWarning: browser extensions (password managers,
          shortcut listeners, etc.) inject attributes like `cz-shortcut-listen`
          onto <body> before React hydrates, which would otherwise log a
          harmless hydration mismatch. */}
      <body className="flex min-h-full flex-col antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <DensityProvider>
            <ConvexClientProvider>{children}</ConvexClientProvider>
            <Toaster />
          </DensityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
