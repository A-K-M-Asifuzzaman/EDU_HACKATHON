"use client";
import { I18nProvider } from "@/lib/i18n";
import { SelectionProvider } from "@/lib/ctx";
import { ToastProvider } from "./ui";
import { AuthProvider } from "@/lib/auth";
export default function Providers({ children }: { children: React.ReactNode }) {
  return <I18nProvider><SelectionProvider><ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider></SelectionProvider></I18nProvider>;
}
