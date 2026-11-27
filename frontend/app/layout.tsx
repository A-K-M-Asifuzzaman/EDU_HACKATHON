import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/providers";
import Shell from "@/components/shell";
import { THEME_BOOT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "DengueShield AI — Predict Earlier. Respond Smarter.",
  description: "Ward-level dengue forecasting 2–4 weeks ahead: Historical Replay on the EDU AI Engineering Hackathon 2026 dataset.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/icon.svg",
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2f2a8f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head><body><a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
    <Providers><Shell>{children}</Shell></Providers></body></html>);
}
