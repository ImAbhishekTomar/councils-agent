import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { buildAgentPrompt, buildFinalPrompt, swarmSystemPrompt } from './prompts.js';
import type { Agent } from './types.js';

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

const app = express();
const port = Number(process.env.PORT ?? 8787);
const ollamaBaseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const imageGenerationUrl = process.env.IMAGE_GENERATION_URL ?? `${ollamaBaseUrl}/v1/images/generations`;
const imageGenerationModel = (process.env.IMAGE_GENERATION_MODEL ?? 'x/flux2-klein:latest').trim();
const imageGenerationFallbackModel = (process.env.IMAGE_GENERATION_FALLBACK_MODEL ?? 'x/flux2-klein:latest').trim();
const imageGenerationSize = (process.env.IMAGE_GENERATION_SIZE ?? '100x100').trim();
const imageGenerationTimeoutMs = Number(process.env.IMAGE_GENERATION_TIMEOUT_MS ?? 300_000);
const maxImagesPerRun = Number(process.env.MAX_IMAGES_PER_RUN ?? 1);

app.use(cors());
app.use(express.json());

const colors = [
  '#1f8a70',
  '#c2410c',
  '#6d5bd0',
  '#0f766e',
  '#b45309',
  '#be123c',
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#db2777',

  '#15803d', // green
  '#0d9488', // teal
  '#0369a1', // sky
  '#1d4ed8', // blue
  '#4338ca', // indigo
  '#5b21b6', // violet
  '#7e22ce', // purple
  '#a21caf', // fuchsia
  '#c026d3', // magenta
  '#e11d48', // rose
  '#dc2626', // red
  '#ea580c', // orange
  '#ca8a04', // amber
  '#65a30d', // lime
  '#4d7c0f', // olive
  '#166534', // forest
  '#0f766e', // deep teal
  '#155e75', // cyan
  '#1e40af', // royal blue
  '#312e81', // navy indigo
  '#581c87', // deep purple
  '#831843', // wine
  '#9a3412', // burnt orange
  '#854d0e', // mustard
  '#3f6212', // moss
  '#064e3b', // emerald dark
  '#164e63', // slate cyan
  '#3730a3', // indigo dark
  '#6b21a8', // violet dark
  '#9d174d', // raspberry
];

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

// Simulation history for the Home screen's HistoryDatabase panel.
// Returns an empty list for now; wire this to real storage later.
app.get('/api/simulation/history', (_request, response) => {
  response.json({ success: true, data: [] });
});

app.get('/api/swarm/stream', async (request, response) => {
  const parsed = swarmQuerySchema.safeParse(request.query);
  let closed = false;

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  const send = (event: SwarmEvent) => {
    if (closed || response.writableEnded) return;
    response.write(`event: swarm\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  if (!parsed.success) {
    send({ type: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid swarm request.' });
    response.end();
    return;
  }

  request.on('close', () => {
    closed = true;
    if (!response.writableEnded) response.end();
  });

  try {
    await runSwarm(parsed.data, send);
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Swarm run failed.' });
  } finally {
    closed = true;
    if (!response.writableEnded) response.end();
  }
});

async function runSwarm(
  input: z.infer<typeof swarmQuerySchema>,
  send: (event: SwarmEvent) => void,
) {
  const initialAgent = createAgent(
    'Coordinator',
    'Starts with the problem, decides whether more agents are needed, and invites specialists as the discussion unfolds.',
    input.model,
    0,
  );
  const agents: Agent[] = [initialAgent];
  const memory: string[] = [`User question: ${input.q}`, `Initial coordinator activated with one generic agent.`];
  const imageTasks: Promise<void>[] = [];
  let imageCount = 0;

  send({ type: 'status', message: `Starting with one coordinator agent and a max of ${input.agents} total agents on ${input.model}.` });
  send({ type: 'agent_created', agent: initialAgent, reason: 'Initial coordinator agent started to assess and invite specialists dynamically.' });

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

      if (thought.imagePrompt && imageCount < maxImagesPerRun) {
        imageCount += 1;
        imageTasks.push(queueAgentImage(messageId, agent.id, thought.imagePrompt, send));
      }

      const newInvite = parseInviteLine(thought.message);
      if (newInvite && agents.length < input.agents) {
        const invited = createAgent(newInvite.name, newInvite.role, input.model, agents.length);
        agents.push(invited);
        memory.push(`${agent.name} invited ${invited.name}: ${invited.role}`);
        send({ type: 'agent_created', agent: invited, reason: newInvite.reason });
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
  await Promise.allSettled(imageTasks);
}

const genders = ['Female', 'Male', 'Non-binary', 'Unspecified'];

function createAgent(name: string, role: string, model: string, index: number): Agent {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `agent-${index + 1}`;
  return {
    id: `${slug}-${index + 1}`,
    name,
    role,
    model,
    color: colors[index % colors.length],
    confidence: 0.5,
    uuid: globalThis.crypto.randomUUID(),
    gender: genders[index % genders.length],
    fullName: null,
    userRole: null,
    summary: `${name} joins the swarm as a "${role}" and contributes that perspective to the discussion.`,
    labels: ['Entity', 'Person'],
    createdAt: new Date().toISOString(),
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
  };

  const prompt = buildAgentPrompt({ question, agent, peers, memory });

  const rawMessage = await chatText(agent.model, prompt, fallback.message, onDelta);
  const imagePrompt = parseImageLine(rawMessage);
  const message = stripImageLines(rawMessage);
  return {
    message,
    confidence: confidenceFromText(message),
    imagePrompt,
  };
}

function parseInviteLine(message: string) {
  const match = message.match(/^[ \t]*INVITE[ \t]*:[ \t]*([^|]+?)[ \t]*\|[ \t]*([^|]+?)[ \t]*\|[ \t]*([^\n]+?)[ \t]*$/im);
  if (!match) return null;

  const name = match[1].trim();
  const role = match[2].trim();
  const reason = match[3].trim().replace(/[.\s]*$/u, '');

  const invalidPlaceholder = ['name', 'role'].includes(name.toLowerCase()) || ['name', 'role'].includes(role.toLowerCase());
  if (!name || !role || !reason || invalidPlaceholder) return null;

  return { name, role, reason };
}

function parseImageLine(message: string) {
  const match = message.match(/^[ \t]*IMAGE[ \t]*:[ \t]*([^\n]+?)[ \t]*$/im);
  const prompt = match?.[1]?.trim();
  if (!prompt || prompt.length < 12) return null;
  return prompt.slice(0, 280);
}

function stripImageLines(message: string) {
  return message
    .split('\n')
    .filter((line) => !/^[ \t]*IMAGE[ \t]*:/i.test(line))
    .join('\n')
    .trim();
}

async function queueAgentImage(
  messageId: string,
  agentId: string,
  prompt: string,
  send: (event: SwarmEvent) => void,
) {
  const imageId = `img-${messageId}`;
  send({ type: 'image_start', id: imageId, messageId, from: agentId, prompt });

  try {
    const url = await generateLowResolutionImage(prompt);
    send({ type: 'image_done', id: imageId, messageId, from: agentId, prompt, url });
  } catch (error) {
    send({
      type: 'image_error',
      id: imageId,
      messageId,
      from: agentId,
      message: error instanceof Error ? error.message : 'Image generation failed.',
    });
  }
}

async function generateLowResolutionImage(prompt: string) {
  const models = [...new Set([imageGenerationModel, imageGenerationFallbackModel].filter(Boolean))];
  const errors: string[] = [];

  for (const model of models) {
    try {
      return await generateLowResolutionImageWithModel(prompt, model);
    } catch (error) {
      errors.push(`${model}: ${formatImageGenerationError(error)}`);
    }
  }

  throw new Error(errors.join(' | '));
}

async function generateLowResolutionImageWithModel(prompt: string, model: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), imageGenerationTimeoutMs);

  try {
    const result = await fetch(imageGenerationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        size: imageGenerationSize,
        response_format: 'b64_json',
        n: 1,
      }),
    });

    if (!result.ok) {
      const errorText = await result.text();
      throw new Error(`Image generator returned ${result.status}: ${summarizeImageError(errorText)}`);
    }
    const data = await result.json() as {
      data?: { b64_json?: string; url?: string }[];
      images?: string[];
      image?: string;
      url?: string;
    };
    const firstImage = data.data?.[0];
    const rawImage = firstImage?.b64_json ?? data.images?.[0] ?? data.image;
    if (firstImage?.url) return firstImage.url;
    if (data.url) return data.url;
    if (!rawImage) throw new Error('Image generator returned no image.');
    return rawImage.startsWith('data:') ? rawImage : `data:image/png;base64,${rawImage}`;
  } finally {
    clearTimeout(timeout);
  }
}

function formatImageGenerationError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return `Timed out after ${Math.round(imageGenerationTimeoutMs / 1000)}s. The local image model is still taking too long.`;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return `Timed out after ${Math.round(imageGenerationTimeoutMs / 1000)}s. The local image model is still taking too long.`;
  }
  return error instanceof Error ? error.message : 'Image generation failed.';
}

function summarizeImageError(errorText: string) {
  try {
    const parsed = JSON.parse(errorText) as { error?: { message?: string } | string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Fall through to plain-text cleanup.
  }
  return errorText.trim().slice(0, 220) || 'Unknown image generator error.';
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
