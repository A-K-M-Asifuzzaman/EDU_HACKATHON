"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Modal } from "./ui";
import { useI18n } from "@/lib/i18n";

// Published numbers (no API call needed, so this opens instantly even offline). Mirrors GET /api/emergency/info.
// Bangla text added: this dialog is the part of the app most likely to be opened by the public, and it was English-only.
const TXT = {
  en: {
    button: "Emergency help", title: "Emergency help",
    numbers: [
      { number: "999", label: "National Emergency Service: police, fire service, ambulance", source: "Bangladesh National Emergency Service" },
      { number: "16263", label: "Shasthya Batayon: DGHS health call centre, 24/7 medical advice", source: "Directorate General of Health Services (DGHS)" },
    ],
    nearest: "Find the nearest hospitals by road →", nearestSub: "Uses your location (with permission) and A* road routing over OpenStreetMap data",
    signsTitle: "Dengue warning signs: seek care immediately", signsWhen: "Usually 24–48 hours after the fever goes down. Source: World Health Organization, dengue fact sheet.",
    signs: ["severe abdominal pain", "persistent vomiting", "rapid breathing", "bleeding gums or nose", "fatigue or restlessness", "blood in vomit or stool", "being very thirsty", "pale and cold skin", "feeling weak"],
    note: "General public-health information, not medical advice or a diagnosis. Hospital availability, beds and doctors on duty are not known to this app: call ahead.",
  },
  bn: {
    button: "জরুরি সাহায্য", title: "জরুরি সাহায্য",
    numbers: [
      { number: "999", label: "জাতীয় জরুরি সেবা: পুলিশ, ফায়ার সার্ভিস, অ্যাম্বুলেন্স", source: "বাংলাদেশ জাতীয় জরুরি সেবা" },
      { number: "16263", label: "স্বাস্থ্য বাতায়ন: স্বাস্থ্য অধিদপ্তরের কল সেন্টার, ২৪ ঘণ্টা চিকিৎসা পরামর্শ", source: "স্বাস্থ্য অধিদপ্তর (DGHS)" },
    ],
    nearest: "রাস্তা ধরে নিকটতম হাসপাতাল খুঁজুন →", nearestSub: "আপনার অবস্থান (অনুমতি নিয়ে) ও OpenStreetMap সড়ক-ডেটায় A* রুটিং ব্যবহার করে",
    signsTitle: "ডেঙ্গুর বিপদ-লক্ষণ: দেরি না করে চিকিৎসা নিন", signsWhen: "সাধারণত জ্বর কমে যাওয়ার ২৪–৪৮ ঘণ্টা পরে দেখা দেয়। উৎস: বিশ্ব স্বাস্থ্য সংস্থা (WHO), ডেঙ্গু ফ্যাক্ট শিট।",
    signs: ["তীব্র পেটে ব্যথা", "বারবার বমি", "দ্রুত শ্বাস নেওয়া", "মাড়ি বা নাক দিয়ে রক্ত পড়া", "ক্লান্তি বা অস্থিরতা", "বমি বা মলে রক্ত", "অতিরিক্ত পিপাসা", "ফ্যাকাশে ও ঠান্ডা ত্বক", "খুব দুর্বল লাগা"],
    note: "এটি সাধারণ জনস্বাস্থ্য তথ্য, চিকিৎসা পরামর্শ বা রোগনির্ণয় নয়। হাসপাতালে খালি শয্যা বা ডাক্তার আছে কি না এই অ্যাপ জানে না: যাওয়ার আগে ফোন করে নিন।",
  },
};

export function openEmergency() { window.dispatchEvent(new Event("ds:emergency")); }

export default function Emergency() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const { lang } = useI18n();
  const L = TXT[lang];
  useEffect(() => { setMounted(true); const on = () => setOpen(true); window.addEventListener("ds:emergency", on); return () => window.removeEventListener("ds:emergency", on); }, []);
  return (<>
    <button onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-coral-d px-2.5 text-[13px] font-semibold text-white hover:brightness-110 focus-visible:outline-2 sm:min-h-9 sm:px-3" aria-haspopup="dialog" aria-label={L.button}>
      <span aria-hidden>✚</span><span className="hidden sm:inline">{L.button}</span><span className="sm:hidden">SOS</span></button>
    {mounted && createPortal(<Modal open={open} onClose={() => setOpen(false)} title={L.title}>   {/* portal: the header's backdrop-filter would otherwise trap position:fixed */}
      <div className="space-y-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">{L.numbers.map((n) => (<a key={n.number} href={`tel:${n.number}`} className="rounded-xl border-2 border-coral-d/30 bg-coral/5 p-3 hover:bg-coral/10">
          <div className="text-2xl font-bold text-coral-d">📞 {n.number}</div><div className="text-[13px]">{n.label}</div><div className="mt-1 text-[11px] text-ink-3">{n.source}</div></a>))}</div>
        <button onClick={() => { setOpen(false); router.push("/geography/?emergency=1"); }} className="w-full rounded-xl bg-forest px-4 py-3 text-left font-semibold text-white hover:bg-forest-2">
          {L.nearest}<span className="block text-[12px] font-normal opacity-80">{L.nearestSub}</span></button>
        <div><div className="font-semibold">{L.signsTitle}</div>
          <p className="text-[12px] text-ink-3">{L.signsWhen}</p>
          <ul className="mt-1 grid list-disc gap-x-6 pl-5 sm:grid-cols-2">{L.signs.map((s) => <li key={s}>{s}</li>)}</ul></div>
        <p className="text-[11px] text-ink-3">{L.note}</p>
      </div>
    </Modal>, document.body)}
  </>);
}
