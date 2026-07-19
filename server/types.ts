export type Agent = {
  id: string;
  name: string;
  role: string;
  model: string;
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
