"use client";
import { I18nProvider } from "@/lib/i18n";
import { SelectionProvider } from "@/lib/ctx";
import { ToastProvider } from "./ui";
export default function Providers({ children }: { children: React.ReactNode }) {
  return <I18nProvider><SelectionProvider><ToastProvider>{children}</ToastProvider></SelectionProvider></I18nProvider>;
}
