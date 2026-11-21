const P: Record<string, string> = {
  command: "M3 12l9-8 9 8M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9",
  profiling: "M4 19V9m5 10V5m5 14v-7m5 7V8M3 19h18",
  wards: "M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  lab: "M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2.2h12.4A1.5 1.5 0 0019.5 19L14 9V3M8 14h8",
  copilot: "M12 3a8 8 0 00-7 11.9L4 21l5.3-1.6A8 8 0 1012 3zM8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01",
  evidence: "M9 12l2 2 4-4M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6l7-3z",
  response: "M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z",
  climate: "M7 18a4 4 0 010-8 5.5 5.5 0 0110.6 1.2A3.4 3.4 0 0117 18H7zM8 21l1-2m4 2l1-2m4 2l1-2",
  provenance: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  learn: "M12 3l9 5-9 5-9-5 9-5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5",
  menu: "M4 7h16M4 12h16M4 17h16", close: "M6 6l12 12M18 6L6 18", search: "M11 18a7 7 0 100-14 7 7 0 000 14zm9 3l-4.3-4.3",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14", alert: "M12 4l9 16H3L12 4zm0 6v4m0 3h.01", info: "M12 11v5m0-8.5h.01M12 3a9 9 0 100 18 9 9 0 000-18z",
  play: "M8 5v14l11-7L8 5z", pause: "M8 5v14M16 5v14", send: "M4 12l16-8-6 16-3-7-7-1z", check: "M5 12l4 4 10-10", chevron: "M8 10l4 4 4-4", external: "M14 4h6v6m0-6L10 14M18 14v5H5V6h5",
  shield: "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z", drop: "M12 3s6 6.2 6 10.5A6 6 0 016 13.5C6 9.2 12 3 12 3z",
};
export function Icon({ name, size = 20, className = "" }: { name: string; size?: number; className?: string }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={P[name] ?? P.info} /></svg>);
}
export function Logo({ size = 30 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9fe7c2" /><stop offset="1" stopColor="#0e8f66" /></linearGradient></defs>
    <path d="M16 2.5l11 4v8.2c0 6.2-4.4 11.2-11 14.8C9.4 25.9 5 20.9 5 14.7V6.5l11-4z" fill="url(#lg)" /><path d="M16 8c3 3.4 4.5 5.6 4.5 8a4.5 4.5 0 01-9 0c0-2.4 1.5-4.6 4.5-8z" fill="#073b2b" opacity=".92" /></svg>);
}
