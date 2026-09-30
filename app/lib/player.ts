import { WordPair } from "../domains";

export interface StepRecord {
  word: string;
  relatednessToPrevious: number;
  scoreVal: number;
}

export interface OpponentStep {
  step: number;
  relatedness: number;
  word?: string;
}

export interface OpponentState {
  clientId: string;
  name: string;
  steps: OpponentStep[];
  hasWon: boolean;
  finalHistory?: string[];
  proximity?: number; // opponent's latest closeness to the target (0-100)
}

export interface ActiveGameSession {
  roomCode: string;
  isHost: boolean;
  targetPair: WordPair;
  history: StepRecord[];
  hasWon: boolean;
  opponentWon: boolean;
  opponent: OpponentState | null;
  matchId: string;
  round: number;
  updatedAt: number;
}

export interface MatchHistoryItem {
  id: string;
  matchKey: string; // matchId#round, unique per rematch round
  roomCode: string;
  sourceWord: string;
  targetWord: string;
  myUsername: string;
  mySteps: number;
  myPath: string[];
  myStepScores?: number[]; // link strength per step (for colored squares)
  opponentName: string;
  opponentIdentity?: string; // realtime identity, used for "Race again" invites
  opponentSteps?: number;
  opponentPath?: string[];
  result: "won" | "lost" | "draw" | "abandoned";
  timestamp: number;
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;

function generateGuestName(): string {
  return `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

// Guests get a stable "GuestNNNN" name they can edit; signed-in players use their profile username
export function getOrCreateGuestName(): string {
  if (typeof window === "undefined") return "Guest";
  try {
    let name = localStorage.getItem("wordbridge_username");
    if (!name || !USERNAME_PATTERN.test(name)) {
      name = generateGuestName();
      localStorage.setItem("wordbridge_username", name);
    }
    return name;
  } catch {
    return "Guest";
  }
}

// Returns an error message, or null when the guest name was saved
export function saveGuestName(name: string): string | null {
  const clean = name.trim();
  if (!USERNAME_PATTERN.test(clean)) return "Use 3-16 letters, numbers, _ or -.";
  try {
    localStorage.setItem("wordbridge_username", clean);
  } catch {}
  return null;
}

// ==========================================
// ACTIVE GAME SESSION (Crash/Refresh Recovery)
// ==========================================

const ACTIVE_GAME_KEY = "wordbridge_active_peer_game";

export function saveActiveGameSession(session: ActiveGameSession) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify(session));
  } catch {}
}

export function getActiveGameSession(): ActiveGameSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_GAME_KEY);
    if (!raw) return null;
    const data: ActiveGameSession = JSON.parse(raw);
    // Discard sessions older than 45 minutes
    if (Date.now() - data.updatedAt > 45 * 60 * 1000) {
      clearActiveGameSession();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearActiveGameSession() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACTIVE_GAME_KEY);
  } catch {}
}

// ==========================================
// MATCH HISTORY STORAGE
// ==========================================

const MATCH_HISTORY_KEY = "wordbridge_match_history";

export function getMatchHistory(): MatchHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MATCH_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveMatchResult(item: Omit<MatchHistoryItem, "id" | "timestamp">) {
  if (typeof window === "undefined") return;
  try {
    const history = getMatchHistory().filter((m) => m.matchKey !== item.matchKey);
    const newItem: MatchHistoryItem = {
      ...item,
      id: `match_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };
    // Keep last 30 matches
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify([newItem, ...history].slice(0, 30)));
  } catch {}
}

// The winner learns the loser's path after saving; patch it into the stored record
export function attachOpponentPath(matchKey: string, opponentPath: string[]) {
  if (typeof window === "undefined") return;
  try {
    const history = getMatchHistory().map((m) =>
      m.matchKey === matchKey ? { ...m, opponentPath, opponentSteps: Math.max(0, opponentPath.length - 1) } : m
    );
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

export function clearMatchHistory() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(MATCH_HISTORY_KEY);
  } catch {}
}
