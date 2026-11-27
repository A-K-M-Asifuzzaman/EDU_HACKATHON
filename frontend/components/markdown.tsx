"use client";
// Sanitised Markdown renderer (split from ui.tsx so pages that never show Markdown do not download it).
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { cls } from "@/lib/format";

function resolveDoc(from: string, href: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of href.split("#")[0].split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts.join("/");
}
export function Markdown({ children, docPath, docs, onDoc, chat, onCite }: { children: string; docPath?: string; docs?: string[]; onDoc?: (path: string) => void; chat?: boolean; onCite?: (id: string) => void }) {
  const sectionId = (slug: string) => `doc-section-${docPath}-${slug}`;
  return <div className={cls("prose-md text-[13.5px] leading-relaxed", chat && "prose-chat")}><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}
    components={{ h2: ({ children }) => {
      const slug = String(children).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s+/g, "-");
      return <h2 id={docPath ? sectionId(slug) : undefined} tabIndex={docPath ? -1 : undefined}>{children}</h2>;
    }, a: ({ href, children }) => {
      const cite = href?.match(/cite-(S\d+)$/);
      if (onCite && cite) return <button type="button" onClick={() => onCite(cite[1])} className="ds-cite" title={`Show source ${cite[1]}`}>{cite[1]}</button>;
      if (docPath && href?.startsWith("#")) {
        const id = sectionId(href.slice(1));
        return <a href={`#${id}`} onClick={(e) => {
          e.preventDefault();
          const heading = document.getElementById(id);
          heading?.focus({ preventScroll: true });
          heading?.scrollIntoView({ block: "start" });
        }} className="text-emerald-d underline">{children}</a>;
      }
      const rel = !!href && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href);
      if (docPath && onDoc && rel) {
        const target = resolveDoc(docPath, href!);
        if (target && docs?.includes(target)) return <a href={`#${target}`} onClick={(e) => { e.preventDefault(); onDoc(target); }} className="text-emerald-d underline">{children}</a>;
        return <span title="Not available in the in-app viewer; see the repository">{children}</span>;
      }
      return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-emerald-d underline">{children}</a>;
    } }}>{children}</ReactMarkdown></div>;
}
