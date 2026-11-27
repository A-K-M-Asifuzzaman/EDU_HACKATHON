"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { num, pct } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Btn, DataTable, Loading, Select, useAsync } from "./ui";

type Policy = {
  tail_weighted_shortage: number;
  mean_weighted_shortage: number;
  worst_unmet: number;
  nominal_unmet: number;
  min_nominal_coverage: number;
};

type Comparison = {
  prior_replay_weeks: string[];
  cities: {
    city: string;
    stock: number;
    reserve: number;
    assignable: number;
    solver: { status: string; runtime_ms: number; gap?: number | null };
    policies: Record<string, Policy>;
  }[];
};

export default function AllocationComparison({ query, city }: { query: string; city: string }) {
  const { lang } = useI18n();
  const bn = lang === "bn";
  const words = bn ? {
    title: "পূর্ববর্তী মৌসুমের চাহিদা দিয়ে বরাদ্দ পরীক্ষা", description: "আগের মৌসুমের ওয়ার্ডগুলোর একসঙ্গে দেখা পূর্বাভাসের ভুল ব্যবহার করে একই মজুত ও ন্যূনতম বরাদ্দে নীতিগুলো তুলনা করুন। এই তুলনা সক্রিয় পরিকল্পনা বদলায় না।",
    resource: "সম্পদ", saline: "স্যালাইন ব্যাগ", kits: "পরীক্ষার কিট", beds: "আঞ্চলিক মজুতের শয্যা", reserve: "সংরক্ষিত অংশ (%)",
    stock: "এই শহরের মজুত", run: "তুলনা চালান", stale: "সেটিংস বদলেছে। নতুন তুলনা চালান।", policy: "নীতি", tail: "খারাপ ২০% পরিস্থিতির ওজনযুক্ত ঘাটতি",
    average: "গড় ওজনযুক্ত ঘাটতি", worst: "সর্বোচ্চ অপূর্ণ চাহিদা", nominal: "প্রাথমিক ঘাটতি", coverage: "ন্যূনতম ওয়ার্ড বরাদ্দ",
    weeks: "পূর্ববর্তী মৌসুমের সপ্তাহ", held: "সংরক্ষিত", available: "বরাদ্দের জন্য উপলব্ধ", optimum: "নির্ধারিত উদ্দেশ্যে সর্বোত্তম", limited: "সময়সীমায় পাওয়া সমাধান", unavailable: "সমাধান পাওয়া যায়নি",
    names: { equal: "সমান", density: "ঘনত্ব", historical: "ঐতিহাসিক ঝুঁকি", forecast: "পূর্বাভাসের ঝুঁকি", hybrid: "বর্তমান মিশ্র নীতি", tail_risk: "সবচেয়ে খারাপ পরিস্থিতির ঝুঁকি" },
  } : {
    title: "Historical demand stress test", description: "Compare policies on complete ward-error patterns from prior seasons, using the same stock and fairness floor. This comparison does not change the active plan.",
    resource: "Resource", saline: "Saline bags", kits: "Diagnostic kits", beds: "Regional-stock beds", reserve: "Emergency reserve (%)",
    stock: "Exact stock for this city", run: "Run comparison", stale: "Settings changed. Run a new comparison.", policy: "Policy", tail: "Worst 20% weighted shortfall",
    average: "Mean weighted shortfall", worst: "Worst unmet units", nominal: "Nominal unmet units", coverage: "Minimum ward coverage",
    weeks: "prior-season weeks", held: "reserved", available: "assignable", optimum: "Optimal for the stated objective", limited: "Feasible within time limit", unavailable: "No verified solution",
    names: { equal: "Equal", density: "Density", historical: "Historical risk", forecast: "Forecast risk", hybrid: "Current hybrid", tail_risk: "Tail-risk plan" },
  };
  const [resource, setResource] = useState("saline_bags_needed");
  const [reserve, setReserve] = useState("0");
  const [units, setUnits] = useState("");
  const [requested, setRequested] = useState<string | null>(null);
  const request = new URLSearchParams(query);
  request.set("resource", resource);
  request.set("reserve_pct", reserve || "0");
  if (city !== "All" && units !== "") request.set("supply_units", units);
  const path = `/api/allocation/uncertainty?${request}`;
  const valid = Number.isInteger(Number(reserve)) && Number(reserve) >= 0 && Number(reserve) <= 30
    && (city === "All" || (Number.isInteger(Number(units)) && Number(units) >= 0 && Number(units) <= 100_000));
  const q = useAsync((signal) => requested ? api<Comparison>(requested, { signal }) : Promise.resolve(null), [requested]);
  const run = () => { if (requested === path) q.reload(); else setRequested(path); };

  return <details className="mt-4 rounded-xl border border-line p-4 text-[13px] text-ink-2">
    <summary className="cursor-pointer font-semibold text-ink">{words.title}</summary>
    <p className="mt-2">{words.description}</p>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <Select label={words.resource} value={resource} onChange={setResource} options={[
        { value: "saline_bags_needed", label: words.saline }, { value: "diagnostic_kits_needed", label: words.kits },
        { value: "hospital_beds_required", label: words.beds },
      ]} />
      <label className="grid gap-1"><span>{words.reserve}</span><input className="w-24 rounded-lg border border-line bg-ivory p-2 text-ink" type="number" min="0" max="30" step="1" value={reserve} onChange={e => setReserve(e.target.value)} /></label>
      {city !== "All" && <label className="grid gap-1"><span>{words.stock}</span><input className="w-32 rounded-lg border border-line bg-ivory p-2 text-ink" type="number" min="0" max="100000" step="1" value={units} onChange={e => setUnits(e.target.value)} /></label>}
      <Btn variant="ghost" onClick={run} disabled={!valid || (requested === path && q.loading)}>{words.run}</Btn>
    </div>
    {requested && (requested !== path ? <p role="status" className="mt-3">{words.stale}</p> : <div className="mt-3">
      <Loading<Comparison> q={q} h={150} kind="table" label={words.title}>{d => <>
        <p>{num(d.prior_replay_weeks.length, lang)} {words.weeks}</p>
        {d.cities.map(pool => <details key={pool.city} open={d.cities.length === 1} className="mt-3 rounded-lg border border-line p-3">
          <summary className="cursor-pointer font-semibold text-ink">{pool.city} · {num(pool.reserve, lang)} {words.held} · {num(pool.assignable, lang)} {words.available}</summary>
          <p className="my-2">{pool.solver.status === "optimal" ? words.optimum : pool.solver.status === "feasible_limit" ? words.limited : words.unavailable} · {num(pool.solver.runtime_ms, lang, 1)} ms</p>
          <DataTable dense rows={Object.entries(pool.policies).map(([policy, metrics]) => ({ policy, ...metrics }))} cols={[
            { key: "policy", label: words.policy, render: row => words.names[row.policy as keyof typeof words.names] },
            { key: "tail_weighted_shortage", label: words.tail, align: "right", render: row => num(row.tail_weighted_shortage, lang, 2) },
            { key: "mean_weighted_shortage", label: words.average, align: "right", render: row => num(row.mean_weighted_shortage, lang, 2) },
            { key: "worst_unmet", label: words.worst, align: "right", render: row => num(row.worst_unmet, lang) },
            { key: "nominal_unmet", label: words.nominal, align: "right", render: row => num(row.nominal_unmet, lang) },
            { key: "min_nominal_coverage", label: words.coverage, align: "right", render: row => pct(row.min_nominal_coverage, lang) },
          ]} />
        </details>)}
      </>}</Loading>
    </div>)}
  </details>;
}
