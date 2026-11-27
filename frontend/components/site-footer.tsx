"use client";
// Site footer for the landing page (rendered by the shell outside <main>, so it is the page's contentinfo landmark).
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Logo } from "./icons";
import { openEmergency } from "./emergency";

export default function SiteFooter() {
  const { t } = useI18n();
  const [build, setBuild] = useState<string | null>(null);
  useEffect(() => { api<any>("/api/health", { ttl: 300_000 }).then((h) => setBuild(h?.build_commit ?? null)).catch(() => {}); }, []);
  return (
    <footer className="border-t border-ink" aria-label="Site">
      <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-12 text-[13px] leading-relaxed text-ink-2 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        <div><div className="flex items-center gap-2"><Logo size={26} /><span className="font-display text-[20px] text-ink">DengueShield <span className="align-[2px] font-sans text-[10.5px] font-semibold tracking-[0.08em] text-ink-3">AI</span></span></div>
          <p className="mt-2">Built by the DengueShield AI team for the EDU AI Engineering Hackathon 2026, on the organizers' synthetic dataset (2016 to 2024). Not affiliated with or endorsed by DGHS or any health authority.</p>
          <p className="mt-2">Source code: <a className="underline" href="https://github.com/A-K-M-Asifuzzaman/EDU_HACKATHON" rel="noopener noreferrer" target="_blank">GitHub</a> (official EDU_HACKATHON repository, branch version-onsite-final).</p>
          {build && <p className="mt-2 text-[12px] text-ink-3">Build <code data-testid="build-commit" className="rounded bg-mint-l px-1 font-semibold text-ink">{build}</code></p>}</div>
        <div><h3 className="mb-2 text-[12.5px] font-semibold text-ink">Product</h3><ul className="space-y-1.5">{[["/command/", t("nav.command")], ["/lab/", t("nav.lab")], ["/wards/", t("nav.wards")], ["/response/", t("nav.response")], ["/geography/", t("nav.geography")], ["/copilot/", t("nav.copilot")]].map(([h, l]) => <li key={h}><Link className="hover:text-ink hover:underline" href={h}>{l}</Link></li>)}</ul>
          <h3 className="mb-2 mt-5 text-[12.5px] font-semibold text-ink">Evidence and data</h3><ul className="space-y-1.5"><li><Link className="hover:underline" href="/evidence/">{t("nav.evidence")}</Link></li><li><Link className="hover:underline" href="/provenance/">Data provenance and documentation</Link></li></ul></div>
        <div><h3 className="mb-2 text-[12.5px] font-semibold text-ink">Privacy</h3><p>No accounts and no cookies for tracking. Your ward, week and alert-review notes are kept only in this browser. "Use my location" sends coordinates to the DengueShield server only to compute routes; they are not stored in a database, though standard server request logs may contain them. Map tiles come from MapTiler. Copilot questions go to OpenAI only when the Copilot is enabled.</p></div>
        <div><h3 className="mb-2 text-[12.5px] font-semibold text-ink">AI and tool disclosure</h3><p>Built with AI coding assistants (Anthropic Claude Code, OpenAI Codex) under the team's direction; reported numbers come from executed analyses and saved artifacts, checked by automated tests. The Copilot uses OpenAI on the server.</p>
          <h3 className="mb-2 mt-5 text-[12.5px] font-semibold text-ink">Limitations</h3><p>Historical replay on synthetic data; not live surveillance, not an official warning and not medical advice.</p>
          <p className="mt-4 border-t border-line pt-3 text-ink"><b className="font-semibold text-coral-d">Emergency:</b> call <a className="font-semibold underline" href="tel:999">999</a>, health line <a className="font-semibold underline" href="tel:16263">16263</a>, or open <button className="font-semibold underline" onClick={openEmergency}>Emergency help</button>.</p></div>
      </div>
    </footer>);
}
