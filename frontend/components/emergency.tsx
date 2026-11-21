"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Modal } from "./ui";

// Published numbers (no API call needed, so this opens instantly even offline). Mirrors GET /api/emergency/info.
const NUMBERS = [
  { number: "999", label: "National Emergency Service: police, fire service, ambulance", source: "Bangladesh National Emergency Service" },
  { number: "16263", label: "Shasthya Batayon: DGHS health call centre, 24/7 medical advice", source: "Directorate General of Health Services (DGHS)" },
];
const SIGNS = ["severe abdominal pain", "persistent vomiting", "rapid breathing", "bleeding gums or nose", "fatigue or restlessness", "blood in vomit or stool", "being very thirsty", "pale and cold skin", "feeling weak"];

export function openEmergency() { window.dispatchEvent(new Event("ds:emergency")); }

export default function Emergency() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  useEffect(() => { setMounted(true); const on = () => setOpen(true); window.addEventListener("ds:emergency", on); return () => window.removeEventListener("ds:emergency", on); }, []);
  return (<>
    <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-coral-d px-3 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-coral focus-visible:outline-2" aria-haspopup="dialog">
      <span aria-hidden>✚</span> Emergency help</button>
    {mounted && createPortal(<Modal open={open} onClose={() => setOpen(false)} title="Emergency help">   {/* portal: the header's backdrop-filter would otherwise trap position:fixed */}
      <div className="space-y-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">{NUMBERS.map((n) => (<a key={n.number} href={`tel:${n.number}`} className="rounded-xl border-2 border-coral-d/30 bg-coral/5 p-3 hover:bg-coral/10">
          <div className="text-2xl font-bold text-coral-d">📞 {n.number}</div><div className="text-[13px]">{n.label}</div><div className="mt-1 text-[11px] text-ink-3">{n.source}</div></a>))}</div>
        <button onClick={() => { setOpen(false); router.push("/geography/?emergency=1"); }} className="w-full rounded-xl bg-forest px-4 py-3 text-left font-semibold text-white hover:bg-forest-2">
          Find the nearest hospitals by road →<span className="block text-[12px] font-normal opacity-80">Uses your location (with permission) and A* road routing over OpenStreetMap data</span></button>
        <div><div className="font-semibold">Dengue warning signs: seek care immediately</div>
          <p className="text-[12px] text-ink-3">Usually 24–48 hours after the fever goes down. Source: World Health Organization, dengue fact sheet.</p>
          <ul className="mt-1 grid list-disc gap-x-6 pl-5 sm:grid-cols-2">{SIGNS.map((s) => <li key={s}>{s}</li>)}</ul></div>
        <p className="text-[11px] text-ink-3">General public-health information, not medical advice or a diagnosis. Hospital availability, beds and doctors on duty are not known to this app: call ahead.</p>
      </div>
    </Modal>, document.body)}
  </>);
}
