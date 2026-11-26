"use client";
// Scroll reveal (DESIGN.md §7): a section fades up 14 px once, the first time it enters the viewport. IntersectionObserver, no scroll
// listeners; under prefers-reduced-motion the CSS shows it immediately.
import { useEffect, useRef, useState } from "react";

export default function Reveal({ children, className = "", as: As = "div", ...rest }: { children: React.ReactNode; className?: string; as?: any; [k: string]: any }) {
  const ref = useRef<HTMLElement>(null); const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setIn(true); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <As ref={ref} className={`reveal ${inView ? "in" : ""} ${className}`} {...rest}>{children}</As>;
}
