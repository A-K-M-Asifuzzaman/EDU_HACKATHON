import type { Lang } from "./i18n";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const toBn = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[+d]);

export function num(v: number | null | undefined, lang: Lang, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  return lang === "bn" ? toBn(s) : s;
}
export const pct = (v: number | null | undefined, lang: Lang, digits = 0) => (v === null || v === undefined ? "—" : num(v * 100, lang, digits) + "%");

const MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m: number, lang: Lang) => (lang === "bn" ? MONTHS_BN[m - 1] : MONTHS_EN[m - 1]);

export function dateFmt(iso: string, lang: Lang, withYear = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  const s = `${d} ${monthName(m, lang)}${withYear ? " " + y : ""}`;
  return lang === "bn" ? toBn(s) : s;
}
export const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
export function download(name: string, text: string, mime = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
export const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
};
export const isoWeek = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); const t = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return Math.min(52, Math.ceil(((+d - +t) / 86400000 + ((t.getUTCDay() + 6) % 7) + 1) / 7)); };
