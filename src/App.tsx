import { CircleStop, Database, GitBranch, MessageSquareText, Play, RadioTower, RotateCcw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import councilsIcon from './assets/logo/councils-icon-light.png';
import GraphPanel from './GraphPanel';
import { clearPendingUpload, getPendingUpload } from './store/pendingUpload';

type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
  category: 'coding' | 'trading' | 'creative' | 'general';
  phase: 'discussion' | 'frame' | 'perspective' | 'critique' | 'build' | 'synthesize';
  profile: {
    temperament: string;
    expertise: string;
    memoryStyle: string;
    riskBias: string;
    speakingStyle: string;
    goals: string;
    constraints: string;
  };
  llmSettings: {
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    frequencyPenalty: number;
    presencePenalty: number;
  };
  color: string;
  confidence: number;
  uuid: string;
  gender: string;
  fullName: string | null;
  userRole: string | null;
  summary: string;
  labels: string[];
  createdAt: string;
  avatarUrl?: string;
};

type SwarmEvent =
  | { type: 'status'; message: string }
  | { type: 'agent_created'; agent: Agent; reason: string }
  | { type: 'message_start'; id: string; from: string; to: string[]; label: string }
  | { type: 'message_delta'; id: string; delta: string }
  | { type: 'message_done'; id: string; from: string; message: string; confidence: number }
  | { type: 'image_start'; id: string; messageId: string; from: string; prompt: string }
  | { type: 'image_done'; id: string; messageId: string; from: string; prompt: string; url: string }
  | { type: 'image_error'; id: string; messageId: string; from: string; message: string }
  | { type: 'edge'; from: string; to: string; label: string }
  | { type: 'final_start'; id: string }
  | { type: 'final_delta'; id: string; delta: string }
  | { type: 'final'; id: string; answer: string; confidence: number }
  | { type: 'error'; message: string };

type TranscriptItem = {
  id: string;
  agent?: Agent;
  kind: 'status' | 'thought' | 'final' | 'error';
  text: string;
  confidence?: number;
  streaming?: boolean;
  targets?: string[];
  image?: {
    id: string;
    prompt: string;
    status: 'loading' | 'ready' | 'error';
    url?: string;
    error?: string;
  };
};

type AgentNodeData = {
  agent: Agent;
  active: boolean;
  isHub?: boolean;
};

type AppNode = {
  id: string;
  type?: string;
  data: AgentNodeData;
  position: { x: number; y: number };
  draggable?: boolean;
};

type AppEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  animated?: boolean;
  type?: string;
  style?: React.CSSProperties;
};

type SidePanelTab = 'transcript' | 'plan' | 'system';

type ModelOption = {
  id: string;
  label: string;
  provider: 'ollama' | 'openrouter';
};

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';
const defaultQuestion = 'dose god is exists?';

function colorForAgentIndex(index: number) {
  const hue = (index * 137.508 + 162) % 360;
  const saturation = 68 + (index % 3) * 7;
  const lightness = 50 + (index % 4) * 4;
  return `hsl(${Math.round(hue)} ${saturation}% ${lightness}%)`;
}

function App() {
  const [question, setQuestion] = useState(defaultQuestion);
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [agentTarget, setAgentTarget] = useState(0);
  const [rounds, setRounds] = useState(0);
  const [nodes, setNodes] = useState<AppNode[]>([]);
  const [edges, setEdges] = useState<AppEdge[]>([]);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
  const [finalAnswer, setFinalAnswer] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [activeSideTab, setActiveSideTab] = useState<SidePanelTab>('transcript');
  const eventSourceRef = useRef<EventSource | null>(null);
  const avatarAbortControllerRef = useRef<AbortController | null>(null);
  const agentsRef = useRef<Record<string, Agent>>({});
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [transcript]);

  useEffect(() => {
    fetch(`${apiBase}/api/models`)
      .then((response) => response.json())
      .then((data: { ok?: boolean; models?: string[]; modelOptions?: ModelOption[]; openRouterConfigured?: boolean }) => {
        const nextModels = data.modelOptions ?? data.models?.map((id) => ({ id, label: id, provider: id.startsWith('openrouter/') || id.endsWith(':free') ? 'openrouter' as const : 'ollama' as const })) ?? [];
        setModels(nextModels);

        if (nextModels.length) {
          const modelIds = nextModels.map((option) => option.id);
          const preferredModel =
            data.openRouterConfigured && modelIds.includes('openrouter/free')
                ? 'openrouter/free'
                : data.ok && modelIds.includes('qwen3:8b')
                  ? 'qwen3:8b'
                  : modelIds[0];
          setModel(preferredModel);
          setStatus(`Models ready: ${nextModels.length} available`);
        } else {
          setModel('');
          setStatus('No model provider available. Start Ollama or set OPENROUTER_API_KEY.');
        }
      })
      .catch(() => {
        setStatus('Model discovery failed. Councils can still show fallback discussion events.');
      });
  }, []);

  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: { ...node.data, active: activeAgentIds.includes(node.id) },
      })),
    );
  }, [activeAgentIds]);

  useEffect(() => {
    if (nodes.length < 2) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      setNodes((current) => relaxNodePositions(current));
      if (ticks > 26) window.clearInterval(timer);
    }, 34);

    return () => window.clearInterval(timer);
  }, [nodes.length]);

  const [showEdgeLabels, setShowEdgeLabels] = useState(false);

  const resetRun = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    avatarAbortControllerRef.current?.abort();
    avatarAbortControllerRef.current = new AbortController();
    setNodes([]);
    setEdges([]);
    setTranscript([]);
    setAgents({});
    setSelectedAgentId(undefined);
    setActiveAgentIds([]);
    setFinalAnswer('');
    setIsRunning(false);
    setStatus('Idle');
  }, []);

  const stopRun = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    avatarAbortControllerRef.current?.abort();
    avatarAbortControllerRef.current = new AbortController();
    setIsRunning(false);
    setActiveAgentIds([]);
    setStatus('Stopped');
  }, []);

  const appendTranscript = useCallback((item: Omit<TranscriptItem, 'id'>) => {
    setTranscript((current) => [
      ...current,
      {
        ...item,
        id: `${Date.now()}-${current.length}`,
      },
    ]);
  }, []);

  const startStreamingMessage = useCallback((item: TranscriptItem) => {
    setTranscript((current) => [...current, item]);
  }, []);

  const appendDelta = useCallback((id: string, delta: string) => {
    setTranscript((current) =>
      current.map((item) => (item.id === id ? { ...item, text: `${item.text}${delta}`, streaming: true } : item)),
    );
  }, []);

  const finishStreamingMessage = useCallback((id: string, confidence: number, finalText?: string) => {
    setTranscript((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              text: finalText ?? item.text,
              confidence,
              streaming: false,
            }
          : item,
      ),
    );
  }, []);

  const startTranscriptImage = useCallback((messageId: string, image: { id: string; prompt: string }) => {
    setTranscript((current) =>
      current.map((item) =>
        item.id === messageId
          ? {
              ...item,
              image: {
                id: image.id,
                prompt: image.prompt,
                status: 'loading',
              },
            }
          : item,
      ),
    );
  }, []);

  const finishTranscriptImage = useCallback((messageId: string, image: { id: string; prompt: string; url: string }) => {
    setTranscript((current) =>
      current.map((item) =>
        item.id === messageId
          ? {
              ...item,
              image: {
                id: image.id,
                prompt: image.prompt,
                status: 'ready',
                url: image.url,
              },
            }
          : item,
      ),
    );
  }, []);

  const failTranscriptImage = useCallback((messageId: string, imageId: string, error: string) => {
    setTranscript((current) =>
      current.map((item) =>
        item.id === messageId && item.image?.id === imageId
          ? {
              ...item,
              image: {
                ...item.image,
                status: 'error',
                error,
              },
            }
          : item,
      ),
    );
  }, []);

  const requestAgentAvatar = useCallback((agent: Agent) => {
    if (!avatarAbortControllerRef.current || avatarAbortControllerRef.current.signal.aborted) {
      avatarAbortControllerRef.current = new AbortController();
    }

    fetch(`${apiBase}/api/agents/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
      signal: avatarAbortControllerRef.current.signal,
    })
      .then(async (response) => {
        const data = await response.json() as { ok?: boolean; url?: string };
        if (!response.ok || !data.ok || !data.url) return;

        setAgents((current) => {
          const currentAgent = current[agent.id];
          if (!currentAgent) return current;
          return { ...current, [agent.id]: { ...currentAgent, avatarUrl: data.url } };
        });
        setNodes((current) =>
          current.map((node) =>
            node.id === agent.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    agent: { ...node.data.agent, avatarUrl: data.url },
                  },
                }
              : node,
          ),
        );
        setTranscript((current) =>
          current.map((item) =>
            item.agent?.id === agent.id
              ? {
                  ...item,
                  agent: { ...item.agent, avatarUrl: data.url },
                }
              : item,
          ),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });
  }, []);

  const handleSwarmEvent = useCallback(
    (event: SwarmEvent) => {
      if (event.type === 'status') {
        setStatus(event.message);
        appendTranscript({ kind: 'status', text: event.message });
        return;
      }

      if (event.type === 'agent_created') {
        // Prefer the (richer) join reason as the node summary when present.
        const nextColor = colorForAgentIndex(Object.keys(agentsRef.current).length);
        const agent: Agent = { ...event.agent, color: nextColor, summary: event.reason || event.agent.summary };
        setAgents((current) => ({ ...current, [agent.id]: agent }));
        setNodes((current) => layoutMindMapNodes([
          ...current,
          {
            id: agent.id,
            type: 'agent',
            position: nextPosition(current.length),
            data: { agent, active: false, isHub: current.length === 0 },
            draggable: true,
          },
        ]));
        appendTranscript({
          agent: event.agent,
          kind: 'status',
          text: `${event.agent.name} joined: ${event.reason}`,
        });
        requestAgentAvatar(agent);
        return;
      }

      if (event.type === 'edge') {
        setEdges((current) => upsertEdge(current, event.from, event.to, event.label));
        return;
      }

      if (event.type === 'message_start') {
        setActiveAgentIds((current) => (current.includes(event.from) ? current : [...current, event.from]));
        startStreamingMessage({
          id: event.id,
          agent: agentsRef.current[event.from],
          kind: 'thought',
          text: '',
          streaming: true,
          targets: event.to,
        });
        return;
      }

      if (event.type === 'message_delta') {
        appendDelta(event.id, event.delta);
        return;
      }

      if (event.type === 'message_done') {
        setAgents((current) => {
          const agent = current[event.from];
          if (!agent) return current;
          return { ...current, [event.from]: { ...agent, confidence: event.confidence } };
        });
        setNodes((current) =>
          current.map((node) =>
            node.id === event.from
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    active: false,
                    agent: { ...node.data.agent, confidence: event.confidence },
                  },
                }
              : node,
          ),
        );
        setActiveAgentIds((current) => current.filter((id) => id !== event.from));
        finishStreamingMessage(event.id, event.confidence, event.message);
        return;
      }

      if (event.type === 'image_start') {
        startTranscriptImage(event.messageId, { id: event.id, prompt: event.prompt });
        return;
      }

      if (event.type === 'image_done') {
        finishTranscriptImage(event.messageId, { id: event.id, prompt: event.prompt, url: event.url });
        return;
      }

      if (event.type === 'image_error') {
        failTranscriptImage(event.messageId, event.id, event.message);
        return;
      }

      if (event.type === 'final_start') {
        startStreamingMessage({
          id: event.id,
          kind: 'final',
          text: '',
          streaming: true,
        });
        return;
      }

      if (event.type === 'final_delta') {
        appendDelta(event.id, event.delta);
        return;
      }

      if (event.type === 'final') {
        setFinalAnswer(event.answer);
        setStatus(`Consensus confidence ${Math.round(event.confidence * 100)}%`);
        setIsRunning(false);
        setActiveAgentIds([]);
        finishStreamingMessage(event.id, event.confidence, event.answer);
        return;
      }

      if (event.type === 'error') {
        setStatus(event.message);
        setIsRunning(false);
        setActiveAgentIds([]);
        appendTranscript({ kind: 'error', text: event.message });
        eventSourceRef.current?.close();
      }
    },
    [appendDelta, appendTranscript, failTranscriptImage, finishStreamingMessage, finishTranscriptImage, requestAgentAvatar, startStreamingMessage, startTranscriptImage],
  );

  const startRun = useCallback(() => {
    if (!model) {
      setStatus('No model selected. Start Ollama or set OPENROUTER_API_KEY.');
      return;
    }

    resetRun();
    setIsRunning(true);
    setStatus('Opening council session');
    const clampedAgentTarget = Math.max(0, agentTarget);
    const clampedRounds = Math.max(0, rounds);
    const params = new URLSearchParams({
      q: question,
      model,
      agents: String(clampedAgentTarget),
      rounds: String(clampedRounds),
    });
    const source = new EventSource(`${apiBase}/api/swarm/stream?${params.toString()}`);
    eventSourceRef.current = source;
    source.addEventListener('swarm', (message) => handleSwarmEvent(JSON.parse(message.data) as SwarmEvent));
    source.onerror = () => {
      setStatus('Council stream disconnected. Check that the server and Ollama are running.');
      setIsRunning(false);
      source.close();
    };
  }, [agentTarget, handleSwarmEvent, model, question, resetRun, rounds]);

  // If we arrived here from Home's "Start Council", prefill the prompt and run.
  useEffect(() => {
    const pending = getPendingUpload();
    if (pending.isPending && pending.simulationRequirement.trim()) {
      setQuestion(pending.simulationRequirement);
      clearPendingUpload();
      setAutoStart(true);
    }
  }, []);

  useEffect(() => {
    if (!autoStart) return;
    setAutoStart(false);
    startRun();
  }, [autoStart, startRun]);

  const latestAgents = Object.values(agents);
  const avgConfidence = latestAgents.length
    ? Math.round((latestAgents.reduce((sum, agent) => sum + agent.confidence, 0) / latestAgents.length) * 100)
    : 0;
  const runPhase = finalAnswer ? 2 : latestAgents.length ? 1 : isRunning ? 0 : -1;

  return (
    <main className="shell">
      <nav className="navbar">
        <div className="nav-brand-group">
          <button className="brand" type="button" onClick={resetRun} title="Reset council">
            <img src={councilsIcon} alt="" />
            <span>
              Councils
              <small>Agent Discussion</small>
            </span>
          </button>
        </div>

        <div className="nav-controls">
          <label className="nav-prompt">
            <span>Simulation prompt</span>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} wrap="off" />
          </label>
          <label>
            <span>Model</span>
            <select value={model} onChange={(event) => setModel(event.target.value)} disabled={models.length === 0}>
              {models.length === 0 ? (
                <option value="">No provider available</option>
              ) : null}
              {models.map((modelOption) => (
                <option key={modelOption.id} value={modelOption.id}>
                  {modelOption.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Agents</span>
            <input
              min="0"
              type="number"
              value={agentTarget}
              onChange={(event) => setAgentTarget(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Rounds</span>
            <input min="0" type="number" value={rounds} onChange={(event) => setRounds(Number(event.target.value))} />
          </label>
        </div>

        <div className="nav-status">
          <span className={`status-indicator ${isRunning ? 'processing' : finalAnswer ? 'completed' : ''}`}>
            <span className="dot" />
            {isRunning ? 'Processing' : finalAnswer ? 'Ready' : 'Idle'}
          </span>
          <div className="run-controls">
            <button className="icon-button" type="button" onClick={resetRun} title="Reset run">
              <RotateCcw size={18} />
            </button>
            {isRunning ? (
              <button className="primary-button stop" type="button" onClick={stopRun}>
                <CircleStop size={18} /> Stop Council
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={startRun} disabled={!model}>
                <Play size={18} /> Start Council
              </button>
            )}
          </div>
        </div>
      </nav>

      <section className="workspace">
        <section className="graph-panel">
          <div className="graph-toolbar">
            <div>
              <strong>{status}</strong>
              <span>{latestAgents.length} voices · {edges.length} exchanges · {avgConfidence}% consensus signal</span>
            </div>
            <div className="graph-toolbar-tools">
              <RadioTower size={17} />
              <Sparkles size={17} />
            </div>
          </div>
          <GraphPanel
            nodes={nodes}
            edges={edges}
            activeAgentIds={activeAgentIds}
            selectedAgentId={selectedAgentId}
            showEdgeLabels={showEdgeLabels}
            onToggleEdgeLabels={() => setShowEdgeLabels((current) => !current)}
            onSelectAgent={(id) => setSelectedAgentId(id)}
          />
        </section>
      </section>

      <aside className="side-panel">
        <div className="side-tabs" role="tablist" aria-label="Councils side panel">
          {[
            ['transcript', MessageSquareText, 'Transcript'],
            ['plan', GitBranch, 'Consensus'],
            ['system', Database, 'System'],
          ].map(([id, Icon, label]) => (
            <button
              aria-controls={`side-tab-${id}`}
              aria-selected={activeSideTab === id}
              className={`side-tab ${activeSideTab === id ? 'active' : ''}`}
              key={id as string}
              onClick={() => setActiveSideTab(id as SidePanelTab)}
              role="tab"
              type="button"
            >
              <Icon size={15} />
              <span>{label as string}</span>
            </button>
          ))}
        </div>

        <div className="side-tab-content">
          {activeSideTab === 'transcript' && (
            <section className="transcript-panel" id="side-tab-transcript" role="tabpanel">
              <div className="panel-title">
                <MessageSquareText size={18} />
                <h2>Transcript</h2>
              </div>
              <div className="transcript" ref={transcriptRef}>
                {transcript.length === 0 && <p className="empty">Start a council to watch agents join, challenge assumptions, and converge.</p>}
                {transcript.map((item) => (
                  <article className={`line ${item.kind}`} key={item.id}>
                    <div className="line-meta">
                      <span className="line-agent">
                        {item.agent && (
                          <span className="line-agent-avatar" style={{ '--agent-color': item.agent.color } as React.CSSProperties}>
                            {item.agent.avatarUrl && <img alt="" loading="lazy" src={item.agent.avatarUrl} />}
                          </span>
                        )}
                        <span>{item.agent?.name ?? item.kind}</span>
                      </span>
                      {typeof item.confidence === 'number' && <span>{Math.round(item.confidence * 100)}%</span>}
                    </div>
                    <p>
                      {item.text}
                      {item.streaming && <span className="typing-caret" />}
                    </p>
                    {item.image?.status === 'loading' && (
                      <div className="line-image line-image-loading">
                        <span />
                        <strong>Generating visual</strong>
                      </div>
                    )}
                    {item.image?.status === 'ready' && item.image.url && (
                      <figure className="line-image">
                        <img alt={item.image.prompt} loading="lazy" src={item.image.url} />
                        <figcaption>{item.image.prompt}</figcaption>
                      </figure>
                    )}
                    {item.image?.status === 'error' && (
                      <div className="line-image line-image-error">
                        <strong>Image skipped</strong>
                        {item.image.error && <span>{item.image.error}</span>}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeSideTab === 'plan' && (
            <section className="answer-panel" id="side-tab-plan" role="tabpanel">
              <div className="panel-title">
                <GitBranch size={18} />
                <h2>Consensus</h2>
              </div>
              <p>
                The council records each argument, weighs specialist confidence, and turns the discussion into a concise recommendation.
              </p>
              {finalAnswer && <div className="final-answer">{finalAnswer}</div>}
            </section>
          )}

          {activeSideTab === 'system' && (
            <section className="system-panel" id="side-tab-system" role="tabpanel">
              <div className="panel-title">
                <Database size={18} />
                <h2>System</h2>
              </div>
              <p>Upload context, tune the council size, then let the agents build a structured discussion graph.</p>
              <div className="metrics-row">
                <div className="metric-card">
                  <strong>{latestAgents.length || '--'}</strong>
                  <span>council voices</span>
                </div>
                <div className="metric-card">
                  <strong>{edges.length || '--'}</strong>
                  <span>relations</span>
                </div>
              </div>
              <div className="workflow-list">
                {[
                  ['01', 'Council opens', runPhase >= 0],
                  ['02', 'Arguments connect', runPhase >= 1],
                  ['03', 'Consensus answer', runPhase >= 2],
                ].map(([step, label, done]) => (
                  <div className={`workflow-item ${done ? 'complete' : ''}`} key={step as string}>
                    <span className="step-num">{step}</span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </main>
  );
}

function nextPosition(index: number) {
  if (index === 0) return { x: 520, y: 320 };
  const radius = 250 + Math.floor((index - 1) / 8) * 145;
  const angle = (index - 1) * 1.37 - Math.PI / 2;
  return {
    x: 520 + Math.cos(angle) * radius,
    y: 320 + Math.sin(angle) * radius,
  };
}

function layoutMindMapNodes(nodes: AppNode[]) {
  const positioned = nodes.map((node, index) => ({
    ...node,
    position: nextPosition(index),
    data: { ...node.data, isHub: index === 0 },
  }));

  return relaxNodePositions(positioned, 10);
}

function relaxNodePositions(nodes: AppNode[], passes = 1) {
  const minDistance = 148;
  const center = { x: 520, y: 320 };
  const next = nodes.map((node) => ({ ...node, position: { x: node.position.x, y: node.position.y } }));

  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < next.length; i += 1) {
      for (let j = i + 1; j < next.length; j += 1) {
        const first = next[i];
        const second = next[j];
        if (!first || !second) continue;
        const dx = second.position.x - first.position.x;
        const dy = second.position.y - first.position.y;
        const distance = Math.max(Math.hypot(dx, dy), 0.01);

        if (distance < minDistance) {
          const push = (minDistance - distance) * 0.18;
          const ux = dx / distance;
          const uy = dy / distance;
          if (!first.data.isHub) {
            first.position.x -= ux * push;
            first.position.y -= uy * push;
          }
          if (!second.data.isHub) {
            second.position.x += ux * push;
            second.position.y += uy * push;
          }
        }
      }

      const node = next[i];
      if (!node) continue;
      if (node.data.isHub) {
        node.position = center;
      } else {
        node.position.x += (center.x - node.position.x) * 0.003;
        node.position.y += (center.y - node.position.y) * 0.003;
      }
    }
  }

  return next;
}

function upsertEdge(edges: AppEdge[], from: string, to: string, label: string) {
  const id = `${from}-${to}`;
  if (edges.some((edge) => edge.id === id)) {
    return edges.map((edge) => {
      if (edge.id !== id) return edge;
      const nextLabel = isGenericEdgeLabel(label) && !isGenericEdgeLabel(edge.label) ? edge.label : label;
      return { ...edge, label: nextLabel, animated: true };
    });
  }
  return [
    ...edges,
    {
      id,
      source: from,
      target: to,
      label,
      animated: true,
      type: 'default',
      style: {
        stroke: '#7fb7ff',
        strokeWidth: 1.4,
      },
    },
  ];
}

function isGenericEdgeLabel(label: string) {
  return ['adds context', 'agent view'].includes(label) || label.endsWith("'s view");
}

export default App;
