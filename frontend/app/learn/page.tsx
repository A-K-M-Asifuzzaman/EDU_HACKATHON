"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Btn, Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import RainExplainer from "@/components/rainexplainer";
import type { Part } from "@/components/mosquito3d";
import { Lifecycle } from "@/components/illustrations";

const Mosquito3D = dynamic(() => import("@/components/mosquito3d"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-sm text-mint">Loading 3D…</div> });
const FACTS: Record<Part, { name: string; text: string }> = {
  head: { name: "Head", text: "Carries the eyes, antennae and mouthparts." },
  proboscis: { name: "Proboscis", text: "The piercing mouthpart. Only female mosquitoes feed on blood; they use it to bite." },
  thorax: { name: "Thorax", text: "The middle body section where the wings and legs attach. Aedes aegypti is often described as having a lyre-shaped pale marking here (stylised in this model)." },
  wings: { name: "Wings", text: "Mosquitoes, like other true flies, have one pair of functional wings." },
  abdomen: { name: "Abdomen", text: "The rear body section; a blood meal is stored here and eggs develop here." },
  legs: { name: "Legs", text: "Six legs. Aedes aegypti is commonly described as having white banding on its legs (stylised here)." },
};

export default function Learn() {
  const reduce = !!useReducedMotion();
  const [capable, setCapable] = useState<boolean | null>(null);
  const [load, setLoad] = useState(false);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState<Part | null>(null);
  const [view, setView] = useState("3/4");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { const c = document.createElement("canvas"); const gl = c.getContext("webgl2") || c.getContext("webgl"); const small = window.innerWidth < 640 || (navigator.hardwareConcurrency ?? 8) < 4; setCapable(!!gl && !small); } catch { setCapable(false); }
  }, []);
  useEffect(() => { if (!box.current) return; const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 }); io.observe(box.current); return () => io.disconnect(); }, [load]);
  return (<>
    <PageHeader art={<Lifecycle className="w-full" />} eyebrow="Educational · conceptual" title="Learn: Aedes & rainfall" sub="Why rain today shows up as cases weeks later, and a small interactive mosquito model. Both are explanatory illustrations; neither is part of the forecasting engine." />
    <Card className="mb-5"><CardTitle title="From rainfall to a dengue forecast window" sub="Drag the slider to move through time" /><RainExplainer /></Card>
    <Card><CardTitle title="Interactive mosquito (stylised)" sub="Free, procedural 3D (React Three Fiber). Not an anatomical reconstruction. Hover or tap parts, or choose a view." />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div ref={box} className="relative h-[380px] overflow-hidden rounded-[14px] border-[2.5px] border-[#1a1438] bg-[#4a2bd0]">
          {load && capable ? <Mosquito3D active={active} onHover={setActive} view={view} reduce={reduce} visible={visible} /> : (
            <div className="grid h-full place-items-center p-6 text-center"><div><svg viewBox="0 0 220 120" className="mx-auto mb-3 w-56" role="img" aria-label="Stylised mosquito illustration"><g fill="#c9c6ff" stroke="#c9c6ff"><ellipse cx="95" cy="70" rx="46" ry="12" /><circle cx="152" cy="64" r="9" /><line x1="160" y1="64" x2="205" y2="76" strokeWidth="2" /><ellipse cx="95" cy="48" rx="38" ry="9" fillOpacity="0.35" transform="rotate(-18 95 48)" />{[60, 80, 100, 118].map((x) => <line key={x} x1={x} y1="78" x2={x - 14} y2="108" strokeWidth="2" />)}</g></svg>
              <p className="mb-3 text-sm text-white/90">{capable === false ? "3D is turned off on this device (small screen, low-power or no WebGL). The forecasting dashboard does not need it." : "The 3D scene loads only when you ask for it, to keep the rest of the app fast."}</p>
              {capable && <Btn onClick={() => setLoad(true)}>Load 3D mosquito</Btn>}</div></div>)}
          {load && capable && <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/40 px-2 py-0.5 text-[11px] text-white/80">Drag to orbit · hover parts</div>}</div>
        <div className="space-y-3"><div className="flex flex-wrap gap-1.5">{Object.keys({ side: 1, front: 1, top: 1, "3/4": 1 }).map((v) => (<button key={v} onClick={() => setView(v)} aria-pressed={view === v} disabled={!(load && capable)} className={"rounded-lg border px-2.5 py-1 text-xs " + (view === v ? "border-emerald bg-mint-l font-semibold" : "border-line")}>{v} view</button>))}</div>
          <ul className="space-y-1.5">{(Object.keys(FACTS) as Part[]).map((p) => (<li key={p}><button onMouseEnter={() => setActive(p)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(p)} onBlur={() => setActive(null)} onClick={() => setActive(p)} className={"w-full rounded-xl border p-2.5 text-left text-[13px] transition " + (active === p ? "border-emerald bg-mint-l" : "border-line hover:bg-canvas")}><b className="text-forest">{FACTS[p].name}</b><span className="block text-xs text-ink-2">{FACTS[p].text}</span></button></li>))}</ul></div></div>
      <div className="mt-3"><Notice>Labels are general educational facts. The model is a simple stylised shape and is not a scientifically validated anatomical reconstruction. Mosquito control guidance should come from national health authorities and WHO.</Notice></div></Card>
  </>);
}
