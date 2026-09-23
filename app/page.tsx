"use client";

import { useState, useEffect, useRef } from "react";
import { WordPair } from "./domains";
import { calculateGameScore, ScoreBreakdown } from "./lib/scoring";
import { getAblyRealtime } from "./lib/ably";
import { fetchWordDefinition } from "./lib/dictionary";

interface StepRecord {
  word: string;
  relatednessToPrevious: number;
  scoreVal: number;
}

interface OpponentStep {
  step: number;
  relatedness: number;
  word?: string; // Revealed only at game over
}

interface OpponentState {
  clientId: string;
  name: string;
  steps: OpponentStep[];
  hasWon: boolean;
  finalHistory?: string[];
}

export default function GamePage() {
  // Navigation: "home" | "lobby" | "playing"
  const [gameType, setGameType] = useState<"solo" | "daily" | "peer">("solo");
  const [view, setView] = useState<"home" | "lobby" | "playing">("home");

  // Game state
  const [targetPair, setTargetPair] = useState<WordPair | null>(null);
  const [history, setHistory] = useState<StepRecord[]>([]);
  const [nextWord, setNextWord] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPair, setLoadingPair] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [copied, setCopied] = useState(false);

  // Feature 1: Semantic Compass (Heatmap / Proximity)
  const [targetProximity, setTargetProximity] = useState<number>(0);
  const [proximityDelta, setProximityDelta] = useState<"hotter" | "colder" | null>(null);

  // Feature 2: Fog of War Peer Multiplayer
  const [myClientId, setMyClientId] = useState<string>("");
  const [roomCode, setRoomCode] = useState<string>("");
  const [joinCodeInput, setJoinCodeInput] = useState<string>("");
  const [isHost, setIsHost] = useState(false);
  const [lobbyStatus, setLobbyStatus] = useState<string>("idle");
  const [pendingGuest, setPendingGuest] = useState<{ clientId: string; name: string } | null>(null);
  const [opponent, setOpponent] = useState<OpponentState | null>(null);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
    score?: number;
    threshold?: number;
  } | null>(null);

  const [hasWon, setHasWon] = useState(false);
  const [opponentWon, setOpponentWon] = useState(false);
  const [finalScore, setFinalScore] = useState<ScoreBreakdown | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ablyChannelRef = useRef<any>(null);
  const defCacheRef = useRef<Record<string, { partOfSpeech?: string; definition: string }>>({});

  // Word definition tooltip/card state
  const [activeDefinition, setActiveDefinition] = useState<{
    word: string;
    partOfSpeech?: string;
    definition: string;
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    setMyClientId(`player_${Math.random().toString(36).substring(2, 7)}`);
  }, []);

  const handleToggleDefinition = async (word: string) => {
    const clean = word.trim().toLowerCase();
    if (!clean) return;

    if (activeDefinition?.word === clean && !activeDefinition.loading) {
      setActiveDefinition(null);
      return;
    }

    if (defCacheRef.current[clean]) {
      setActiveDefinition({
        word: clean,
        partOfSpeech: defCacheRef.current[clean].partOfSpeech,
        definition: defCacheRef.current[clean].definition,
        loading: false,
      });
      return;
    }

    setActiveDefinition({
      word: clean,
      definition: "Looking up definition...",
      loading: true,
    });

    const res = await fetchWordDefinition(clean);
    if (res) {
      defCacheRef.current[clean] = {
        partOfSpeech: res.partOfSpeech,
        definition: res.definition,
      };
      setActiveDefinition({
        word: clean,
        partOfSpeech: res.partOfSpeech,
        definition: res.definition,
        loading: false,
      });
    } else {
      const fallback = {
        definition: "No definition found for this word.",
      };
      defCacheRef.current[clean] = fallback;
      setActiveDefinition({
        word: clean,
        definition: fallback.definition,
        loading: false,
      });
    }
  };

  // Start Solo / Daily Game
  const initGame = async (type: "solo" | "daily") => {
    setActiveDefinition(null);
    setGameType(type);
    setView("playing");
    setLoadingPair(true);
    setFeedback(null);
    setHasWon(false);
    setOpponentWon(false);
    setFinalScore(null);
    setFailedAttempts(0);
    setNextWord("");
    setCopied(false);
    setOpponent(null);
    setProximityDelta(null);

    try {
      const url = type === "daily" ? "/api/pair?daily=true" : "/api/pair";
      const res = await fetch(url);
      const pair: WordPair = await res.json();
      setTargetPair(pair);
      setTargetProximity(pair.baselineScore ?? 15);
      setHistory([
        {
          word: pair.source,
          relatednessToPrevious: 100,
          scoreVal: 3.0,
        },
      ]);
    } catch (err) {
      console.error("Failed to load pair:", err);
    } finally {
      setLoadingPair(false);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  };

  // Peer Multiplayer Setup
  const handleHostRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomCode(code);
    setIsHost(true);
    setLobbyStatus("hosting");
    setView("lobby");
    setPendingGuest(null);

    const res = await fetch("/api/pair");
    const pair: WordPair = await res.json();
    setTargetPair(pair);
    setTargetProximity(pair.baselineScore ?? 15);

    const ably = getAblyRealtime(myClientId);
    const channel = ably.channels.get(`game:room_${code}`);
    ablyChannelRef.current = channel;

    channel.subscribe("join_request", (msg: any) => {
      if (msg.data.clientId !== myClientId) {
        setPendingGuest({
          clientId: msg.data.clientId,
          name: msg.data.name || "Challenger",
        });
      }
    });

    channel.subscribe("peer_step", (msg: any) => {
      if (msg.data.clientId !== myClientId) {
        setOpponent((prev) => {
          const currentSteps = prev?.steps ?? [];
          return {
            clientId: msg.data.clientId,
            name: msg.data.name || "Opponent",
            steps: [
              ...currentSteps,
              {
                step: msg.data.step,
                relatedness: msg.data.relatedness,
                word: msg.data.isGameOver ? msg.data.word : undefined,
              },
            ],
            hasWon: msg.data.hasWon,
            finalHistory: msg.data.finalHistory ?? prev?.finalHistory,
          };
        });

        if (msg.data.hasWon) {
          setOpponentWon(true);
        }
      }
    });
  };

  const handleAcceptGuest = () => {
    if (!pendingGuest || !ablyChannelRef.current || !targetPair) return;
    setActiveDefinition(null);

    ablyChannelRef.current.publish("join_accepted", {
      targetPair,
      hostId: myClientId,
      guestId: pendingGuest.clientId,
    });

    setOpponent({
      clientId: pendingGuest.clientId,
      name: pendingGuest.name,
      steps: [{ step: 1, relatedness: 100 }],
      hasWon: false,
    });

    setHistory([
      {
        word: targetPair.source,
        relatednessToPrevious: 100,
        scoreVal: 3.0,
      },
    ]);

    setGameType("peer");
    setView("playing");
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handleJoinRoom = () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;

    setRoomCode(code);
    setIsHost(false);
    setLobbyStatus("joining");
    setView("lobby");

    const ably = getAblyRealtime(myClientId);
    const channel = ably.channels.get(`game:room_${code}`);
    ablyChannelRef.current = channel;

    channel.publish("join_request", {
      clientId: myClientId,
      name: "Challenger",
    });

    channel.subscribe("join_accepted", (msg: any) => {
      setActiveDefinition(null);
      const pair: WordPair = msg.data.targetPair;
      setTargetPair(pair);
      setTargetProximity(pair.baselineScore ?? 15);
      setOpponent({
        clientId: msg.data.hostId,
        name: "Host Player",
        steps: [{ step: 1, relatedness: 100 }],
        hasWon: false,
      });

      setHistory([
        {
          word: pair.source,
          relatednessToPrevious: 100,
          scoreVal: 3.0,
        },
      ]);

      setGameType("peer");
      setView("playing");
      setTimeout(() => inputRef.current?.focus(), 150);
    });

    channel.subscribe("peer_step", (msg: any) => {
      if (msg.data.clientId !== myClientId) {
        setOpponent((prev) => {
          const currentSteps = prev?.steps ?? [];
          return {
            clientId: msg.data.clientId,
            name: msg.data.name || "Opponent",
            steps: [
              ...currentSteps,
              {
                step: msg.data.step,
                relatedness: msg.data.relatedness,
                word: msg.data.isGameOver ? msg.data.word : undefined,
              },
            ],
            hasWon: msg.data.hasWon,
            finalHistory: msg.data.finalHistory ?? prev?.finalHistory,
          };
        });

        if (msg.data.hasWon) {
          setOpponentWon(true);
        }
      }
    });
  };

  const currentWord = history.length > 0 ? history[history.length - 1].word : "";
  const targetWord = targetPair?.target || "";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = e.target.value.replace(/[^a-zA-Z]/g, "");
    setNextWord(sanitized);
    if (feedback?.type === "error") setFeedback(null);
  };

  const candidateLower = nextWord.trim().toLowerCase();
  const isDuplicate = history.some((s) => s.word.toLowerCase() === candidateLower);
  const isSameAsCurrent = candidateLower === currentWord.toLowerCase();
  const canSubmit = candidateLower.length >= 2 && !isDuplicate && !isSameAsCurrent && !loading;

  const currentStepCount = Math.max(0, history.length - 1);
  const currentLiveScore = Math.max(
    500,
    10000 - Math.max(0, currentStepCount - 4) * 400 - failedAttempts * 150
  );

  const handleStepSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word1: currentWord,
          word2: candidateLower,
          targetWord,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Evaluation failed");

      const noulProbability = data?.answers?.are_related?.noul ?? 0;
      const scoreVal = data?.answers?.similarity_score?.score ?? 0;
      const pct = Math.round(noulProbability * 100);
      const newProximityPct = Math.round((data?.answers?.proximity_to_target?.noul ?? 0) * 100);

      // Check 70% threshold
      if (pct < 70) {
        setFailedAttempts((prev) => prev + 1);
        setFeedback({
          type: "error",
          message: `Too distant from "${currentWord}". Requires ≥ 70% relatedness (-150 pts).`,
          score: pct,
          threshold: 70,
        });
        setLoading(false);
        return;
      }

      // Feature 1: Semantic Compass comparison
      if (newProximityPct > targetProximity) {
        setProximityDelta("hotter");
      } else if (newProximityPct < targetProximity) {
        setProximityDelta("colder");
      } else {
        setProximityDelta(null);
      }
      setTargetProximity(newProximityPct);

      const newHistory: StepRecord[] = [
        ...history,
        { word: candidateLower, relatednessToPrevious: pct, scoreVal },
      ];
      setHistory(newHistory);
      setNextWord("");

      // Feature 2: Fog of War Peer Broadcast
      if (gameType === "peer" && ablyChannelRef.current) {
        ablyChannelRef.current.publish("peer_step", {
          clientId: myClientId,
          name: isHost ? "Host" : "Challenger",
          step: newHistory.length,
          relatedness: pct,
          hasWon: false,
          isGameOver: false,
        });
      }

      const finalizeVictory = (finalSteps: StepRecord[]) => {
        const stepSimilarities = finalSteps.slice(1).map((s) => s.relatednessToPrevious);
        const score = calculateGameScore({
          baselineScore: targetPair?.baselineScore ?? 15,
          stepCount: finalSteps.length - 1,
          stepSimilarities,
          failedAttempts,
        });
        setFinalScore(score);
        setHasWon(true);

        if (gameType === "peer" && ablyChannelRef.current) {
          ablyChannelRef.current.publish("peer_step", {
            clientId: myClientId,
            name: isHost ? "Host" : "Challenger",
            step: finalSteps.length,
            relatedness: 100,
            hasWon: true,
            isGameOver: true,
            finalHistory: finalSteps.map((s) => s.word),
          });
        }
      };

      // Direct target hit
      if (candidateLower === targetWord.toLowerCase()) {
        finalizeVictory(newHistory);
        setFeedback({
          type: "success",
          message: `Reached "${targetWord}" in ${newHistory.length - 1} steps.`,
          score: pct,
        });
        setLoading(false);
        return;
      }

      // Auto-connect if candidate is >= 70% to target
      if (newProximityPct >= 70) {
        const finalHistory: StepRecord[] = [
          ...newHistory,
          {
            word: targetWord,
            relatednessToPrevious: newProximityPct,
            scoreVal: 3.0,
          },
        ];
        setHistory(finalHistory);
        finalizeVictory(finalHistory);
        setFeedback({
          type: "success",
          message: `Connected to "${targetWord}" (${newProximityPct}% related).`,
          score: newProximityPct,
        });
      } else {
        setFeedback({
          type: "info",
          message: `Step accepted (${pct}%). Distance to target: ${newProximityPct}%.`,
          score: pct,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Failed to contact evaluation engine.",
      });
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const copyShareText = () => {
    if (!targetPair || !finalScore) return;
    const isDailyChallenge = gameType === "daily";
    const shareText = `WordBridge ${isDailyChallenge ? "(Daily Challenge)" : ""}
${targetPair.source} ➔ ${targetPair.target}
Solved in ${history.length - 1} steps • Rank ${finalScore.rank} (${finalScore.title})
Score: ${finalScore.totalScore.toLocaleString()} pts • Cohesion: ${finalScore.averageSimilarity}%`;

    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // ==========================================
  // VIEW 1: HOME PAGE (Minimalist Monochrome)
  // ==========================================
  if (view === "home") {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-6 selection:bg-zinc-800 selection:text-white">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="text-center space-y-3">
            <span className="inline-block text-[11px] font-mono tracking-widest uppercase text-zinc-400 border border-zinc-800 bg-zinc-900/60 px-3 py-1 rounded-full">
              Semantic Ladder
            </span>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
              WordBridge
            </h1>
            <p className="text-sm text-zinc-400 max-w-sm mx-auto leading-relaxed">
              Connect two distant concepts in semantic space. Each bridge step requires ≥ 70% conceptual affinity.
            </p>
          </div>

          {/* Mode Selection Cards */}
          <div className="space-y-3">
            {/* Daily Challenge */}
            <button
              onClick={() => initGame("daily")}
              className="w-full p-4 bg-white text-black hover:bg-zinc-200 transition-colors rounded-xl flex items-center justify-between text-left group"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">Daily Challenge</span>
                  <span className="text-[10px] font-mono uppercase bg-black text-white px-1.5 py-0.5 rounded">
                    Today
                  </span>
                </div>
                <span className="text-xs text-zinc-600 block mt-0.5">
                  Synchronized puzzle globally every 24h
                </span>
              </div>
              <span className="text-sm font-mono text-zinc-500 group-hover:translate-x-0.5 transition-transform">
                →
              </span>
            </button>

            {/* Solo Practice */}
            <button
              onClick={() => initGame("solo")}
              className="w-full p-4 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-white transition-colors rounded-xl flex items-center justify-between text-left group"
            >
              <div>
                <span className="font-semibold text-sm block">Solo Practice</span>
                <span className="text-xs text-zinc-400 block mt-0.5">
                  Random pair from curated English vocabulary
                </span>
              </div>
              <span className="text-sm font-mono text-zinc-500 group-hover:translate-x-0.5 transition-transform">
                →
              </span>
            </button>

            {/* 1v1 Fog of War Match */}
            <button
              onClick={() => setView("lobby")}
              className="w-full p-4 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-white transition-colors rounded-xl flex items-center justify-between text-left group"
            >
              <div>
                <span className="font-semibold text-sm block">1v1 Blind Match</span>
                <span className="text-xs text-zinc-400 block mt-0.5">
                  Live race with opponent words hidden until finish
                </span>
              </div>
              <span className="text-sm font-mono text-zinc-500 group-hover:translate-x-0.5 transition-transform">
                →
              </span>
            </button>
          </div>

          {/* Minimal 3-Step Guide */}
          <div className="pt-4 border-t border-zinc-900 text-left space-y-2">
            <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-500 block">
              How It Works
            </span>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="border border-zinc-900 bg-zinc-950 p-3 rounded-lg space-y-1">
                <span className="font-mono text-zinc-600 block text-[10px]">01</span>
                <span className="text-zinc-200 block font-medium">Start & Target</span>
                <span className="text-zinc-500 block leading-snug">Two distant anchor words</span>
              </div>
              <div className="border border-zinc-900 bg-zinc-950 p-3 rounded-lg space-y-1">
                <span className="font-mono text-zinc-600 block text-[10px]">02</span>
                <span className="text-zinc-200 block font-medium">Bridge Step</span>
                <span className="text-zinc-500 block leading-snug">Must be ≥ 70% related</span>
              </div>
              <div className="border border-zinc-900 bg-zinc-950 p-3 rounded-lg space-y-1">
                <span className="font-mono text-zinc-600 block text-[10px]">03</span>
                <span className="text-zinc-200 block font-medium">Connect</span>
                <span className="text-zinc-500 block leading-snug">Reach target in fewest steps</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: PEER LOBBY (Minimalist)
  // ==========================================
  if (view === "lobby") {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-6 selection:bg-zinc-800 selection:text-white">
        <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800/40">
            <div>
              <h2 className="text-base font-semibold text-white">1v1 Blind Match</h2>
              <span className="text-xs text-zinc-500 font-mono">Fog of War Race</span>
            </div>
            <button
              onClick={() => setView("home")}
              className="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              ← Back
            </button>
          </div>

          {lobbyStatus === "hosting" ? (
            <div className="space-y-6 text-center">
              <div className="p-6 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2">
                <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-400 block">
                  Room Code
                </span>
                <span className="text-4xl font-bold text-white font-mono tracking-widest block">
                  {roomCode}
                </span>
                <span className="text-xs text-zinc-400 block pt-1">
                  Share this code with your opponent
                </span>
              </div>

              {pendingGuest ? (
                <div className="p-4 border border-zinc-700 bg-zinc-900 rounded-xl text-left space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-mono uppercase text-zinc-400 block">
                        Challenger Connected
                      </span>
                      <span className="text-sm font-semibold text-white">{pendingGuest.name}</span>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-white"></span>
                  </div>

                  <button
                    onClick={handleAcceptGuest}
                    className="w-full py-3 bg-white text-black font-semibold rounded-lg text-sm hover:bg-zinc-200 transition-colors"
                  >
                    Accept & Begin Match
                  </button>
                </div>
              ) : (
                <div className="p-6 border border-zinc-800/40 rounded-xl space-y-3">
                  <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin mx-auto"></div>
                  <p className="text-xs text-zinc-400 font-mono">Waiting for challenger to join...</p>
                </div>
              )}
            </div>
          ) : lobbyStatus === "joining" ? (
            <div className="space-y-4 text-center py-6">
              <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin mx-auto"></div>
              <div>
                <h3 className="text-sm font-semibold text-white">Connected to Room {roomCode}</h3>
                <p className="text-xs text-zinc-400 mt-1 font-mono">Waiting for host approval...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <button
                onClick={handleHostRoom}
                className="w-full py-3.5 px-4 bg-white text-black font-semibold rounded-xl transition text-sm hover:bg-zinc-200"
              >
                Create Room (Host)
              </button>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-zinc-800/40"></div>
                <span className="flex-shrink mx-4 text-zinc-500 text-[10px] uppercase font-mono tracking-widest">
                  Or Join Existing
                </span>
                <div className="flex-grow border-t border-zinc-800/40"></div>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="ROOM CODE"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-center text-white placeholder-zinc-600 uppercase tracking-widest font-mono text-base font-bold focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={handleJoinRoom}
                  disabled={!joinCodeInput.trim()}
                  className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white font-medium rounded-xl text-sm transition border border-zinc-800"
                >
                  Join Match
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 3: ACTIVE GAME (Mobile Viewport Optimized)
  // ==========================================
  return (
    <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-black text-zinc-100 flex flex-col items-center justify-between p-2 sm:p-4 md:p-6 selection:bg-zinc-800 selection:text-white">
      {/* Header (shrink-0) */}
      <header className="w-full max-w-xl flex items-center justify-between py-1.5 sm:py-2 border-b border-zinc-800/40 mb-2 sm:mb-3 shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            onClick={() => setView("home")}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            ← Exit
          </button>
          <span className="text-zinc-700">/</span>
          <span className="text-xs font-mono uppercase tracking-wider text-zinc-400 truncate max-w-[130px] sm:max-w-none">
            {gameType === "daily"
              ? "Daily Challenge"
              : gameType === "peer"
              ? `Room ${roomCode}`
              : "Solo Practice"}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-zinc-500 hidden sm:inline">POTENTIAL:</span>
          <span className="text-zinc-500 sm:hidden">PTS:</span>
          <span className="text-white font-semibold">{currentLiveScore.toLocaleString()}</span>
        </div>
      </header>

      {/* Main Game Container */}
      <main className="w-full max-w-xl flex-1 flex flex-col justify-between bg-zinc-950 border border-zinc-800/40 rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-xl relative min-h-0 overflow-hidden">
        {loadingPair || !targetPair ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-0 space-y-3">
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
            <p className="text-xs font-mono text-zinc-500">
              Generating semantic pair...
            </p>
          </div>
        ) : (
          <>
            {/* Top pinned block: Opponent + Goal Card + Compass (shrink-0) */}
            <div className="shrink-0 space-y-2 mb-2">
              {/* FEATURE 2: FOG OF WAR OPPONENT BAR (Multiplayer) */}
              {gameType === "peer" && opponent && (
                <div className="p-2 sm:p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                      <span className="font-semibold text-zinc-200">Opponent: {opponent.name}</span>
                    </div>
                    <span className="font-mono text-zinc-500 text-[11px]">
                      Step {opponent.steps.length} {opponent.hasWon ? "• Finished" : ""}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                    {opponent.steps.map((st, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded text-[10px] font-mono border border-zinc-800 bg-zinc-950 text-zinc-300"
                        title={hasWon || opponentWon ? st.word : "Word hidden until game finishes"}
                      >
                        {hasWon || (opponentWon && st.word)
                          ? st.word
                          : `Step ${i + 1} (${st.relatedness}%)`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Target Goal Card */}
              <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-2.5 sm:p-4">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1.5">
                  <span className="font-semibold text-zinc-300">
                    {gameType === "daily" ? "Daily Bridge" : "Challenge"}
                  </span>
                  <span>
                    {targetPair.difficulty} • {targetPair.baselineScore}% Baseline
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 sm:gap-3">
                  {/* Start Word */}
                  <div className="flex-1 bg-zinc-950/60 border border-zinc-800/30 rounded-lg sm:rounded-xl p-2 sm:p-3 text-center">
                    <div className="flex items-center justify-center gap-1 mb-0.5">
                      <span className="text-[9px] sm:text-[10px] font-mono uppercase text-zinc-400">Start</span>
                      <button
                        type="button"
                        onClick={() => handleToggleDefinition(targetPair.source)}
                        className={`text-[9px] sm:text-[10px] w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-mono transition border ${
                          activeDefinition?.word === targetPair.source.toLowerCase()
                            ? "bg-zinc-800 text-zinc-100 border-zinc-600"
                            : "text-zinc-500 hover:text-zinc-300 border-zinc-800 hover:border-zinc-700 bg-zinc-900/60"
                        }`}
                        title={`View definition of "${targetPair.source}"`}
                        aria-label={`View definition of ${targetPair.source}`}
                      >
                        ?
                      </button>
                    </div>
                    <span
                      onClick={() => handleToggleDefinition(targetPair.source)}
                      className="text-base sm:text-xl font-bold tracking-tight text-white capitalize cursor-pointer hover:underline underline-offset-4 decoration-zinc-600 transition truncate block"
                      title={`Click for definition of "${targetPair.source}"`}
                    >
                      {targetPair.source}
                    </span>
                  </div>

                  {/* Divider Arrow */}
                  <div className="flex flex-col items-center justify-center text-zinc-500 px-0.5 sm:px-1 shrink-0">
                    <span className="text-sm sm:text-base text-zinc-400">→</span>
                    <span className="text-[8px] sm:text-[9px] font-mono text-zinc-400">≥ 70%</span>
                  </div>

                  {/* Target Word */}
                  <div className="flex-1 bg-zinc-950/60 border border-zinc-800/30 rounded-lg sm:rounded-xl p-2 sm:p-3 text-center">
                    <div className="flex items-center justify-center gap-1 mb-0.5">
                      <span className="text-[9px] sm:text-[10px] font-mono uppercase text-zinc-400">Target</span>
                      <button
                        type="button"
                        onClick={() => handleToggleDefinition(targetPair.target)}
                        className={`text-[9px] sm:text-[10px] w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-mono transition border ${
                          activeDefinition?.word === targetPair.target.toLowerCase()
                            ? "bg-zinc-800 text-zinc-100 border-zinc-600"
                            : "text-zinc-500 hover:text-zinc-300 border-zinc-800 hover:border-zinc-700 bg-zinc-900/60"
                        }`}
                        title={`View definition of "${targetPair.target}"`}
                        aria-label={`View definition of ${targetPair.target}`}
                      >
                        ?
                      </button>
                    </div>
                    <span
                      onClick={() => handleToggleDefinition(targetPair.target)}
                      className="text-base sm:text-xl font-bold tracking-tight text-white capitalize cursor-pointer hover:underline underline-offset-4 decoration-zinc-600 transition truncate block"
                      title={`Click for definition of "${targetPair.target}"`}
                    >
                      {targetPair.target}
                    </span>
                  </div>
                </div>

                {/* Word Definition Drawer */}
                {activeDefinition && (
                  <div className="mt-2 pt-2 border-t border-zinc-800 text-left">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white capitalize text-xs sm:text-sm">
                          {activeDefinition.word}
                        </span>
                        {activeDefinition.partOfSpeech && (
                          <span className="text-[10px] font-mono italic text-zinc-400">
                            [{activeDefinition.partOfSpeech}]
                          </span>
                        )}
                        {activeDefinition.loading && (
                          <span className="w-2.5 h-2.5 border border-zinc-500 border-t-white rounded-full animate-spin"></span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveDefinition(null)}
                        className="text-zinc-500 hover:text-white text-xs px-1.5 py-0.5 rounded transition"
                        aria-label="Close definition"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="text-zinc-300 text-[11px] sm:text-xs leading-relaxed max-h-20 overflow-y-auto">
                      {activeDefinition.definition}
                    </p>
                  </div>
                )}
              </div>

              {/* FEATURE 1: SEMANTIC PROXIMITY BAR */}
              <div className="px-3 sm:px-4 py-1.5 sm:py-2 bg-zinc-900/40 border border-zinc-800/30 rounded-xl flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 text-[10px] sm:text-[11px] uppercase tracking-wider">
                    Proximity:
                  </span>
                  <span className="font-bold text-white text-xs">{targetProximity}%</span>
                </div>

                <div className="flex items-center gap-2.5 sm:gap-3">
                  {proximityDelta === "hotter" && (
                    <span className="text-zinc-300 text-[10px] sm:text-[11px]">↑ Heating Up</span>
                  )}
                  {proximityDelta === "colder" && (
                    <span className="text-zinc-500 text-[10px] sm:text-[11px]">↓ Colder</span>
                  )}

                  <div className="w-16 sm:w-24 bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-zinc-300 transition-all duration-300"
                      style={{ width: `${Math.min(100, targetProximity)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Middle flex area: Pathway History Chain (flex-1 min-h-0 overflow-y-auto) */}
            <div
              className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5 mb-2"
              ref={scrollRef}
            >
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1 sticky top-0 bg-zinc-950/95 py-0.5 z-10 backdrop-blur-sm">
                <span>Pathway ({history.length} {history.length === 1 ? "word" : "words"})</span>
                <span>Misses: <b className="text-zinc-300">{failedAttempts}</b></span>
              </div>

              {history.map((step, idx) => {
                const isStart = idx === 0;
                const isTarget = step.word.toLowerCase() === targetWord.toLowerCase();
                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between px-3 py-1.5 sm:py-2 rounded-lg border text-xs sm:text-sm transition ${
                      isTarget
                        ? "bg-zinc-200 text-black border-transparent font-semibold"
                        : "bg-zinc-900/30 border-zinc-800/30 text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[11px] sm:text-xs ${isTarget ? "text-zinc-600" : "text-zinc-500"}`}>
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="capitalize font-medium tracking-tight">
                        {step.word}
                      </span>
                    </div>

                    {!isStart && (
                      <span
                        className={`font-mono text-[11px] sm:text-xs ${
                          isTarget ? "text-zinc-700 font-semibold" : "text-zinc-400"
                        }`}
                      >
                        {step.relatednessToPrevious}%
                      </span>
                    )}
                    {isStart && (
                      <span className="font-mono text-[9px] sm:text-[10px] uppercase text-zinc-400">
                        Origin
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom pinned block: Feedback + Input or GameOver (shrink-0) */}
            <div className="shrink-0 space-y-1.5 pt-1.5 border-t border-zinc-900/80">
              {/* Notification / Feedback */}
              {feedback && (
                <div
                  className={`p-2 sm:p-2.5 rounded-xl text-xs font-mono border flex items-center justify-between gap-3 ${
                    feedback.type === "error"
                      ? "bg-zinc-900 border-zinc-800 text-rose-400"
                      : "bg-zinc-900 border-zinc-800 text-zinc-200"
                  }`}
                >
                  <span className="truncate">{feedback.message}</span>
                  {feedback.score !== undefined && (
                    <span className="font-bold text-white px-2 py-0.5 rounded bg-zinc-800 shrink-0">
                      {feedback.score}%
                    </span>
                  )}
                </div>
              )}

              {/* GameOver View */}
              {(hasWon || opponentWon) ? (
                <div className="p-3.5 sm:p-5 bg-zinc-900/80 border border-zinc-800/40 rounded-xl text-center space-y-2.5 sm:space-y-3">
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                      {hasWon ? (opponentWon ? "Finished 2nd" : "Bridge Completed") : "Match Finished"}
                    </span>
                    <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-white">
                      Rank {finalScore?.rank ?? "A"}
                    </div>
                    <div className="text-xs text-zinc-400 font-mono">
                      {finalScore ? `${finalScore.totalScore.toLocaleString()} points` : ""}
                    </div>
                  </div>

                  {/* Multiplayer Reveal */}
                  {gameType === "peer" && opponent?.finalHistory && (
                    <div className="p-2 sm:p-2.5 bg-zinc-950 border border-zinc-800/40 rounded-lg text-xs text-left space-y-1 font-mono">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400 block">
                        Paths Side-by-Side
                      </span>
                      <div className="truncate text-zinc-300">
                        <span className="text-white font-semibold">You: </span>
                        {history.map((s) => s.word).join(" → ")}
                      </div>
                      <div className="truncate text-zinc-400">
                        <span className="text-zinc-300 font-semibold">Opponent: </span>
                        {opponent.finalHistory.join(" → ")}
                      </div>
                    </div>
                  )}

                  {/* Daily Challenge Global Benchmark */}
                  {gameType === "daily" && (
                    <div className="p-2 sm:p-2.5 bg-zinc-950 border border-zinc-800/40 rounded-lg text-xs font-mono text-left">
                      <span className="text-[10px] uppercase text-zinc-400 block mb-0.5">
                        Daily Benchmark
                      </span>
                      <p className="text-zinc-300 text-xs">
                        Solved in {history.length - 1} steps. Target par: 4 steps.
                      </p>
                    </div>
                  )}

                  {finalScore && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 sm:gap-1.5 text-xs font-mono">
                      <div className="bg-zinc-950 border border-zinc-800/40 p-1.5 sm:p-2 rounded-lg">
                        <span className="text-[9px] text-zinc-400 block">Difficulty</span>
                        <span className="font-semibold text-white">+{finalScore.difficultyBonus}</span>
                      </div>
                      <div className="bg-zinc-950 border border-zinc-800/40 p-1.5 sm:p-2 rounded-lg">
                        <span className="text-[9px] text-zinc-400 block">Efficiency</span>
                        <span className="font-semibold text-white">+{finalScore.stepEfficiency}</span>
                      </div>
                      <div className="bg-zinc-950 border border-zinc-800/40 p-1.5 sm:p-2 rounded-lg">
                        <span className="text-[9px] text-zinc-400 block">Cohesion</span>
                        <span className="font-semibold text-white">{finalScore.averageSimilarity}%</span>
                      </div>
                      <div className="bg-zinc-950 border border-zinc-800/40 p-1.5 sm:p-2 rounded-lg">
                        <span className="text-[9px] text-zinc-400 block">Misses</span>
                        <span className="font-semibold text-zinc-400">-{finalScore.missPenalty}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-0.5">
                    <button
                      onClick={copyShareText}
                      className="flex-1 py-2 sm:py-2.5 bg-white text-black font-semibold rounded-lg text-sm hover:bg-zinc-200 transition-colors"
                    >
                      {copied ? "Copied" : "Share Result"}
                    </button>

                    <button
                      onClick={() => (gameType === "peer" ? setView("home") : initGame(gameType))}
                      className="flex-1 py-2 sm:py-2.5 bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 font-semibold rounded-lg text-sm transition-colors border border-zinc-700"
                    >
                      {gameType === "peer" ? "Main Menu" : "Play Next"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Input Form */
                <form onSubmit={handleStepSubmit} className="space-y-1.5">
                  {/* Contextual Mini Anchor Bar directly above input */}
                  <div className="flex items-center justify-between text-[11px] font-mono px-1 text-zinc-400">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-zinc-500">From:</span>
                      <span className="text-white font-semibold capitalize">{currentWord}</span>
                      <span className="text-zinc-600">→</span>
                      <span className="text-zinc-500">Target:</span>
                      <span className="text-zinc-200 font-semibold capitalize">{targetWord}</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 shrink-0 font-mono ml-2">
                      {targetProximity}%
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder={`Step from "${currentWord}"...`}
                      value={nextWord}
                      onChange={handleInputChange}
                      disabled={loading}
                      autoFocus
                      className="flex-1 px-3.5 py-2.5 sm:py-3 bg-zinc-900/60 border border-zinc-800/50 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700 font-medium text-sm sm:text-base transition-colors"
                    />

                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="py-2.5 sm:py-3 px-4 sm:px-5 bg-zinc-200 hover:bg-white active:bg-zinc-300 text-black font-semibold rounded-xl text-sm transition-colors disabled:opacity-20 shrink-0"
                    >
                      {loading ? "..." : "Submit"}
                    </button>
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 px-1">
                    <span>≥ 70% related</span>
                    {nextWord.length === 1 ? (
                      <span className="text-zinc-400">Min 2 letters</span>
                    ) : isDuplicate ? (
                      <span className="text-rose-400">Already in chain</span>
                    ) : (
                      <span>Real-time check</span>
                    )}
                  </div>
                </form>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
