"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useI18n } from "@/lib/i18n";
import { useSel } from "@/lib/ctx";
import { dateFmt, cls } from "@/lib/format";
import { Icon, Logo } from "./icons";
import { ProvChip } from "./ui";
import { CopilotFab } from "./chat";
import Emergency from "./emergency";
import Intro from "./intro";

const NAV = [["/", "nav.command", "command"], ["/profiling/", "nav.profiling", "profiling"], ["/wards/", "nav.wards", "wards"], ["/geography/", "nav.geography", "geography"], ["/lab/", "nav.lab", "lab"], ["/copilot/", "nav.copilot", "copilot"],
  ["/evidence/", "nav.evidence", "evidence"], ["/response/", "nav.response", "response"], ["/climate/", "nav.climate", "climate"], ["/learn/", "nav.learn", "learn"], ["/provenance/", "nav.provenance", "provenance"]] as const;

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const { t, lang, setLang } = useI18n();
  const { meta, error } = useSel();
  const [open, setOpen] = useState(false);
  const isActive = (h: string) => (h === "/" ? path === "/" : path.startsWith(h.slice(0, -1)));
  const nav = (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map(([href, key, icon]) => { const a = isActive(href); return (
        <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={a ? "page" : undefined}
          className={cls("group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition", a ? "text-white" : "text-mint/80 hover:text-white")}>
          {a && <motion.span layoutId="navpill" className="absolute inset-0 rounded-xl bg-white/12 ring-1 ring-white/15" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
          <Icon name={icon} size={18} className="relative" /><span className="relative">{t(key)}</span></Link>); })}
    </nav>);
  const side = (
    <div className="flex h-full flex-col bg-[radial-gradient(120%_80%_at_0%_0%,#0d5a42_0%,#073b2b_55%,#052a1f_100%)] p-4 text-white">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-1"><Logo /><div><div className="text-[17px] font-bold leading-none tracking-tight">DengueShield <span className="text-mint">AI</span></div>
        <div className="mt-1 text-[10.5px] leading-tight text-mint/70">{t("brand.tagline")}</div></div></Link>
      {nav}
      <div className="mt-auto space-y-2 rounded-xl bg-white/8 p-3 text-[11px] leading-relaxed text-mint/80 ring-1 ring-white/10">
        <div className="flex items-center gap-1.5 font-semibold text-white"><Icon name="shield" size={14} />{t("mode.replay")}</div><p>{t("mode.replay.desc")}</p>
        <div className="border-t border-white/10 pt-2">{t("fresh.convention")}<br />{t("fresh.holdout")}</div></div>
    </div>);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">{side}</aside>
      <AnimatePresence>{open && (<motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-forest/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
        <motion.div className="absolute inset-y-0 left-0 w-[272px]" initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>{side}</motion.div></motion.div>)}</AnimatePresence>
      <div className="min-w-0">
        <div className="glass sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-6">
          <button className="rounded-lg p-1.5 hover:bg-mint-l lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <ProvChip tone="warn"><Icon name="shield" size={12} />{t("mode.replay")}</ProvChip>
          {meta && <><ProvChip tone="info">{t("fresh.data")} {dateFmt(meta.data.last_observed_week, lang)}</ProvChip>
            <span className="hidden sm:inline-flex"><ProvChip>{t("fresh.model")}: {meta.model.bundle_version ? `v${meta.model.bundle_version}` : "—"} · {meta.model.features} features</ProvChip></span></>}
          {error && <ProvChip tone="warn">{t("state.offline")}</ProvChip>}
          <div className="ml-auto flex items-center gap-2">
            <Emergency />
            <button onClick={() => setLang(lang === "en" ? "bn" : "en")} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-forest shadow-sm hover:bg-mint-l" aria-label="Switch language">{t("lang.switch")}</button>
          </div>
        </div>
        <main id="main" className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6">{children}</main>
        <Intro />
      </div>
      <CopilotFab />
    </div>);
}
