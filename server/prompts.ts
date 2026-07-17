import type { Agent } from './types.js';

export const swarmSystemPrompt =
  'You are one member of a multi-agent discussion. Be concise, concrete, and collaborative.';

export const starterRoles = [
  ['Cartographer', 'Maps the problem, names assumptions, and keeps the discussion coherent.'],
  ['Skeptic', 'Finds weak logic, missing constraints, and false confidence.'],
  ['Builder', 'Turns ideas into practical implementation steps and system boundaries.'],
  ['Memory Keeper', 'Summarizes context, tracks decisions, and prevents circular debate.'],
  ['Synthesizer', 'Combines the strongest arguments into a user-facing answer.'],
] as const;

export function buildAgentPrompt({
  question,
  agent,
  peers,
  memory,
}: {
  question: string;
  agent: Agent;
  peers: Agent[];
  memory: string[];
}) {
  return `You are ${agent.name}. Role: ${agent.role}
Question: ${question}
Known peers: ${peers.map((peer) => `${peer.name} (${peer.role})`).join('; ')}
Shared short-term memory:
${memory.slice(-12).join('\n')}

Speak directly to your peers in 2-4 concise sentences. Add a useful objection, improvement, or decision. Do not use markdown.`;
}

export function buildFinalPrompt({
  question,
  agents,
  memory,
}: {
  question: string;
  agents: Agent[];
  memory: string[];
}) {
  return `User question: ${question}
Agents:
${agents.map((agent) => `${agent.name}: ${agent.role}; confidence ${agent.confidence}`).join('\n')}
Discussion memory:
${memory.slice(-30).join('\n')}

Write a direct final answer for the user. Include concrete next steps and caveats. Do not use markdown.`;
}
