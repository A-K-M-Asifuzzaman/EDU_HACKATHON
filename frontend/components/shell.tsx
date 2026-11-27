"use client";
// Application shell (V4 navigation). Four task groups of three or four pages: Forecast, Respond, Evidence, Learn. Desktop: group buttons open
// a panel of coloured route tiles beside a short group introduction, plus a context bar (breadcrumb, sibling pages, data/model chips).
// Phones: a navigator sheet with two tiles per row. Officer/admin pages appear only when they apply. Routes, deep links and the
// "G then a letter" shortcuts are unchanged.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useI18n } from "@/lib/i18n";
import { useSel } from "@/lib/ctx";
import { dateFmt, cls } from "@/lib/format";
import { api, type ApiEvent } from "@/lib/api";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { Icon, Logo } from "./icons";
import { ProvChip, useFocusTrap } from "./ui";
import { CopilotLauncher } from "./chat";
import Emergency from "./emergency";
import Intro from "./intro";
import Palette from "./palette";
import { AccountButton, AccountLinks } from "./account";
import { Magnifier, MapPin, Mosquito, ShieldChart } from "./illustrations";
import { atLeast, useAuth } from "@/lib/auth";
const SiteFooter = dynamic(() => import("./site-footer"));          // landing only: other pages do not download it

type NavItem = readonly [string, string, string];                     // href, i18n key, icon (palette format)
type Page = { href: string; key: string; icon: string; desc: string; kbd?: string; need?: "officer" | "admin" };
type Group = { key: string; color: string; blurb: string; Art: (p: { className?: string }) => React.ReactNode; pages: Page[] };
// Four task groups of three or four pages each. `color` tints the group's tiles (--g); officer and admin pages appear only when they apply.
const GROUPS: Group[] = [
  { key: "nav.g.forecast", color: "#6a45f0", Art: ShieldChart, blurb: "Weekly case forecasts for 60 synthetic wards, two to four weeks ahead, each with its uncertainty.", pages: [
    { href: "/command/", key: "nav.command", icon: "dashboard", desc: "One ward's forecast, how reliable it is, and what to do next", kbd: "C" },
    { href: "/wards/", key: "nav.wards", icon: "wards", desc: "All 60 wards: risk matrix, ranking and comparison", kbd: "W" },
    { href: "/lab/", key: "nav.lab", icon: "lab", desc: "Horizons, rainfall lags, drivers and the rainfall what-if", kbd: "L" },
    { href: "/lab/#climate-futures", key: "nav.futures", icon: "climate", desc: "Exploratory rainfall scenarios, not forecasts" }] },
  { key: "nav.g.response", color: "#f2545b", Art: MapPin, blurb: "Turn this week's alerts into a plan: ranked wards, a resource sandbox and the nearest hospitals by road.", pages: [
    { href: "/response/", key: "nav.response", icon: "response", desc: "Ranked alerts, review queue and resource sandbox", kbd: "R" },
    { href: "/geography/", key: "nav.geography", icon: "geography", desc: "Nearest general hospitals by road from a real location", kbd: "M" },
    { href: "/officer/", key: "nav.officer", icon: "shield", desc: "Review alerts and draft response plans", need: "officer" },
    { href: "/admin/", key: "nav.admin", icon: "provenance", desc: "Roles, plan approvals and the audit log", need: "admin" }] },
  { key: "nav.g.research", color: "#1597c9", Art: Magnifier, blurb: "How well the model did on seasons it never saw, and where every number comes from.", pages: [
    { href: "/evidence/", key: "nav.evidence", icon: "evidence", desc: "Validation, model comparison and reliability", kbd: "E" },
    { href: "/profiling/", key: "nav.profiling", icon: "profiling", desc: "The organizer dataset: quality, distributions and lags" },
    { href: "/climate/", key: "nav.climate", icon: "climate", desc: "Observed weather from NASA POWER and Open-Meteo" },
    { href: "/provenance/", key: "nav.provenance", icon: "provenance", desc: "Data sources, versions and documentation" }] },
  { key: "nav.g.learn", color: "#12936a", Art: Mosquito, blurb: "New here? Start with the overview, then see how rain, mosquitoes and dengue connect.", pages: [
    { href: "/", key: "nav.home", icon: "command", desc: "Product overview with a live forecast preview", kbd: "O" },
    { href: "/learn/", key: "nav.learn", icon: "learn", desc: "How rain, mosquitoes and dengue connect" },
    { href: "/copilot/", key: "nav.copilot", icon: "copilot", desc: "Questions answered from project documents and read-only tools" }] },
];
const NAV: NavItem[] = GROUPS.flatMap((g) => g.pages.filter((p) => !p.need).map((p) => [p.href, p.key, p.icon] as const));
const SHORTCUTS: Record<string, string> = Object.fromEntries(GROUPS.flatMap((g) => g.pages.filter((p) => p.kbd).map((p) => [p.kbd!.toLowerCase(), p.href])));
const gvar = (g: Group) => ({ "--g": g.color }) as React.CSSProperties;
const Dot = () => <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-[#1a1438] bg-[var(--g)]" />;
const Chevron = ({ open }: { open: boolean }) => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cls("transition-transform", open && "rotate-180")}><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>;

/** Light ↔ Dim colour mode. The label names the current mode; the accessible name says what pressing does. */
function ThemeToggle({ wide = false }: { wide?: boolean }) {
  const { t } = useI18n();
  const [theme, set] = useState<Theme>("light");
  useEffect(() => { set(getTheme()); }, []);
  const next: Theme = theme === "dim" ? "light" : "dim";
  return (<button onClick={() => { setTheme(next); set(next); }} aria-label={`${t("theme.mode")}: ${t(`theme.${theme}`)}. ${t("theme.switch")} ${t(`theme.${next}`)}`} title={`${t("theme.switch")} ${t(`theme.${next}`)}`}
    className={cls(HBTN, wide && "flex-1 justify-center")}><Icon name={theme === "dim" ? "moon" : "sun"} size={16} /><span className={wide ? "" : "hidden 2xl:inline"}>{t(`theme.${theme}`)}</span></button>);
}
function LangButton({ wide = false }: { wide?: boolean }) {
  const { t, lang, setLang } = useI18n();
  return <button onClick={() => setLang(lang === "en" ? "bn" : "en")} className={cls(HBTN, "px-3", wide && "flex-1 justify-center")} aria-label="Switch language">{t("lang.switch")}</button>;
}
const HBTN = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border-2 border-white/35 px-2.5 text-[13px] font-bold text-white transition-colors hover:border-white hover:bg-white/10 sm:min-h-10";

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
  const { t, lang } = useI18n();
  const { meta, error } = useSel();
  const { user, configured } = useAuth();
  const [open, setOpen] = useState(false);                              // phone navigator
  const [menu, setMenu] = useState<number | null>(null);                 // desktop group panel
  const landing = path === "/";
  const isActive = (h: string) => !h.includes("#") && (h === "/" ? landing : path.startsWith(h.slice(0, -1)));
  const shows = (p: Page) => !p.need || (configured && (p.need === "officer" || user?.role === "admin"));
  const gi = landing ? -1 : GROUPS.findIndex((g) => g.pages.some((p) => isActive(p.href)));
  const group = gi >= 0 ? GROUPS[gi] : null;
  const page = group?.pages.find((p) => isActive(p.href));
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
  // desktop panels: Escape closes and returns focus to the group button; a click outside closes
  const bar = useRef<HTMLDivElement>(null);
  const trig = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (menu === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { trig.current[menu]?.focus(); setMenu(null); } };
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

  const done = () => { setOpen(false); setMenu(null); };
  const signInChip = (p: Page) => p.need === "officer" && !atLeast(user, "officer") && <span className="rounded-full border-[1.5px] border-current px-1.5 text-[10.5px] font-bold leading-[16px] opacity-80">sign in</span>;
  /** Desktop panel tile: coloured icon block, name, shortcut, one-line description. */
  const tile = (p: Page) => {
    const a = isActive(p.href);
    return (<Link key={p.href} href={p.href} onClick={done} aria-current={a ? "page" : undefined}
      className={cls("group flex min-h-11 items-start gap-3 rounded-[14px] p-2.5 transition-colors hover:bg-[color-mix(in_srgb,var(--g)_11%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--g)_11%,transparent)]", a && "bg-[color-mix(in_srgb,var(--g)_15%,transparent)]")}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border-2 border-[#1a1438] bg-[var(--g)] text-white shadow-[2px_2px_0_#1a1438] transition-transform group-hover:-translate-y-0.5 motion-reduce:transform-none"><Icon name={p.icon} size={19} /></span>
      <span className="min-w-0 pt-0.5"><span className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-bold leading-tight text-ink">{t(p.key)}
        {p.kbd && <kbd className="rounded-[5px] border border-line px-1 font-mono text-[10.5px] font-normal text-ink-3">G {p.kbd}</kbd>}{signInChip(p)}</span>
        <span className="mt-1 block text-[12.5px] leading-snug text-ink-2">{p.desc}</span></span></Link>);
  };
  /** Phone sheet tile: two per row, name only. */
  const chip = (p: Page) => {
    const a = isActive(p.href);
    return (<Link key={p.href} href={p.href} onClick={done} aria-current={a ? "page" : undefined}
      className={cls("flex min-h-[72px] flex-col justify-between gap-2 rounded-[14px] border-2 p-2.5 text-[13.5px] font-bold leading-tight text-white transition-colors", a ? "border-[#ffc23d] bg-white/[0.16]" : "border-white/15 bg-white/[0.06] hover:bg-white/[0.12]")}>
      <span className="grid h-8 w-8 place-items-center rounded-[10px] border-2 border-[#1a1438] bg-[var(--g)] text-white"><Icon name={p.icon} size={16} /></span>
      <span className="flex flex-wrap items-center gap-1.5">{t(p.key)}{signInChip(p)}</span></Link>);
  };

  return (
    <div className="min-h-screen">
      <AnimatePresence>{open && (<motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div className="absolute inset-0 bg-obsidian/60 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
        <motion.div ref={drawer} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Navigation" className="night absolute inset-y-0 left-0 flex w-[min(420px,92vw)] flex-col overflow-y-auto border-r-[3px] border-[#1a1438] p-4 text-white outline-none"
          initial={{ x: -420 }} animate={{ x: 0 }} exit={{ x: -420 }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>
          <div className="mb-3 flex items-center justify-between"><Link href="/" onClick={done} className="flex items-center gap-2.5"><Logo size={28} /><span className="font-display text-[18px] font-extrabold tracking-tight">DengueShield <span className="text-[#ffd36e]">AI</span></span></Link>
            <button onClick={() => setOpen(false)} aria-label={t("act.close")} className="grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-white/10"><Icon name="close" /></button></div>
          <div className="mb-5 flex gap-2"><ThemeToggle wide /><LangButton wide /></div>
          <nav aria-label="Primary" className="flex flex-col gap-5">
            {GROUPS.map((g, i) => (<div key={g.key} style={gvar(g)} role="group" aria-labelledby={`navg-m-${i}`}>
              <div id={`navg-m-${i}`} className="mb-2 flex items-center gap-2 px-1 text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-[#ffd36e]"><Dot />{t(g.key)}</div>
              <div className="grid grid-cols-2 gap-2">{g.pages.filter(shows).map(chip)}</div></div>))}
          </nav>
          <AccountLinks onNavigate={() => setOpen(false)} />
          <p className="mt-6 rounded-[14px] bg-white/[0.06] p-3 text-[12px] leading-relaxed text-white/70 ring-1 ring-white/10"><b className="text-white">{t("mode.replay")}.</b> {t("mode.replay.desc")} {t("fresh.holdout")}</p>
        </motion.div></motion.div>)}</AnimatePresence>

      <header className="night sticky top-0 z-30 border-b-[2.5px] border-[#1a1438]" ref={bar}>
        <div className="mx-auto flex max-w-[1440px] items-center gap-1.5 px-3 py-2 sm:gap-2 sm:px-5">
          <button className="grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-white/10 lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <Link href="/" aria-label="DengueShield AI home" className="mr-1 flex shrink-0 items-center gap-2 xl:mr-3"><Logo size={28} />
            <span className="hidden whitespace-nowrap leading-none min-[460px]:block lg:hidden xl:block"><span className="font-display text-[21px] font-extrabold tracking-[-0.02em] text-ink">DengueShield</span> <span className="align-[3px] text-[11px] font-bold tracking-[0.06em] text-[#ffd36e]">AI</span></span></Link>
          <nav aria-label="Primary" className="relative hidden items-center gap-1 lg:flex">
            {GROUPS.map((g, i) => {
              const on = menu === i, act = gi === i;
              return (<div key={g.key} style={gvar(g)} onMouseEnter={() => { if (menu !== null && menu !== i) setMenu(i); }}>
                <button ref={(el) => { trig.current[i] = el; }} onClick={() => setMenu(on ? null : i)} aria-expanded={on} aria-controls={`menu-${i}`}
                  className={cls("flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full border-2 px-3 text-[14.5px] font-bold transition", act ? "border-[#1a1438] bg-[#ffc23d] text-[#1a1438] shadow-[2px_2px_0_#1a1438]" : on ? "border-white/40 bg-white/15 text-white" : "border-transparent text-white/90 hover:bg-white/10 hover:text-white")}>
                  <Dot />{t(g.key)}<Chevron open={on} /></button>
                <AnimatePresence>{on && (<motion.div id={`menu-${i}`} className="card absolute left-0 top-full z-40 mt-3 grid w-[min(760px,calc(100vw-2rem))] grid-cols-[1fr_216px] overflow-hidden p-0"
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
                  <div className="grid grid-cols-2 content-start gap-1 p-3">{g.pages.filter(shows).map(tile)}</div>
                  <aside className="flex flex-col border-l-[2.5px] border-[#1a1438] bg-[color-mix(in_srgb,var(--g)_12%,transparent)] p-5">
                    <g.Art className="w-24" />
                    <div className="mt-3 font-display text-[22px] font-extrabold leading-tight text-ink">{t(g.key)}</div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{g.blurb}</p>
                    <Link href={g.pages[0].href} onClick={done} className="mt-auto pt-4 text-[13.5px] font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-[var(--g)]">Start with {t(g.pages[0].key)} →</Link>
                  </aside></motion.div>)}</AnimatePresence>
              </div>);
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span className="hidden md:inline-flex"><ServiceStatus /></span>
            <Palette pages={NAV} />
            <CopilotLauncher />
            <Emergency />
            <AccountButton />
            <div className="hidden items-center gap-1.5 sm:flex"><ThemeToggle /><LangButton /></div>
          </div>
        </div>
        {/* context bar: where you are, the pages next to it, and what data/model the numbers come from */}
        {!landing && group && (<div className="border-t-2 border-[#1a1438]/30 bg-[#1a1438]/15" style={gvar(group)}>
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 sm:px-5">
            <nav aria-label="Breadcrumb" className="text-[12.5px] text-white/70"><ol className="flex items-center gap-1.5"><li className="flex items-center gap-1.5"><Dot />{t(group.key)}</li><li aria-hidden>/</li><li aria-current="page" className="font-bold text-white">{page ? t(page.key) : ""}</li></ol></nav>
            {group.pages.filter(shows).length > 1 && <nav aria-label="Section" className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 py-0.5 max-md:order-last">{group.pages.filter(shows).map((p) => { const a = isActive(p.href); return (
              <Link key={p.href} href={p.href} aria-current={a ? "page" : undefined} className={cls("shrink-0 whitespace-nowrap rounded-full border-2 px-3 py-1 text-[13px] font-bold transition-colors", a ? "border-[#1a1438] bg-[#ffffff] text-[#1a1438] shadow-[2px_2px_0_#1a1438]" : "border-transparent text-white/80 hover:bg-white/10 hover:text-white")}>{t(p.key)}</Link>); })}</nav>}
            <div className="ml-auto flex items-center gap-1.5">
              <ProvChip tone="warn"><Icon name="shield" size={12} />{t("mode.replay")}</ProvChip>
              <OfflineChip />
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

/** Shown only when the server runs in offline mode (scripts/launch_offline.sh): every engine is local; optional online services are off. */
function OfflineChip() {
  const [st, setSt] = useState<{ offline_mode: boolean; services: { name: string; status: string }[] | null } | null>(null);
  useEffect(() => { api<any>("/api/system/offline", { ttl: 60_000 }).then(setSt).catch(() => {}); }, []);
  if (!st?.offline_mode) return null;
  const title = (st.services ?? []).map((x) => `${x.name}: ${x.status}`).join("\n");
  return <span title={title} data-testid="offline-chip"><ProvChip tone="ok"><Icon name="shield" size={12} />Offline mode: local engines</ProvChip></span>;
}
