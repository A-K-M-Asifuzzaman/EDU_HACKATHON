"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { Logo } from "@/components/icons";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="card mx-auto mt-12 max-w-md p-8 text-center">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-navy"><Logo size={34} /></div>
      <div className="num text-[44px] font-bold leading-none tracking-tight text-navy">404</div>
      <h1 className="mt-2 text-xl font-bold text-forest">{t("nf.title")}</h1>
      <p className="mt-1.5 text-sm text-ink-2">{t("nf.body")}</p>
      <Link className="mt-5 inline-flex items-center justify-center rounded-xl bg-emerald px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-d" href="/">{t("nf.home")}</Link>
    </div>);
}
