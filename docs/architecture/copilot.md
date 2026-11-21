# Copilot: grounded retrieval and read-only tools

[← Architecture overview](../../ARCHITECTURE.md)

## Components

```mermaid
flowchart LR
    q["Question (EN or BN)<br/>+ page context"] --> lim["Limits: input size,<br/>30 req/h per client,<br/>USD budget guard"]
    lim --> ret["Hybrid retrieval<br/>BM25 + text-embedding-3-small"]
    corpus[("Approved documents only<br/>README, ARCHITECTURE, docs/*.md")] --> idx[("rag_index.npz<br/>512-dim vectors")]
    idx --> ret
    ret --> llm["gpt-5.4-mini<br/>Responses API, streaming"]
    llm <-->|"strict schemas"| tools["7 read-only tools<br/>forecast, compare, rankings,<br/>metrics, importance, profile,<br/>facilities"]
    tools --> app["App functions<br/>(same code as the API)"]
    llm --> ans["Answer with citations<br/>streamed as SSE"]
    lim -.->|"no key / budget spent"| fb["Retrieval-only fallback"]
```

## One answer

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant API as /api/assistant/chat
    participant R as Retriever
    participant L as OpenAI Responses
    participant T as Tools
    U->>API: question, language, selected ward/origin
    API->>R: top passages (approved docs only)
    API->>L: system rules + passages + tool schemas
    loop at most a few rounds
        L->>API: tool call (validated, city filter only if the user named one)
        API->>T: run read-only tool
        T-->>API: numbers from the app
        API->>L: tool result
    end
    L-->>U: streamed answer + sources (final round: no more tools)
```

| Guard | Behaviour |
|---|---|
| Secrets | Key only in the backend `.env`; the model is told never to reveal configuration, and secret scans run in tests |
| Holdout | Tools cannot read 2025; requests for 2025 actuals are refused |
| Cost | 900 output tokens, 1 h cache for identical questions, usage log without message content, ≈ $0.002-0.004 per answer |
| Prompt injection | Retrieval is limited to an allow-list of project documents; tool outputs are data, not instructions |
