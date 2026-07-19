import service from './index';

export type HistoryFile = { filename: string };

export type SimulationHistoryItem = {
  simulation_id: string;
  project_id?: string | null;
  report_id?: string | null;
  simulation_requirement?: string;
  files?: HistoryFile[];
  created_at?: string;
  current_round?: number;
  total_rounds?: number;
};

export type HistoryResponse = {
  success: boolean;
  data?: SimulationHistoryItem[];
};

export function getSimulationHistory(limit = 20): Promise<HistoryResponse> {
  return service.get('/api/simulation/history', { params: { limit } });
}
