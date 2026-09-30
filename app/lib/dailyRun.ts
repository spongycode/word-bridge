import type { WordPair } from "../domains";

// Shared shape of a daily run as returned to the client
export interface DailyRunState {
  path: string[];
  stepScores: number[];
  failedAttempts: number;
  lastProximity: number;
  finished: boolean;
  gaveUp: boolean;
}

export interface PlayerStats {
  currentStreak: number; // consecutive UTC days with a solved daily, ending today or yesterday
  maxStreak: number;
  dailyPlayed: number;
  dailySolved: number;
  averageSteps: number | null;
  bestScore: number | null;
  solvedToday: boolean;
  matchWins: number;
  matchLosses: number;
}

// Sent by the matchmaking API to both players when a random opponent is found
export interface MatchFound {
  roomCode: string;
  matchId: string;
  role: "host" | "guest";
  targetPair: WordPair;
  opponentClientId: string;
  opponentName: string;
  forClientId?: string; // set on inbox notices: the queued tab that should act on it
}

// Sent to a player's inbox when a past opponent taps "Race again"
export interface RaceInvite {
  roomCode: string;
  fromName: string;
  fromIdentity: string;
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
