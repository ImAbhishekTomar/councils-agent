# Councils: Agent Discussion

A local-first agent discussion workspace for exploring how multiple Ollama-backed specialists can debate a question, invite missing expertise, show their communication graph, and synthesize a final answer.

## Run It

```bash
npm install
npm run dev
```

Open http://localhost:5173.

The API runs at http://localhost:8787 and expects Ollama at `http://127.0.0.1:11434`. Override with:

```bash
OLLAMA_URL=http://127.0.0.1:11434 npm run dev
```

## What This Prototype Does

- React single-page playground with question, model, agent count, and round controls.
- Live mind-map using `@xyflow/react`, with draggable circular agents and basic overlap relaxation.
- Server-sent events from a small Node/Express discussion orchestrator.
- Local Ollama model discovery.
- Agent roles: Cartographer, Skeptic, Builder, Memory Keeper, Synthesizer.
- Dynamic specialist creation when an agent invites a missing role.
- Chat-style transcript with token streaming from each speaking agent.
- Graceful fallback messages if Ollama returns non-JSON or is unavailable.

## Recommended Architecture Path

1. **Prototype loop, current version**
   Keep orchestration simple and observable. Stream every event to the UI: agent created, edge created, thought emitted, final answer.

2. **Add durable run memory**
   Store runs, agents, thoughts, edges, and summaries in PostgreSQL. This gives replay, comparison, and long-term memory.

3. **Move orchestration to LangGraph**
   Use LangGraph once the state machine stabilizes: planner node, spawn node, debate node, critique node, memory summarizer, consensus node.

4. **Add retrieval and memory**
   Use short-term memory as the current run transcript. Use long-term memory as summarized prior runs plus embeddings, likely with `pgvector` or a local vector store.

5. **Measure usefulness**
   Do not scale to hundreds of agents blindly. Track answer quality, novelty, cost, latency, agreement, dissent, and whether new agents actually improve the final answer.

## Advice

This is useful as a thinking instrument, research assistant, design critic, decision board, or creative ideation workspace. The benefit is not that “many agents” automatically means a better answer. The benefit comes from role diversity, visible disagreement, memory, and forcing the system to explain why a new specialist is needed.

Similar ideas exist: AutoGen-style multi-agent chat, CrewAI role teams, LangGraph agent graphs, ChatDev-style software teams, and debate/committee prompting. The UI-first version here is still valuable because most agent systems hide the reasoning topology. Seeing who influenced whom can make the system easier to debug and more fun to reason with.

## Near-Term Improvements

- Add PostgreSQL schema for `runs`, `agents`, `messages`, `edges`, and `summaries`.
- Add a true LangGraph.js state graph behind the Express stream.
- Add run replay and timeline scrubbing.
- Add per-agent model assignment, for example `qwen3:8b` for reasoning and `llama3.2` for fast summaries.
- Add consensus rules: majority, strongest dissent, confidence threshold, or moderator decision.
- Add a “spawn budget” so dynamic agents do not explode forever.
