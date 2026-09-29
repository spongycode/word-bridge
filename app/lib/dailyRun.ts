// Shared shape of a daily run as returned to the client
export interface DailyRunState {
  path: string[];
  stepScores: number[];
  failedAttempts: number;
  lastProximity: number;
  finished: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  steps: number;
  misses: number;
  path?: string[];
  isMe: boolean;
}

export interface LeaderboardResponse {
  day: string;
  totalFinished: number;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
  pathsVisible: boolean;
}
