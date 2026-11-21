import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/providers";
import Shell from "@/components/shell";

export const metadata: Metadata = { title: "DengueShield AI — Predict Earlier. Respond Smarter.", description: "Ward-level dengue forecasting 2–4 weeks ahead: Historical Replay on the EDU AI Engineering Hackathon 2026 dataset." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#073b2b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
    <Providers><Shell>{children}</Shell></Providers></body></html>);
}
