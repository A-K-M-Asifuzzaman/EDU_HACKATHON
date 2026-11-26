// Two colour modes: "light" (default) and "dim" (soft slate-navy, not black). The choice lives on <html data-theme>, is set before
// first paint by a tiny script in app/layout.tsx (no flash), follows the device's dark preference until the user picks one, and is
// remembered in this browser only.
export type Theme = "light" | "dim";
export const THEME_KEY = "ds.theme";
export const getTheme = (): Theme => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dim" ? "dim" : "light");
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  window.dispatchEvent(new Event("ds:theme"));                    // charts re-colour themselves
}
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dim")t=matchMedia("(prefers-color-scheme: dark)").matches?"dim":"light";document.documentElement.dataset.theme=t}catch(e){}document.documentElement.classList.add("js")`;
