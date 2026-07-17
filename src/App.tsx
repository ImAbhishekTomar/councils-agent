import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import {
  BrainCircuit,
  CircleStop,
  MessageSquareText,
  Play,
  RadioTower,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './App.css';

type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
  color: string;
  confidence: number;
};

type SwarmEvent =
  | { type: 'status'; message: string }
  | { type: 'agent_created'; agent: Agent; reason: string }
  | { type: 'message_start'; id: string; from: string; to: string[]; label: string }
  | { type: 'message_delta'; id: string; delta: string }
  | { type: 'message_done'; id: string; from: string; message: string; confidence: number }
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
};

type AgentNodeData = {
  agent: Agent;
  active: boolean;
  isHub?: boolean;
};

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';
const defaultQuestion =
  'Design a local-first swarm agent that can debate an idea, invite new specialist agents, visualize the discussion, and return a useful answer.';

function App() {
  const [question, setQuestion] = useState(defaultQuestion);
  const [model, setModel] = useState('qwen3:8b');
  const [models, setModels] = useState<string[]>(['qwen3:8b', 'llama3.2:latest', 'mistral:latest']);
  const [agentTarget, setAgentTarget] = useState(5);
  const [rounds, setRounds] = useState(3);
  const [nodes, setNodes] = useState<Node<AgentNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [activeAgentId, setActiveAgentId] = useState<string>();
  const [finalAnswer, setFinalAnswer] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('Idle');
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

  const nodeTypes = useMemo(() => ({ agent: AgentNode }), []);

  const onNodesChange = useCallback((changes: NodeChange<Node<AgentNodeData>>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

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

  const handleSwarmEvent = useCallback(
    (event: SwarmEvent) => {
      if (event.type === 'status') {
        setStatus(event.message);
        appendTranscript({ kind: 'status', text: event.message });
        return;
      }

      if (event.type === 'agent_created') {
        setAgents((current) => ({ ...current, [event.agent.id]: event.agent }));
        setNodes((current) => layoutMindMapNodes([
          ...current,
          {
            id: event.agent.id,
            type: 'agent',
            position: nextPosition(current.length),
            data: { agent: event.agent, active: false, isHub: current.length === 0 },
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
        eventSourceRef.current?.close();
        return;
      }

      if (event.type === 'error') {
        setStatus(event.message);
        setIsRunning(false);
        appendTranscript({ kind: 'error', text: event.message });
        eventSourceRef.current?.close();
      }
    },
    [appendDelta, appendTranscript, finishStreamingMessage, startStreamingMessage],
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

  const latestAgents = Object.values(agents);
  const avgConfidence = latestAgents.length
    ? Math.round((latestAgents.reduce((sum, agent) => sum + agent.confidence, 0) / latestAgents.length) * 100)
    : 0;

  return (
    <main className="shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              <RadioTower size={15} /> Local Ollama swarm lab
            </span>
            <h1>Agent God Discussion</h1>
          </div>
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
        </header>

        <section className="control-strip">
          <label className="question-box">
            <span>Question</span>
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
            <span>Initial agents</span>
            <input
              min="3"
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
        </section>

        <section className="graph-panel">
          <div className="graph-toolbar">
            <div>
              <strong>{status}</strong>
              <span>{latestAgents.length} agents · {edges.length} channels · {avgConfidence}% average confidence</span>
            </div>
            <Sparkles size={18} />
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.25}
            maxZoom={1.5}
          >
            <Background color="#253244" gap={24} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </section>
      </section>

      <aside className="side-panel">
        <section className="answer-panel">
          <div className="panel-title">
            <BrainCircuit size={18} />
            <h2>Prototype Plan</h2>
          </div>
          <p>
            Start small: event-streamed agents, visible memory, dynamic specialist invites, and measured consensus. Add LangGraph when
            the orchestration rules harden, then PostgreSQL for durable runs and long-term memory.
          </p>
          {finalAnswer && <div className="final-answer">{finalAnswer}</div>}
        </section>

        <section className="transcript-panel">
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
              </article>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  return (
    <div className={`agent-node ${data.active ? 'active' : ''}`} style={{ '--agent-color': data.agent.color } as React.CSSProperties}>
      <Handle type="target" position={Position.Top} />
      <div className="agent-orb">
        <BrainCircuit size={20} />
      </div>
      <strong>{data.agent.name}</strong>
      <span title={data.agent.role}>{data.isHub ? 'hub' : `${Math.round(data.agent.confidence * 100)}%`}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
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

function layoutMindMapNodes(nodes: Node<AgentNodeData>[]) {
  const positioned = nodes.map((node, index) => ({
    ...node,
    position: nextPosition(index),
    data: { ...node.data, isHub: index === 0 },
  }));

  return relaxNodePositions(positioned, 10);
}

function relaxNodePositions(nodes: Node<AgentNodeData>[], passes = 1) {
  const minDistance = 148;
  const center = { x: 520, y: 320 };
  const next = nodes.map((node) => ({ ...node, position: { ...node.position } }));

  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < next.length; i += 1) {
      for (let j = i + 1; j < next.length; j += 1) {
        const first = next[i];
        const second = next[j];
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

      if (next[i].data.isHub) {
        next[i].position = center;
      } else {
        next[i].position.x += (center.x - next[i].position.x) * 0.003;
        next[i].position.y += (center.y - next[i].position.y) * 0.003;
      }
    }
  }

  return next;
}

function upsertEdge(edges: Edge[], from: string, to: string) {
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
      type: 'smoothstep',
      style: { stroke: '#38bdf8', strokeWidth: 2.2 },
    },
  ];
}

export default App;
