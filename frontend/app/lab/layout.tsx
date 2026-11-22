import type { Metadata } from "next";

// gives this page its own browser-tab title (every page used to share the site title)
export const metadata: Metadata = { title: "AI Forecast Lab · DengueShield AI" };

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
