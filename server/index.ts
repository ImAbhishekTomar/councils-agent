import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { buildAgentPrompt, buildFinalPrompt, starterRoles, swarmSystemPrompt } from './prompts.js';
import type { Agent } from './types.js';

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

const app = express();
const port = Number(process.env.PORT ?? 8787);
const ollamaBaseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

app.use(cors());
app.use(express.json());

const colors = ['#1f8a70', '#c2410c', '#6d5bd0', '#0f766e', '#b45309', '#be123c', '#2563eb', '#7c3aed'];

const swarmQuerySchema = z.object({
  q: z.string().min(3).max(6000),
  model: z.string().min(1).default('qwen3:8b'),
  agents: z.coerce.number().int().min(3).max(10).default(5),
  rounds: z.coerce.number().int().min(1).max(5).default(3),
});

app.get('/api/models', async (_request, response) => {
  try {
    const result = await fetch(`${ollamaBaseUrl}/api/tags`);
    if (!result.ok) throw new Error(`Ollama returned ${result.status}`);
    const data = await result.json();
    response.json({
      ok: true,
      models: (data.models ?? []).map((model: { name: string }) => model.name),
    });
  } catch (error) {
    response.json({
      ok: false,
      models: ['qwen3:8b', 'llama3.2:latest', 'mistral:latest'],
      error: error instanceof Error ? error.message : 'Could not reach Ollama.',
    });
  }
});

app.get('/api/swarm/stream', async (request, response) => {
  const parsed = swarmQuerySchema.safeParse(request.query);

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const send = (event: SwarmEvent) => {
    response.write(`event: swarm\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  if (!parsed.success) {
    send({ type: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid swarm request.' });
    response.end();
    return;
  }

  request.on('close', () => response.end());

  try {
    await runSwarm(parsed.data, send);
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Swarm run failed.' });
  } finally {
    response.end();
  }
});

async function runSwarm(
  input: z.infer<typeof swarmQuerySchema>,
  send: (event: SwarmEvent) => void,
) {
  const agents: Agent[] = starterRoles.slice(0, input.agents).map(([name, role], index) =>
    createAgent(name, role, input.model, index),
  );
  const memory: string[] = [`User question: ${input.q}`];

  send({ type: 'status', message: `Spinning up ${agents.length} local agents on ${input.model}.` });
  for (const agent of agents) {
    send({ type: 'agent_created', agent, reason: 'Initial council role selected from the question shape.' });
  }

  for (let round = 1; round <= input.rounds; round += 1) {
    send({ type: 'status', message: `Round ${round}: agents exchange critiques, additions, and invitations.` });

    for (let index = 0; index < agents.length; index += 1) {
      const agent = agents[index];
      const peers = choosePeers(agents, agent.id, round + index);
      peers.forEach((peer) => send({ type: 'edge', from: agent.id, to: peer.id }));

      const messageId = `msg-${round}-${index}-${Date.now()}`;
      send({ type: 'message_start', id: messageId, from: agent.id, to: peers.map((peer) => peer.id), label: `Round ${round}` });
      const thought = await askAgent(input.q, agent, peers, memory, round, (delta) =>
        send({ type: 'message_delta', id: messageId, delta }),
      );
      agent.confidence = thought.confidence;
      memory.push(`${agent.name}: ${thought.message}`);
      send({ type: 'message_done', id: messageId, from: agent.id, message: thought.message, confidence: thought.confidence });

      if (thought.invite && agents.length < input.agents + 3) {
        const invited = createAgent(thought.invite.name, thought.invite.role, input.model, agents.length);
        agents.push(invited);
        memory.push(`${agent.name} invited ${invited.name}: ${invited.role}`);
        send({ type: 'agent_created', agent: invited, reason: thought.invite.reason });
        send({ type: 'edge', from: agent.id, to: invited.id });
      }
    }
  }

  send({ type: 'status', message: 'Synthesizing answer from shared memory.' });
  const finalId = `final-${Date.now()}`;
  send({ type: 'final_start', id: finalId });
  const final = await synthesize(input.q, agents, memory, input.model, (delta) =>
    send({ type: 'final_delta', id: finalId, delta }),
  );
  send({ type: 'final', id: finalId, answer: final.answer, confidence: final.confidence });
}

function createAgent(name: string, role: string, model: string, index: number): Agent {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `agent-${index + 1}`;
  return {
    id: `${slug}-${index + 1}`,
    name,
    role,
    model,
    color: colors[index % colors.length],
    confidence: 0.5,
  };
}

function choosePeers(agents: Agent[], selfId: string, offset: number) {
  const others = agents.filter((agent) => agent.id !== selfId);
  if (others.length <= 2) return others;
  return [others[offset % others.length], others[(offset + 2) % others.length]];
}

async function askAgent(
  question: string,
  agent: Agent,
  peers: Agent[],
  memory: string[],
  round: number,
  onDelta: (delta: string) => void,
) {
  const fallback = {
    message: `${agent.name} would examine "${question.slice(0, 90)}" from the angle of ${agent.role.toLowerCase()}`,
    confidence: 0.55,
    invite: round === 1 && agent.name === 'Skeptic'
      ? {
          name: 'Domain Scout',
          role: 'Identifies whether a missing specialist should join and what evidence is still needed.',
          reason: 'The Skeptic requested a specialist to pressure-test missing domain knowledge.',
        }
      : null,
  };

  const prompt = buildAgentPrompt({ question, agent, peers, memory });

  const message = await chatText(agent.model, prompt, fallback.message, onDelta);
  return {
    ...fallback,
    message,
    confidence: confidenceFromText(message),
  };
}

async function synthesize(
  question: string,
  agents: Agent[],
  memory: string[],
  model: string,
  onDelta: (delta: string) => void,
) {
  const fallback = {
    answer: `Prototype takeaway: use a small orchestrated swarm first, visualize every event, and only scale agent count after you can measure whether extra agents improve the answer. For "${question}", the strongest pattern is a planner/skeptic/builder/memory/synthesizer loop with dynamic specialist creation.`,
    confidence: averageConfidence(agents),
  };

  const prompt = buildFinalPrompt({ question, agents, memory });

  const answer = await chatText(model, prompt, fallback.answer, onDelta);
  return { answer, confidence: averageConfidence(agents) };
}

async function chatText(model: string, prompt: string, fallback: string, onDelta: (delta: string) => void) {
  try {
    const result = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        options: { temperature: 0.7, num_ctx: 8192 },
        messages: [
          { role: 'system', content: swarmSystemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!result.ok) throw new Error(`Ollama returned ${result.status}`);

    let fullText = '';
    const reader = result.body?.getReader();
    if (!reader) throw new Error('Ollama response did not include a stream body.');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const packet = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
        const delta = packet.message?.content ?? '';
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      }
    }

    const cleaned = fullText.trim();
    if (!cleaned) throw new Error('Ollama returned an empty message.');
    return cleaned;
  } catch {
    onDelta(fallback);
    return fallback;
  }
}

function confidenceFromText(message: string) {
  const lengthScore = Math.min(message.length / 600, 0.25);
  const specificityScore = /\b(because|risk|therefore|step|evidence|tradeoff|measure)\b/i.test(message) ? 0.16 : 0.06;
  return Number(Math.min(0.88, 0.48 + lengthScore + specificityScore).toFixed(2));
}

function averageConfidence(agents: Agent[]) {
  if (agents.length === 0) return 0.5;
  return Number((agents.reduce((sum, agent) => sum + agent.confidence, 0) / agents.length).toFixed(2));
}

app.listen(port, () => {
  console.log(`Swarm server listening on http://localhost:${port}`);
});
