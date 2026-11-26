"use client";
// Signal Atlas (V4) application shell. Five groups instead of a long, flat sidebar: Command, Forecast Intelligence, Response Operations,
// Geospatial Intelligence, Research & Evidence. Desktop: a command bar whose groups open described menus, plus a context bar (breadcrumb,
// sibling pages, data/model indicators). Phones: a navigator sheet. Routes and deep links are unchanged. "G then a letter" shortcuts.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n";
import { useSel } from "@/lib/ctx";
import { dateFmt, cls } from "@/lib/format";
import type { ApiEvent } from "@/lib/api";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { Icon, Logo } from "./icons";
import { ProvChip, useFocusTrap } from "./ui";
import { CopilotLauncher } from "./chat";
import Emergency from "./emergency";
import Intro from "./intro";
import Palette from "./palette";
const SiteFooter = dynamic(() => import("./site-footer"));          // landing only: other pages do not download it

type NavItem = readonly [string, string, string];                     // href, i18n key, icon (palette format)
type Page = { href: string; key: string; icon: string; desc: string; kbd?: string };
const SHORT: Record<string, string> = { "nav.g.forecast": "Forecast", "nav.g.response": "Response", "nav.g.geo": "Geospatial", "nav.g.research": "Research" };
const GROUPS: { key: string; pages: Page[] }[] = [
  { key: "nav.g.command", pages: [
    { href: "/", key: "nav.home", icon: "command", desc: "Product overview with a live forecast preview", kbd: "O" },
    { href: "/command/", key: "nav.command", icon: "dashboard", desc: "One ward's forecast, how reliable it is, and what to do next", kbd: "C" },
    { href: "/wards/", key: "nav.wards", icon: "wards", desc: "All 60 synthetic wards: risk matrix, ranking and comparison", kbd: "W" }] },
  { key: "nav.g.forecast", pages: [
    { href: "/lab/", key: "nav.lab", icon: "lab", desc: "Horizons, rainfall lags, drivers and the rainfall what-if", kbd: "L" },
    { href: "/lab/#climate-futures", key: "nav.futures", icon: "climate", desc: "Exploratory 2026–2030 rainfall scenarios (not forecasts)" },
    { href: "/climate/", key: "nav.climate", icon: "climate", desc: "Observed weather from NASA POWER and Open-Meteo" },
    { href: "/profiling/", key: "nav.profiling", icon: "profiling", desc: "The organizer dataset: quality, distributions and lags" }] },
  { key: "nav.g.response", pages: [
    { href: "/response/", key: "nav.response", icon: "response", desc: "Ranked alerts, local review queue and resource sandbox", kbd: "R" }] },
  { key: "nav.g.geo", pages: [
    { href: "/geography/", key: "nav.geography", icon: "geography", desc: "General hospitals by road from a real location (A*)", kbd: "M" }] },
  { key: "nav.g.research", pages: [
    { href: "/evidence/", key: "nav.evidence", icon: "evidence", desc: "Validation, model comparison and reliability", kbd: "E" },
    { href: "/provenance/", key: "nav.provenance", icon: "provenance", desc: "Data sources, versions and documentation" },
    { href: "/copilot/", key: "nav.copilot", icon: "copilot", desc: "Questions answered from project documents and read-only tools" },
    { href: "/learn/", key: "nav.learn", icon: "learn", desc: "How rain, mosquitoes and dengue connect" }] },
];
const NAV: NavItem[] = GROUPS.flatMap((g) => g.pages.map((p) => [p.href, p.key, p.icon] as const));
const SHORTCUTS: Record<string, string> = Object.fromEntries(GROUPS.flatMap((g) => g.pages.filter((p) => p.kbd).map((p) => [p.kbd!.toLowerCase(), p.href])));

/** Light ↔ Dim colour mode. The label names the current mode; the accessible name says what pressing does. */
function ThemeToggle() {
  const { t } = useI18n();
  const [theme, set] = useState<Theme>("light");
  useEffect(() => { set(getTheme()); }, []);
  const next: Theme = theme === "dim" ? "light" : "dim";
  return (<button onClick={() => { setTheme(next); set(next); }} aria-label={`${t("theme.mode")}: ${t(`theme.${theme}`)}. ${t("theme.switch")} ${t(`theme.${next}`)}`} title={`${t("theme.switch")} ${t(`theme.${next}`)}`}
    className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control border border-line px-2.5 text-[13px] font-medium text-ink hover:border-ink-3 sm:min-h-9 sm:min-w-0">
    <Icon name={theme === "dim" ? "moon" : "sun"} size={16} /><span className="hidden 2xl:inline">{t(`theme.${theme}`)}</span></button>);
}

/** Service health from real request outcomes (no polling): slow after 2.5 s without an answer, unreachable after a network/timeout/5xx failure. */
function ServiceStatus() {
  const [state, setState] = useState<"ok" | "slow" | "down">("ok");
  useEffect(() => {
    const pending = new Map<string, number>();
    let timer: ReturnType<typeof setInterval> | undefined;
    const check = () => { const oldest = Math.min(...pending.values()); setState((s) => (s === "down" ? s : pending.size && Date.now() - oldest > 2500 ? "slow" : "ok")); if (!pending.size && timer) { clearInterval(timer); timer = undefined; } };
    const on = (ev: Event) => {
      const e = (ev as CustomEvent<ApiEvent>).detail;
      if (e.phase === "start") { pending.set(e.path, Date.now()); if (!timer) timer = setInterval(check, 500); return; }
      pending.delete(e.path);
      if (!e.ok && (e.kind === "network" || e.kind === "timeout" || e.kind === "server")) setState("down");
      else if (e.ok) setState(pending.size ? "slow" : "ok");
      check();
    };
    window.addEventListener("ds:api", on);
    return () => { window.removeEventListener("ds:api", on); if (timer) clearInterval(timer); };
  }, []);
  if (state === "ok") return null;
  return (<span role="status" aria-live="polite" className={cls("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]", state === "down" ? "border-coral/40 bg-coral/10 text-coral-d" : "border-amber/50 bg-amber/10 text-amber-d")}>
    <span className={cls("h-1.5 w-1.5 rounded-full", state === "down" ? "bg-coral" : "bg-amber")} aria-hidden />{state === "down" ? "Service unreachable" : "Service responding slowly"}</span>);
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const { meta, error } = useSel();
  const [open, setOpen] = useState(false);                              // phone navigator
  const [menu, setMenu] = useState<number | null>(null);                 // desktop group menu
  const isActive = (h: string) => (h === "/" ? path === "/" : path.startsWith(h.split("#")[0].slice(0, -1)));
  const gi = GROUPS.findIndex((g) => g.pages.some((p) => isActive(p.href) && !p.href.includes("#")));
  const group = gi >= 0 ? GROUPS[gi] : null;
  const page = group?.pages.find((p) => isActive(p.href) && !p.href.includes("#"));
  const landing = path === "/";
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  const drawer = useRef<HTMLDivElement>(null);
  const closeNav = useCallback(() => setOpen(false), []);
  useFocusTrap(drawer, open, closeNav);
  useEffect(() => { setOpen(false); setMenu(null); }, [path]);
  // desktop menus: Escape or a click outside closes them
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const c = (e: MouseEvent) => { if (bar.current && !bar.current.contains(e.target as Node)) setMenu(null); };
    window.addEventListener("keydown", k); window.addEventListener("mousedown", c);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("mousedown", c); };
  }, [menu]);
  // "G then a letter" shortcuts (ignored while typing)
  useEffect(() => {
    let armed = 0;
    const k = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || tg.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key.toLowerCase() === "g") { armed = Date.now(); return; }
      if (armed && Date.now() - armed < 1200 && SHORTCUTS[e.key.toLowerCase()]) { armed = 0; router.push(SHORTCUTS[e.key.toLowerCase()]); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [router]);

  const pageLink = (p: Page, i: number, gIdx: number, dark = false) => {
    const a = isActive(p.href) && !p.href.includes("#");
    return (<Link key={p.href} href={p.href} onClick={() => { setOpen(false); setMenu(null); }} aria-current={a ? "page" : undefined}
      className={cls("group flex min-h-11 items-start gap-3 rounded-control px-3 py-2.5 transition", dark ? (a ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/[0.06] hover:text-white") : (a ? "bg-mint-l text-forest" : "text-ink hover:bg-mint-l/70"))}>
      <span className={cls("mt-0.5 font-mono text-[11px]", dark ? "text-white/45" : "text-ink-3")}>{String(gIdx + 1).padStart(2, "0")}.{i + 1}</span>
      <span className="min-w-0"><span className="flex items-center gap-2 text-[14px] font-semibold"><Icon name={p.icon} size={16} />{t(p.key)}{p.kbd && <kbd className={cls("ml-1 rounded border px-1 font-mono text-[10.5px] font-normal", dark ? "border-white/20 text-white/50" : "border-line text-ink-3")}>G {p.kbd}</kbd>}</span>
        <span className={cls("mt-0.5 block text-[12.5px] leading-snug", dark ? "text-white/60" : "text-ink-2")}>{p.desc}</span></span></Link>);
  };

  return (
    <div className="min-h-screen">
      <AnimatePresence>{open && (<motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-obsidian/60 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
        <motion.div ref={drawer} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Navigation" className="absolute inset-y-0 left-0 flex w-[min(340px,88vw)] flex-col overflow-y-auto bg-obsidian p-4 text-white outline-none"
          initial={{ x: -340 }} animate={{ x: 0 }} exit={{ x: -340 }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>
          <div className="mb-4 flex items-center justify-between"><Link href="/" className="flex items-center gap-2.5"><Logo size={28} /><span className="font-display text-[17px] font-bold tracking-tight">DengueShield <span className="text-signal">AI</span></span></Link>
            <button onClick={() => setOpen(false)} aria-label={t("act.close")} className="grid min-h-11 min-w-11 place-items-center rounded-control hover:bg-white/10"><Icon name="close" /></button></div>
          <nav aria-label="Primary" className="flex flex-col gap-4">
            {GROUPS.map((g, i) => (<div key={g.key} role="group" aria-labelledby={`navg-m-${i}`}>
              <div id={`navg-m-${i}`} className="mb-1 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-signal">{String(i + 1).padStart(2, "0")} · {t(g.key)}</div>
              {g.pages.map((p, j) => pageLink(p, j, i, true))}</div>))}
          </nav>
          <p className="mt-6 rounded-control bg-white/[0.06] p-3 text-[12px] leading-relaxed text-white/70 ring-1 ring-white/10"><b className="text-white">{t("mode.replay")}.</b> {t("mode.replay.desc")} {t("fresh.holdout")}</p>
        </motion.div></motion.div>)}</AnimatePresence>

      <header className="night sticky top-0 z-30 border-b border-line" ref={bar}>
        <div className="mx-auto flex max-w-[1440px] items-center gap-1.5 px-3 py-2 sm:gap-2 sm:px-6">
          <button className="grid min-h-11 min-w-11 place-items-center rounded-control hover:bg-mint-l lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <Link href="/" aria-label="DengueShield AI home" className="mr-2 flex items-center gap-2"><Logo size={28} />
            <span className="hidden whitespace-nowrap leading-none min-[400px]:block"><span className="font-display text-[21px] font-extrabold tracking-[-0.02em] text-ink">DengueShield</span> <span className="align-[3px] text-[11px] font-bold tracking-[0.06em] text-[#ffd166]">AI</span></span></Link>
          <nav aria-label="Primary" className="hidden items-stretch lg:flex">
            {GROUPS.map((g, i) => {
              const activeG = gi === i;
              if (g.pages.length === 1) {
                const p = g.pages[0];
                return (<Link key={g.key} href={p.href} aria-current={isActive(p.href) ? "page" : undefined} className={cls("relative my-1 flex min-h-10 items-center whitespace-nowrap rounded-full px-3.5 text-[14.5px] font-bold transition", activeG ? "bg-[#fff] text-[#15153d]" : "text-white/85 hover:bg-white/15 hover:text-white")}>
                  {SHORT[g.key] ? <><span className="2xl:hidden">{SHORT[g.key]}</span><span className="hidden 2xl:inline">{t(g.key)}</span></> : t(g.key)}</Link>);
              }
              return (<div key={g.key} className="relative">
                <button onClick={() => setMenu(menu === i ? null : i)} aria-expanded={menu === i} aria-controls={`menu-${i}`}
                  className={cls("relative my-1 flex min-h-10 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[14.5px] font-bold transition", activeG ? "bg-[#fff] text-[#15153d]" : "text-white/85 hover:bg-white/15 hover:text-white")}>
                  {SHORT[g.key] ? <><span className="2xl:hidden">{SHORT[g.key]}</span><span className="hidden 2xl:inline">{t(g.key)}</span></> : t(g.key)}<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cls("transition", menu === i && "rotate-180")}><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
                  </button>
                <AnimatePresence>{menu === i && (<motion.div id={`menu-${i}`} className="card absolute left-0 top-full z-40 mt-3 w-[400px] p-2 shadow-[var(--shadow-pop)]" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
                  <div className="px-3 pb-1 pt-2 text-[12px] font-semibold text-ink-3">{t(g.key)}</div>
                  {g.pages.map((p, j) => pageLink(p, j, i))}</motion.div>)}</AnimatePresence>
              </div>);
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span className="hidden md:inline-flex"><ServiceStatus /></span>
            <Palette pages={NAV} />
            <CopilotLauncher />
            <Emergency />
            <ThemeToggle />
            <button onClick={() => setLang(lang === "en" ? "bn" : "en")} className="min-h-11 rounded-control border border-line px-2.5 text-[13px] font-medium text-ink hover:border-ink-3 sm:min-h-9 sm:px-3" aria-label="Switch language">{t("lang.switch")}</button>
          </div>
        </div>
        {/* context bar: where you are, the pages next to it, and what data/model the numbers come from */}
        {!landing && group && (<div className="border-t border-line/70">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 sm:px-6">
            <nav aria-label="Breadcrumb" className="text-[12.5px] text-ink-3"><ol className="flex items-center gap-1.5"><li>{t(group.key)}</li><li aria-hidden>/</li><li aria-current="page" className="font-medium text-ink">{page ? t(page.key) : ""}</li></ol></nav>
            {group.pages.length > 1 && <nav aria-label="Section" className="-mx-1 flex max-w-full max-md:order-last items-center gap-0.5 overflow-x-auto">{group.pages.map((p) => { const a = isActive(p.href) && !p.href.includes("#"); return (
              <Link key={p.href} href={p.href} aria-current={a ? "page" : undefined} className={cls("relative whitespace-nowrap px-2.5 py-2 text-[13px] font-medium transition-colors", a ? "text-ink after:absolute after:inset-x-2.5 after:-bottom-1.5 after:h-[2px] after:bg-ink" : "text-ink-3 hover:text-ink")}>{t(p.key)}</Link>); })}</nav>}
            <div className="ml-auto flex items-center gap-1.5">
              <ProvChip tone="warn"><Icon name="shield" size={12} />{t("mode.replay")}</ProvChip>
              <span className="hidden gap-1.5 md:inline-flex">{meta ? <><ProvChip tone="info">{t("fresh.data")} {dateFmt(meta.data.last_observed_week, lang)}</ProvChip><span className="hidden 2xl:inline-flex"><ProvChip tone="neutral">{t("fresh.model")}: {meta.model.bundle_version ? `v${meta.model.bundle_version}` : "—"} · {meta.model.features} features</ProvChip></span></>
                : !error && <span className="skeleton inline-block h-[22px] w-[160px] rounded-full" aria-hidden />}</span>{/* placeholder keeps the bar's width stable while metadata loads (no layout shift) */}
              {error && <ProvChip tone="warn">{t("state.offline")}</ProvChip>}
            </div>
          </div></div>)}
      </header>
      <main id="main" className={landing ? "" : "mx-auto max-w-[1440px] px-4 py-6 sm:px-6"}>{children}</main>
      {landing && <SiteFooter />}
      {!landing && <footer className="mx-auto max-w-[1440px] px-4 pb-8 pt-4 text-[11px] leading-relaxed text-ink-3 sm:px-6">
        <div className="border-t border-line pt-4"><b className="text-ink-2">DengueShield AI</b> · Historical Replay on the organizers' synthetic dataset (2016–2024); the 2025 test year is locked. Not live surveillance, not medical advice.
          <br />Sources: organizer dataset (EDU AI Engineering Hackathon 2026) · hospitals, clinics and roads © OpenStreetMap contributors (ODbL) · basemap © MapTiler © OpenStreetMap · weather: NASA POWER, Open-Meteo (CC BY 4.0) · boundaries: DGHS Bangladesh GIS · Copilot: OpenAI (server-side). Emergency: call 999. Shortcuts: G then O, C, W, L, R, M or E.</div></footer>}
      <Intro />
    </div>);
}
