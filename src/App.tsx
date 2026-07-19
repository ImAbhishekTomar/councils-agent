import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleStop, Database, GitBranch, MessageSquareText, Play, RadioTower, RotateCcw, Sparkles } from 'lucide-react';
import './App.css';
import GraphPanel from './GraphPanel';
import { clearPendingUpload, getPendingUpload } from './store/pendingUpload';

type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
  color: string;
  confidence: number;
  uuid: string;
  gender: string;
  fullName: string | null;
  userRole: string | null;
  summary: string;
  labels: string[];
  createdAt: string;
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
  | { type: 'edge'; from: string; to: string }
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

type SidePanelTab = 'transcript' | 'plan' | 'system';

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';
const defaultQuestion =
  'Build an agent playground where specialist agents debate the task, invite missing expertise, expose their graph memory, and return one useful decision.';

function App() {
  const [question, setQuestion] = useState(defaultQuestion);
  const [model, setModel] = useState('qwen3:8b');
  const [models, setModels] = useState<string[]>(['qwen3:8b', 'llama3.2:latest', 'mistral:latest']);
  const [agentTarget, setAgentTarget] = useState(5);
  const [rounds, setRounds] = useState(3);
  const [nodes, setNodes] = useState<AppNode[]>([]);
  const [edges, setEdges] = useState<{ id: string; source: string; target: string; animated?: boolean; type?: string; style?: React.CSSProperties }[]>([]);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [activeAgentId, setActiveAgentId] = useState<string>();
  const [finalAnswer, setFinalAnswer] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [activeSideTab, setActiveSideTab] = useState<SidePanelTab>('transcript');
  const eventSourceRef = useRef<EventSource | null>(null);
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
      .then((data: { models?: string[] }) => {
        if (data.models?.length) {
          setModels(data.models);
          setModel(data.models.includes('qwen3:8b') ? 'qwen3:8b' : data.models[0]);
        }
      })
      .catch(() => {
        setStatus('Ollama model discovery failed. The playground can still show fallback swarm events.');
      });
  }, []);

  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: { ...node.data, active: node.id === activeAgentId },
      })),
    );
  }, [activeAgentId]);

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
    setNodes([]);
    setEdges([]);
    setTranscript([]);
    setAgents({});
    setActiveAgentId(undefined);
    setFinalAnswer('');
    setIsRunning(false);
    setStatus('Idle');
  }, []);

  const stopRun = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsRunning(false);
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

  const handleSwarmEvent = useCallback(
    (event: SwarmEvent) => {
      if (event.type === 'status') {
        setStatus(event.message);
        appendTranscript({ kind: 'status', text: event.message });
        return;
      }

      if (event.type === 'agent_created') {
        const previousAgentIds = Object.keys(agentsRef.current);
        const hubAgentId = previousAgentIds[0];
        // Prefer the (richer) join reason as the node summary when present.
        const agent: Agent = { ...event.agent, summary: event.reason || event.agent.summary };
        setAgents((current) => ({ ...current, [agent.id]: agent }));
        if (hubAgentId && hubAgentId !== agent.id) {
          setEdges((current) => upsertEdge(current, hubAgentId, agent.id));
        }
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
        return;
      }

      if (event.type === 'edge') {
        setEdges((current) => upsertEdge(current, event.from, event.to));
        return;
      }

      if (event.type === 'message_start') {
        setActiveAgentId(event.from);
        setEdges((current) => event.to.reduce((next, target) => upsertEdge(next, event.from, target), current));
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
                    active: true,
                    agent: { ...node.data.agent, confidence: event.confidence },
                  },
                }
              : { ...node, data: { ...node.data, active: false } },
          ),
        );
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
        setActiveAgentId(undefined);
        finishStreamingMessage(event.id, event.confidence, event.answer);
        return;
      }

      if (event.type === 'error') {
        setStatus(event.message);
        setIsRunning(false);
        appendTranscript({ kind: 'error', text: event.message });
        eventSourceRef.current?.close();
      }
    },
    [appendDelta, appendTranscript, failTranscriptImage, finishStreamingMessage, finishTranscriptImage, startStreamingMessage, startTranscriptImage],
  );

  const startRun = useCallback(() => {
    resetRun();
    setIsRunning(true);
    setStatus('Connecting to swarm server');
    const params = new URLSearchParams({
      q: question,
      model,
      agents: String(agentTarget),
      rounds: String(rounds),
    });
    const source = new EventSource(`${apiBase}/api/swarm/stream?${params.toString()}`);
    eventSourceRef.current = source;
    source.addEventListener('swarm', (message) => handleSwarmEvent(JSON.parse(message.data) as SwarmEvent));
    source.onerror = () => {
      setStatus('Stream disconnected. Check that the server and Ollama are running.');
      setIsRunning(false);
      source.close();
    };
  }, [agentTarget, handleSwarmEvent, model, question, resetRun, rounds]);

  // If we arrived here from Home's "Start Engine", prefill the prompt and run.
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
          <button className="brand" type="button" onClick={resetRun} title="Reset playground">
            MIROFISH
          </button>
          <span>Agent God Discussion</span>
        </div>

        <div className="nav-controls">
          <label className="nav-prompt">
            <span>Simulation prompt</span>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <label>
            <span>Model</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {models.map((modelName) => (
                <option key={modelName} value={modelName}>
                  {modelName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Max agents</span>
            <input
              min="1"
              max="10"
              type="number"
              value={agentTarget}
              onChange={(event) => setAgentTarget(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Rounds</span>
            <input min="1" max="5" type="number" value={rounds} onChange={(event) => setRounds(Number(event.target.value))} />
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
                <CircleStop size={18} /> Stop
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={startRun}>
                <Play size={18} /> Run swarm
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
              <span>{latestAgents.length} agents · {edges.length} channels · {avgConfidence}% average confidence</span>
            </div>
            <div className="graph-toolbar-tools">
              <RadioTower size={17} />
              <Sparkles size={17} />
            </div>
          </div>
          <GraphPanel
            nodes={nodes}
            edges={edges}
            activeAgentId={activeAgentId}
            showEdgeLabels={showEdgeLabels}
            onToggleEdgeLabels={() => setShowEdgeLabels((current) => !current)}
            onSelectAgent={(id) => setActiveAgentId(id)}
          />
        </section>
      </section>

      <aside className="side-panel">
        <div className="side-tabs" role="tablist" aria-label="Swarm side panel">
          {[
            ['transcript', MessageSquareText, 'Live Monologue'],
            ['plan', GitBranch, 'Prototype Plan'],
            ['system', Database, 'System Ready'],
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
                <h2>Live Monologue</h2>
              </div>
              <div className="transcript" ref={transcriptRef}>
                {transcript.length === 0 && <p className="empty">Run the swarm to watch agents join, argue, invite specialists, and settle.</p>}
                {transcript.map((item) => (
                  <article className={`line ${item.kind}`} key={item.id}>
                    <div className="line-meta">
                      <span>{item.agent?.name ?? item.kind}</span>
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
                <h2>Prototype Plan</h2>
              </div>
              <p>
                Start small: event-streamed agents, visible memory, dynamic specialist invites, and measured consensus. Add LangGraph when
                the orchestration rules harden, then PostgreSQL for durable runs and long-term memory.
              </p>
              {finalAnswer && <div className="final-answer">{finalAnswer}</div>}
            </section>
          )}

          {activeSideTab === 'system' && (
            <section className="system-panel" id="side-tab-system" role="tabpanel">
              <div className="panel-title">
                <Database size={18} />
                <h2>System Ready</h2>
              </div>
              <p>Upload the reality seed as a prompt, tune the run, then let the swarm build its discussion graph.</p>
              <div className="metrics-row">
                <div className="metric-card">
                  <strong>{latestAgents.length || '--'}</strong>
                  <span>agent nodes</span>
                </div>
                <div className="metric-card">
                  <strong>{edges.length || '--'}</strong>
                  <span>relations</span>
                </div>
              </div>
              <div className="workflow-list">
                {[
                  ['01', 'Ontology generation', runPhase >= 0],
                  ['02', 'Graph memory build', runPhase >= 1],
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

function upsertEdge(edges: { id: string; source: string; target: string; animated?: boolean; type?: string; style?: React.CSSProperties }[], from: string, to: string) {
  const id = `${from}-${to}`;
  if (edges.some((edge) => edge.id === id)) {
    return edges.map((edge) => (edge.id === id ? { ...edge, animated: true } : edge));
  }
  return [
    ...edges,
    {
      id,
      source: from,
      target: to,
      animated: true,
      type: 'default',
      style: {
        stroke: '#7fb7ff',
        strokeWidth: 1.4,
      },
    },
  ];
}

export default App;
