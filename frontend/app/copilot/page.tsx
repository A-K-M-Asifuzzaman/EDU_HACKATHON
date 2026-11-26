"use client";
import { useI18n } from "@/lib/i18n";
import { ChatPanel } from "@/components/chat";
import { Card, Notice, PageHeader } from "@/components/ui";
import { ChatCloud } from "@/components/illustrations";

export default function CopilotPage() {
  const { t } = useI18n();
  return (<>
    <PageHeader art={<ChatCloud className="w-full" />} eyebrow="Retrieval-augmented · OpenAI Responses API · read-only tools" title={`${t("copilot.title")}`} sub="Ask about the model, the data, a ward's forecast or the limits of the evidence. Answers cite project documents and call the same validated APIs the dashboard uses; the assistant never computes a forecast itself." />
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]"><Card><ChatPanel /></Card>
      <div className="grid content-start gap-4"><Card><h3 className="mb-2 text-sm font-semibold text-forest">How it stays grounded</h3><ul className="list-disc space-y-1.5 pl-5 text-[12.5px] text-ink-2"><li>Hybrid retrieval (BM25 + multilingual embeddings) over approved project documents only.</li><li>Forecasts, rankings and metrics come from tool calls to the application, not from the model's memory.</li><li>Source cards show what was retrieved; unsupported questions get an explicit "not supported".</li><li>Retrieved text is treated as untrusted data (prompt-injection safe).</li><li>No diagnosis, treatment or dosing advice. No 2025 outcomes.</li><li>Backend-only API key, per-session rate limit, output cap and budget cap.</li></ul></Card>
        <Notice tone="warn">Chat uses the paid OpenAI API (estimated cost shown per answer). If it is unavailable, the rest of DengueShield is unaffected.</Notice></div></div>
  </>);
}
