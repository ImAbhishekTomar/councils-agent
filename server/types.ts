export type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
  category: AgentCategory;
  phase: AgentPhase;
  profile: AgentProfile;
  llmSettings: AgentLlmSettings;
  color: string;
  confidence: number;
  // Knowledge-graph node metadata (MiroFish-style "Node Details").
  uuid: string;
  gender: string;
  fullName: string | null;
  userRole: string | null;
  summary: string;
  labels: string[];
  createdAt: string;
};

export type AgentCategory = 'coding' | 'trading' | 'creative' | 'general';

export type AgentPhase = 'frame' | 'perspective' | 'critique' | 'build' | 'synthesize';

export type AgentProfile = {
  temperament: string;
  expertise: string;
  memoryStyle: string;
  riskBias: string;
  speakingStyle: string;
  goals: string;
  constraints: string;
};

export type AgentLlmSettings = {
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  frequencyPenalty: number;
  presencePenalty: number;
};
