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
}

export interface ActiveGameSession {
  roomCode: string;
  isHost: boolean;
  targetPair: WordPair;
  history: StepRecord[];
  hasWon: boolean;
  opponentWon: boolean;
  opponent: OpponentState | null;
  updatedAt: number;
}

export interface MatchHistoryItem {
  id: string;
  roomCode: string;
  sourceWord: string;
  targetWord: string;
  myUsername: string;
  mySteps: number;
  myPath: string[];
  opponentName: string;
  opponentSteps?: number;
  opponentPath?: string[];
  result: "won" | "lost" | "draw" | "abandoned";
  timestamp: number;
}

const ADJECTIVES = [
  "Swift", "Cosmic", "Neon", "Brave", "Silent", "Shadow", "Stellar", "Frost",
  "Solar", "Quantum", "Hyper", "Vivid", "Astral", "Echo", "Iron", "Phantom",
  "Vortex", "Mystic", "Thunder", "Zenith", "Blaze", "Apex", "Nova", "Pulse",
  "Crimson", "Amber", "Velvet", "Onyx", "Cobalt", "Rogue", "Noble", "Prism"
];

const NOUNS = [
  "Falcon", "Fox", "Otter", "Hawk", "Wolf", "Lynx", "Panda", "Viper",
  "Eagle", "Deer", "Raven", "Tiger", "Badger", "Jaguar", "Kestrel", "Cobra",
  "Osprey", "Bison", "Orion", "Nomad", "Sphinx", "Griffin", "Drifter", "Pioneer",
  "Phoenix", "Cypher", "Ronin", "Voyager", "Matrix", "Tracker", "Wanderer"
];

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "dev_server";
  try {
    let id = localStorage.getItem("wordbridge_device_id");
    if (!id) {
      id = `dev_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
      localStorage.setItem("wordbridge_device_id", id);
    }
    return id;
  } catch {
    return `dev_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export function generateRandomUsername(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${adj}${noun}_${num}`;
}

export function getOrCreateUsername(): string {
  if (typeof window === "undefined") return "Player";
  try {
    let name = localStorage.getItem("wordbridge_username");
    if (!name || name.trim().length === 0) {
      name = generateRandomUsername();
      localStorage.setItem("wordbridge_username", name);
    }
    return name;
  } catch {
    return "Player";
  }
}

export function saveUsername(name: string): string {
  const clean = name.trim().replace(/[^a-zA-Z0-9_-]/g, "").substring(0, 16) || generateRandomUsername();
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("wordbridge_username", clean);
    } catch {}
  }
  return clean;
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
    const history = getMatchHistory();
    const newItem: MatchHistoryItem = {
      ...item,
      id: `match_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };
    // Keep last 30 matches
    const updated = [newItem, ...history.filter(m => m.roomCode !== item.roomCode || Math.abs(m.timestamp - Date.now()) > 60000)].slice(0, 30);
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(updated));
  } catch {}
}

export function clearMatchHistory() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(MATCH_HISTORY_KEY);
  } catch {}
}
