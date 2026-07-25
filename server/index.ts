import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { buildAgentPrompt, buildFinalPrompt, buildImageJudgePrompt, buildInnerStatePrompt, swarmSystemPrompt } from './prompts.js';
import type { Agent, AgentCategory, AgentInnerState, AgentLlmSettings, AgentPhase, AgentProfile } from './types.js';

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

const app = express();
const port = Number(process.env.PORT ?? 8787);
const ollamaBaseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const openRouterBaseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const openRouterSiteUrl = process.env.OPENROUTER_SITE_URL ?? 'http://localhost:5173';
const openRouterAppName = process.env.OPENROUTER_APP_NAME ?? 'Councils Agent Discussion';
const configuredOpenRouterFreeModels = (process.env.OPENROUTER_FREE_MODELS ?? 'openrouter/free')
  .split(',')
  .map((model) => model.trim())
  .filter(isKnownFreeOpenRouterModel);
const openRouterFreeModels = configuredOpenRouterFreeModels.length > 0 ? configuredOpenRouterFreeModels : ['openrouter/free'];
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

const phasePlan: { phase: AgentPhase; label: string }[] = [
  { phase: 'frame', label: 'Frame' },
  { phase: 'perspective', label: 'Perspective' },
  { phase: 'critique', label: 'Critique' },
  { phase: 'build', label: 'Build' },
  { phase: 'synthesize', label: 'Synthesize' },
];

app.get('/api/models', async (_request, response) => {
  const providerStatus = {
    ollama: { available: false, error: null as string | null },
    openRouter: {
      available: Boolean(openRouterApiKey),
      error: openRouterApiKey ? null : 'OPENROUTER_API_KEY is not set.',
    },
  };
  const modelOptions: { id: string; label: string; provider: 'ollama' | 'openrouter' }[] = [];

  if (openRouterApiKey) {
    openRouterFreeModels.forEach((model) => {
      modelOptions.push({
        id: model,
        label: model === 'openrouter/free' ? 'OpenRouter Free Router' : `${model} (free)`,
        provider: 'openrouter',
      });
    });
  }

  try {
    const result = await fetch(`${ollamaBaseUrl}/api/tags`);
    if (!result.ok) throw new Error(`Ollama returned ${result.status}`);
    const data = await result.json();
    providerStatus.ollama.available = true;
    const ollamaModels = (data.models ?? []).map((model: { name: string }) => model.name);
    ollamaModels.forEach((model: string) => {
      modelOptions.push({
        id: model,
        label: `${model} (local)`,
        provider: 'ollama',
      });
    });

    response.json({
      ok: modelOptions.length > 0,
      models: modelOptions.map((model) => model.id),
      modelOptions,
      providers: providerStatus,
      openRouterConfigured: Boolean(openRouterApiKey),
    });
  } catch (error) {
    providerStatus.ollama.error = error instanceof Error ? error.message : 'Could not reach Ollama.';
    response.json({
      ok: modelOptions.length > 0,
      models: modelOptions.map((model) => model.id),
      modelOptions,
      providers: providerStatus,
      openRouterConfigured: Boolean(openRouterApiKey),
      error: providerStatus.ollama.error,
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
  const starterSpecialists = planStarterSpecialists(input.q, input.agents - 1);
  starterSpecialists.forEach((specialist) => {
    agents.push(createAgent(specialist.name, specialist.role, input.model, agents.length));
  });

  const memory: string[] = [
    `User question: ${input.q}`,
    starterSpecialists.length > 0
      ? `Initial council activated with coordinator and ${starterSpecialists.length} starter specialists.`
      : `Initial coordinator activated with one generic agent.`,
  ];
  const imageTasks: Promise<void>[] = [];
  let imageCount = 0;

  send({ type: 'status', message: `Starting with ${agents.length} initial agents and a max of ${input.agents} total agents on ${input.model}.` });
  if (isOpenRouterModel(input.model) && !openRouterApiKey) {
    send({ type: 'status', message: 'OpenRouter model selected, but OPENROUTER_API_KEY is not set. Using fallback text until an API key is configured.' });
  }
  send({ type: 'agent_created', agent: initialAgent, reason: 'Initial coordinator agent started to assess and invite specialists dynamically.' });
  starterSpecialists.forEach((specialist, index) => {
    const agent = agents[index + 1];
    if (!agent) return;
    memory.push(`Coordinator invited ${agent.name}: ${agent.role}`);
    send({ type: 'agent_created', agent, reason: specialist.reason });
    send({ type: 'edge', from: initialAgent.id, to: agent.id, label: 'seeds council' });
  });

  const activePhases = phasePlan.slice(0, input.rounds);
  for (let round = 1; round <= activePhases.length; round += 1) {
    const phase = activePhases[round - 1] ?? phasePlan[phasePlan.length - 1];
    send({ type: 'status', message: `${phase.label} phase: ${phaseStatusText(phase.phase)}` });

    for (let index = 0; index < agents.length; index += 1) {
      const agent = agents[index];
      agent.phase = phase.phase;
      const peers = choosePeers(agents, agent.id, round + index, phase.phase);

      const messageId = `msg-${round}-${index}-${Date.now()}`;
      send({ type: 'message_start', id: messageId, from: agent.id, to: peers.map((peer) => peer.id), label: phase.label });
      const thought = await askAgent(input.q, agent, peers, memory, phase.phase, (delta) =>
        send({ type: 'message_delta', id: messageId, delta }),
      );
      agent.confidence = thought.confidence;
      memory.push(`${agent.name}: ${thought.message}`);
      send({ type: 'message_done', id: messageId, from: agent.id, message: thought.message, confidence: thought.confidence });

      const spokenTargets = findAddressedAgents(thought.message, agent, agents, peers);
      const edgeLabel = relationshipLabel(agent, phase.phase);
      spokenTargets.forEach((target) => send({ type: 'edge', from: agent.id, to: target.id, label: edgeLabel }));

      const judgedImagePrompt = imageCount < maxImagesPerRun ? await judgeImageNeed(input.q, agent, thought.message) : null;
      if (judgedImagePrompt) {
        imageCount += 1;
        imageTasks.push(queueAgentImage(messageId, agent.id, judgedImagePrompt, send));
      }

      const newInvite = parseInviteLine(thought.message);
      if (newInvite && agents.length < input.agents) {
        const invited = createAgent(newInvite.name, newInvite.role, input.model, agents.length);
        agents.push(invited);
        memory.push(`${agent.name} invited ${invited.name}: ${invited.role}`);
        send({ type: 'agent_created', agent: invited, reason: newInvite.reason });
        send({ type: 'edge', from: agent.id, to: invited.id, label: 'invites specialist' });
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

type StarterSpecialist = {
  name: string;
  role: string;
  reason: string;
};

function planStarterSpecialists(question: string, slots: number): StarterSpecialist[] {
  if (slots <= 0) return [];

  const lower = question.toLowerCase();
  const planned: StarterSpecialist[] = [];

  const add = (specialist: StarterSpecialist) => {
    if (planned.length >= slots) return;
    if (planned.some((existing) => existing.name === specialist.name || existing.role === specialist.role)) return;
    planned.push(specialist);
  };

  if (/\b(earth|planet|world|humanity|civilization|species|universe)\b/.test(lower) && /\b(end|ends|ending|collapse|extinction|apocalypse|doom|destroy|die|survive|future)\b/.test(lower)) {
    add({
      name: 'Dr. Mira Sen',
      role: 'Astrophysicist focused on solar evolution, cosmic hazards, and planetary habitability',
      reason: 'The prompt spans deep-time planetary endings and needs a physical astronomy lens.',
    });
    add({
      name: 'Dr. Talia Brooks',
      role: 'Climate systems scientist focused on long-horizon Earth resilience and biosphere tipping points',
      reason: 'Earth-ending scenarios need climate and biosphere risk separated from true planetary destruction.',
    });
    add({
      name: 'Prof. Adrian Hale',
      role: 'Geologist and extinction-events researcher focused on volcanoes, impacts, and deep time',
      reason: 'Mass extinction pathways require geological evidence and historical comparison.',
    });
    add({
      name: 'Samira Noor',
      role: 'Existential risk ethicist and scenario planner',
      reason: 'A complicated future-risk discussion needs probability, uncertainty, and human stakes kept explicit.',
    });
  }

  if (/\b(code|app|software|bug|feature|build|implement|typescript|react|api|server|frontend|backend)\b/.test(lower)) {
    add({
      name: 'Casey Lin',
      role: 'Software architect and implementation reviewer',
      reason: 'The prompt appears to involve implementation choices that need a technical design lens.',
    });
    add({
      name: 'Rina Patel',
      role: 'QA analyst and failure-mode tester',
      reason: 'The council should pressure-test expected behavior and edge cases before synthesis.',
    });
  }

  if (/\b(market|stock|crypto|finance|trading|investment|portfolio|price|revenue|business)\b/.test(lower)) {
    add({
      name: 'Victor Chen',
      role: 'Market and risk analyst',
      reason: 'The prompt includes financial uncertainty and needs scenario-based risk framing.',
    });
  }

  if (/\b(design|story|brand|visual|creative|write|copy|narrative|image|game)\b/.test(lower)) {
    add({
      name: 'Maya Ivers',
      role: 'Creative strategist and narrative designer',
      reason: 'The prompt has a creative surface that benefits from a distinct audience and story lens.',
    });
  }

  const isBroadQuestion =
    question.length > 90 ||
    /\b(discuss|explore|complex|complicated|how|why|what happens|future|strategy|compare|tradeoff)\b/.test(lower);

  if (isBroadQuestion) {
    add({
      name: 'Jordan Vale',
      role: 'Skeptic and assumptions auditor',
      reason: 'Broad questions need explicit pressure-testing so the discussion does not settle too early.',
    });
    add({
      name: 'Nadia Okafor',
      role: 'Evidence scout and domain mapper',
      reason: 'The council needs someone to identify missing evidence and boundaries between domains.',
    });
  }

  add({
    name: 'Jordan Vale',
    role: 'Skeptic and assumptions auditor',
    reason: 'Every council benefits from one agent dedicated to weak assumptions and hidden risks.',
  });
  add({
    name: 'Nadia Okafor',
    role: 'Evidence scout and domain mapper',
    reason: 'Every council benefits from one agent dedicated to evidence gaps and domain boundaries.',
  });

  return planned.slice(0, slots);
}

function createAgent(name: string, role: string, model: string, index: number): Agent {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `agent-${index + 1}`;
  const category = categorizeAgent(role);
  const profile = buildAgentProfile(name, role, category);
  const llmSettings = settingsForCategory(category);
  return {
    id: `${slug}-${index + 1}`,
    name,
    role,
    model,
    category,
    phase: 'perspective',
    profile,
    innerState: defaultInnerState(name, role),
    llmSettings,
    color: colors[index % colors.length],
    confidence: 0.5,
    uuid: globalThis.crypto.randomUUID(),
    gender: genders[index % genders.length],
    fullName: null,
    userRole: null,
    summary: `${name} joins as ${role}. ${profile.goals}`,
    labels: ['Entity', categoryLabel(category)],
    createdAt: new Date().toISOString(),
  };
}

function defaultInnerState(name: string, role: string): AgentInnerState {
  return {
    attention: [`The user needs ${role.toLowerCase()} applied concretely.`],
    motive: `${name} wants to make the council more useful without overreaching.`,
    affect: 'attentive and steady',
    uncertainty: 'What evidence or constraint will matter most is not clear yet.',
    socialPressure: 'Listen for gaps in the current phase and respond to one peer directly.',
    selfCritique: 'The agent may lean too hard on its role and miss the broader user need.',
  };
}

function categorizeAgent(role: string): AgentCategory {
  const lower = role.toLowerCase();
  if (/\b(code|coding|developer|software|engineer|architect|typescript|react|backend|frontend|implementation|test)\b/.test(lower)) return 'coding';
  if (/\b(trading|market|finance|financial|stock|crypto|risk|portfolio|price|economic)\b/.test(lower)) return 'trading';
  if (/\b(creative|writer|story|narrative|brand|design|visual|image|art|copy|voice)\b/.test(lower)) return 'creative';
  return 'general';
}

function categoryLabel(category: AgentCategory) {
  if (category === 'coding') return 'Coding Agent';
  if (category === 'trading') return 'Trading Analysis';
  if (category === 'creative') return 'Creative Writing';
  return 'General Chat';
}

function settingsForCategory(category: AgentCategory): AgentLlmSettings {
  if (category === 'coding') {
    return { temperature: 0.15, topP: 1, maxOutputTokens: 8192, frequencyPenalty: 0, presencePenalty: 0 };
  }
  if (category === 'trading') {
    return { temperature: 0.2, topP: 1, maxOutputTokens: 4096, frequencyPenalty: 0, presencePenalty: 0 };
  }
  if (category === 'creative') {
    return { temperature: 0.9, topP: 0.95, maxOutputTokens: 4096, frequencyPenalty: 0.3, presencePenalty: 0.5 };
  }
  return { temperature: 0.6, topP: 1, maxOutputTokens: 2048, frequencyPenalty: 0.1, presencePenalty: 0.1 };
}

function buildAgentProfile(name: string, role: string, category: AgentCategory): AgentProfile {
  const base = {
    coding: {
      temperament: 'precise, skeptical of vague abstractions, and calm under implementation pressure',
      expertise: 'software architecture, failure modes, tests, interfaces, and maintainable delivery',
      memoryStyle: 'tracks decisions, constraints, edge cases, and unresolved implementation risks',
      riskBias: 'prefers correctness, observability, and rollback paths over cleverness',
      speakingStyle: 'short, concrete, and action-oriented; every objection should include a fix',
      goals: 'Turn the discussion into a buildable plan with clear boundaries and verification steps.',
      constraints: 'Do not speculate beyond the code or requirements; name uncertainty directly.',
    },
    trading: {
      temperament: 'cautious, probabilistic, and allergic to false certainty',
      expertise: 'risk/reward framing, scenario analysis, market structure, and downside protection',
      memoryStyle: 'tracks assumptions, time horizons, invalidation signals, and confidence shifts',
      riskBias: 'prioritizes capital preservation, caveats, and measurable triggers',
      speakingStyle: 'measured and evidence-weighted; separates signal from narrative',
      goals: 'Produce a risk-aware view with clear assumptions, scenarios, and caveats.',
      constraints: 'Do not provide guarantees or personalized financial advice.',
    },
    creative: {
      temperament: 'imaginative, emotionally attentive, and comfortable with ambiguity',
      expertise: 'voice, metaphor, visual framing, story structure, and audience resonance',
      memoryStyle: 'tracks tone, motifs, emotional beats, and images that clarify meaning',
      riskBias: 'accepts novelty but protects coherence and taste',
      speakingStyle: 'vivid, specific, and human; avoids decorative excess',
      goals: 'Make the idea more memorable, legible, and emotionally alive.',
      constraints: 'Do not let style outrun usefulness or clarity.',
    },
    general: {
      temperament: 'balanced, curious, and pragmatic',
      expertise: 'sensemaking, tradeoff analysis, user empathy, and decision support',
      memoryStyle: 'tracks context, decisions, open questions, and useful next steps',
      riskBias: 'balances speed with reliability and keeps caveats visible',
      speakingStyle: 'warm, concise, and plain-spoken',
      goals: 'Help the swarm converge on a useful answer without losing nuance.',
      constraints: 'Avoid repetition, overconfidence, and unsupported claims.',
    },
  } satisfies Record<AgentCategory, AgentProfile>;

  return {
    ...base[category],
    expertise: `${base[category].expertise}; role focus: ${role}`,
    goals: `${name}'s goal: ${base[category].goals}`,
  };
}

function phaseStatusText(phase: AgentPhase) {
  if (phase === 'frame') return 'frame the problem, assumptions, and missing expertise.';
  if (phase === 'perspective') return 'add role-specific evidence, perspective, and useful disagreement.';
  if (phase === 'critique') return 'pressure-test weak logic, risks, and false confidence.';
  if (phase === 'build') return 'convert the discussion into practical implementation or decision steps.';
  return 'compress consensus, caveats, and final direction.';
}

function relationshipLabel(agent: Agent, phase: AgentPhase) {
  const role = agent.role.toLowerCase();
  if (/\b(coordinator|orchestrator|facilitator|lead|planner)\b/.test(role)) return phase === 'frame' ? 'frames problem' : 'coordinates';
  if (/\b(skeptic|critic|critique|reviewer|auditor|red team)\b/.test(role)) return 'challenges';
  if (/\b(builder|implement|developer|engineer|architect|coding|software|frontend|backend)\b/.test(role)) return 'implements';
  if (/\b(memory|recorder|summarizer|keeper|context)\b/.test(role)) return 'tracks memory';
  if (/\b(synthesizer|synthesis|final|writer|editor)\b/.test(role)) return 'synthesizes';
  if (/\b(design|creative|visual|ux|ui|story|narrative|brand)\b/.test(role)) return 'shapes concept';
  if (/\b(research|analyst|evidence|domain|scout|expert)\b/.test(role)) return 'adds evidence';
  if (/\b(risk|trading|market|finance|financial)\b/.test(role)) return 'risk-checks';
  if (phase === 'frame') return 'frames problem';
  if (phase === 'critique') return 'challenges';
  if (phase === 'build') return 'turns into steps';
  if (phase === 'synthesize') return 'synthesizes';
  if (agent.category === 'coding') return 'technical input';
  if (agent.category === 'trading') return 'risk lens';
  if (agent.category === 'creative') return 'creative angle';
  return `${agent.name}'s view`;
}

function findAddressedAgents(message: string, speaker: Agent, agents: Agent[], intendedPeers: Agent[]) {
  const normalized = normalizeForMention(message);
  const addressed = new Map<string, Agent>();

  agents
    .filter((agent) => agent.id !== speaker.id)
    .forEach((agent) => {
      const name = normalizeForMention(agent.name);
      const firstName = normalizeForMention(agent.name.split(/\s+/)[0] ?? agent.name);
      if (name && normalized.includes(name)) {
        addressed.set(agent.id, agent);
        return;
      }
      if (firstName.length >= 4 && new RegExp(`(^|[^a-z0-9])${escapeRegExp(firstName)}([^a-z0-9]|$)`, 'i').test(normalized)) {
        addressed.set(agent.id, agent);
      }
    });

  if (addressed.size > 0) return Array.from(addressed.values()).slice(0, 2);

  const directAddressPattern = /^\s*([A-Z][A-Za-z0-9 -]{2,32})(,|:|-)/;
  if (directAddressPattern.test(message) && intendedPeers[0]) {
    return [intendedPeers[0]];
  }

  return [];
}

function normalizeForMention(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function choosePeers(agents: Agent[], selfId: string, offset: number, phase: AgentPhase) {
  const others = agents.filter((agent) => agent.id !== selfId);
  if (others.length === 0) return [];

  const self = agents.find((agent) => agent.id === selfId);
  const coordinator = agents.find((agent) => /\b(coordinator|orchestrator|facilitator|lead|planner)\b/i.test(agent.role));
  const nonCoordinatorPeers = others.filter((agent) => agent.id !== coordinator?.id);

  if (phase === 'frame' && self?.id === coordinator?.id) {
    return nonCoordinatorPeers.length > 0 ? [nonCoordinatorPeers[0]] : [others[0]];
  }

  if (phase === 'synthesize' && coordinator && self?.id !== coordinator.id) {
    return [coordinator];
  }

  if (phase === 'critique') {
    const buildPeer = others.find((agent) => /\b(builder|implement|developer|engineer|architect|coding|software|frontend|backend)\b/i.test(agent.role));
    if (buildPeer) return [buildPeer];
  }

  if (phase === 'build') {
    const skepticPeer = others.find((agent) => /\b(skeptic|critic|critique|reviewer|auditor|red team)\b/i.test(agent.role));
    if (skepticPeer) return [skepticPeer];
  }

  return [others[offset % others.length]];
}

async function askAgent(
  question: string,
  agent: Agent,
  peers: Agent[],
  memory: string[],
  phase: AgentPhase,
  onDelta: (delta: string) => void,
) {
  const fallback = {
    message: `${agent.name} would examine "${question.slice(0, 90)}" from the angle of ${agent.role.toLowerCase()}`,
    confidence: 0.55,
  };

  agent.innerState = await updateInnerState(question, agent, peers, memory, phase);
  const prompt = buildAgentPrompt({ question, agent, peers, memory, phase });

  const rawMessage = await chatText(agent.model, prompt, fallback.message, onDelta, agent.llmSettings);
  const message = stripImageLines(rawMessage);
  return {
    message,
    confidence: confidenceFromText(message),
  };
}

async function updateInnerState(
  question: string,
  agent: Agent,
  peers: Agent[],
  memory: string[],
  phase: AgentPhase,
) {
  const prompt = buildInnerStatePrompt({ question, agent, peers, memory, phase });
  const rawState = await chatText(agent.model, prompt, JSON.stringify(agent.innerState), () => undefined, {
    temperature: Math.min(agent.llmSettings.temperature, 0.35),
    topP: agent.llmSettings.topP,
    maxOutputTokens: 512,
    frequencyPenalty: 0,
    presencePenalty: 0,
  }, false);

  return parseInnerState(rawState, agent.innerState);
}

async function judgeImageNeed(question: string, agent: Agent, message: string) {
  if (!/\b(visual|image|diagram|layout|map|interface|screen|scene|graph|network|architecture|comparison|sketch|draw)\b/i.test(message)) {
    return null;
  }

  const prompt = buildImageJudgePrompt({ question, agent, message });
  const result = await chatText(agent.model, prompt, 'NO_IMAGE', () => undefined, {
    temperature: 0.1,
    topP: 1,
    maxOutputTokens: 512,
    frequencyPenalty: 0,
    presencePenalty: 0,
  }, false);
  return parseImageLine(result);
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

function parseInnerState(rawState: string, fallback: AgentInnerState): AgentInnerState {
  try {
    const jsonText = extractJsonObject(rawState);
    const parsed = JSON.parse(jsonText) as Partial<AgentInnerState>;
    return {
      attention: normalizeAttention(parsed.attention, fallback.attention),
      motive: normalizeShortString(parsed.motive, fallback.motive),
      affect: normalizeShortString(parsed.affect, fallback.affect),
      uncertainty: normalizeShortString(parsed.uncertainty, fallback.uncertainty),
      socialPressure: normalizeShortString(parsed.socialPressure, fallback.socialPressure),
      selfCritique: normalizeShortString(parsed.selfCritique, fallback.selfCritique),
    };
  } catch {
    return fallback;
  }
}

function extractJsonObject(rawState: string) {
  const start = rawState.indexOf('{');
  const end = rawState.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return rawState;
  return rawState.slice(start, end + 1);
}

function normalizeAttention(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().replace(/\s+/g, ' ').slice(0, 160))
    .filter(Boolean)
    .slice(0, 4);
  return cleaned.length > 0 ? cleaned : fallback;
}

function normalizeShortString(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, 220);
  return cleaned || fallback;
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

  const answer = await chatText(model, prompt, fallback.answer, onDelta, settingsForCategory('general'));
  return { answer, confidence: averageConfidence(agents) };
}

async function chatText(
  model: string,
  prompt: string,
  fallback: string,
  onDelta: (delta: string) => void,
  settings: AgentLlmSettings,
  stream = true,
) {
  if (isOpenRouterModel(model)) {
    return chatTextOpenRouter(model, prompt, fallback, onDelta, settings, stream);
  }

  return chatTextOllama(model, prompt, fallback, onDelta, settings, stream);
}

function isOpenRouterModel(model: string) {
  return openRouterFreeModels.includes(model) || isKnownFreeOpenRouterModel(model);
}

async function chatTextOpenRouter(
  model: string,
  prompt: string,
  fallback: string,
  onDelta: (delta: string) => void,
  settings: AgentLlmSettings,
  stream = true,
) {
  try {
    if (!openRouterApiKey) {
      throw new Error('OPENROUTER_API_KEY is required for OpenRouter models.');
    }
    if (!isAllowedOpenRouterFreeModel(model)) {
      throw new Error(`OpenRouter model "${model}" is blocked because only free models are allowed.`);
    }

    const result = await fetch(`${openRouterBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openRouterApiKey}`,
        'HTTP-Referer': openRouterSiteUrl,
        'X-Title': openRouterAppName,
      },
      body: JSON.stringify({
        model,
        stream,
        temperature: settings.temperature,
        top_p: settings.topP,
        max_tokens: settings.maxOutputTokens,
        messages: [
          { role: 'system', content: swarmSystemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!result.ok) throw new Error(`OpenRouter returned ${result.status}: ${await summarizeResponseError(result)}`);

    if (!stream) {
      const packet = await result.json() as { choices?: { message?: { content?: string } }[] };
      const cleaned = packet.choices?.[0]?.message?.content?.trim();
      if (!cleaned) throw new Error('OpenRouter returned an empty message.');
      return cleaned;
    }

    let fullText = '';
    const reader = result.body?.getReader();
    if (!reader) throw new Error('OpenRouter response did not include a stream body.');

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
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        const packet = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const delta = packet.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      }
    }

    const cleaned = fullText.trim();
    if (!cleaned) throw new Error('OpenRouter returned an empty message.');
    return cleaned;
  } catch {
    onDelta(fallback);
    return fallback;
  }
}

function isAllowedOpenRouterFreeModel(model: string) {
  return openRouterFreeModels.includes(model) || isKnownFreeOpenRouterModel(model);
}

function isKnownFreeOpenRouterModel(model: string) {
  return model === 'openrouter/free' || model.endsWith(':free');
}

async function chatTextOllama(
  model: string,
  prompt: string,
  fallback: string,
  onDelta: (delta: string) => void,
  settings: AgentLlmSettings,
  stream = true,
) {
  try {
    const result = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream,
        options: ollamaOptions(settings),
        messages: [
          { role: 'system', content: swarmSystemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!result.ok) throw new Error(`Ollama returned ${result.status}`);

    if (!stream) {
      const packet = await result.json() as { message?: { content?: string } };
      const cleaned = packet.message?.content?.trim();
      if (!cleaned) throw new Error('Ollama returned an empty message.');
      return cleaned;
    }

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

async function summarizeResponseError(result: Response) {
  const errorText = await result.text();
  try {
    const parsed = JSON.parse(errorText) as { error?: { message?: string } | string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Fall through to trimmed text.
  }
  return errorText.trim().slice(0, 220) || 'Unknown provider error.';
}

function ollamaOptions(settings: AgentLlmSettings) {
  return {
    temperature: settings.temperature,
    top_p: settings.topP,
    num_ctx: Math.min(Math.max(settings.maxOutputTokens, 2048), 32768),
    num_predict: settings.maxOutputTokens,
    repeat_penalty: 1 + Math.max(settings.frequencyPenalty, settings.presencePenalty) * 0.25,
  };
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
