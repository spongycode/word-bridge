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
  // Navigation: "home" | "game" | "peer_lobby"
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
      setPendingGuest({
        clientId: msg.data.clientId,
        name: msg.data.name || "Opponent",
      });
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
                word: msg.data.isGameOver ? msg.data.word : undefined, // Blurred until victory
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
      // Parallel evaluation: validity + relatedness + target proximity
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
          message: `Too distant from "${currentWord}". Needs >= 70% relatedness (-150 pts).`,
          score: pct,
          threshold: 70,
        });
        setLoading(false);
        return;
      }

      // Feature 1: Semantic Compass comparison (Heating up or Getting colder)
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

      // Feature 2: Fog of War Peer Broadcast (Words stay blurred to opponent!)
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
          // Reveal full pathway at end of match
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
          message: `🎉 Reached "${targetWord}" in ${newHistory.length - 1} steps!`,
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
          message: `🎉 Connected to "${targetWord}" (${newProximityPct}% related)!`,
          score: newProximityPct,
        });
      } else {
        setFeedback({
          type: "info",
          message: `Step accepted (${pct}%). Compass: ${newProximityPct}% to target.`,
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
    const shareText = `🧩 WordBridge ${isDailyChallenge ? "(Daily Challenge)" : ""}
${targetPair.source} ➡️ ${targetPair.target}
Solved in ${history.length - 1} steps • Rank: ${finalScore.rank} (${finalScore.title})
Score: ${finalScore.totalScore.toLocaleString()} pts
Cohesion: ${finalScore.averageSimilarity}% • Misses: ${failedAttempts}
Played on WordBridge`;

    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // ==========================================
  // VIEW 1: HOME PAGE
  // ==========================================
  if (view === "home") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
        <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            Semantic Association Game
          </div>

          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              WordBridge
            </h1>
            <p className="text-sm text-slate-400 mt-2">
              Build stepping stones between distant concepts with &ge; 70% semantic affinity.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            {/* Feature 3: Daily Challenge Button */}
            <button
              onClick={() => initGame("daily")}
              className="w-full py-4 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:from-amber-600 active:to-amber-700 text-slate-950 font-extrabold rounded-2xl transition duration-150 flex items-center justify-between shadow-lg shadow-amber-500/20 text-base"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">📅</span>
                <div className="text-left">
                  <span className="block text-sm font-bold">Daily Challenge</span>
                  <span className="block text-[11px] text-slate-950/80 font-medium">1 global puzzle every 24h</span>
                </div>
              </div>
              <span className="text-xs bg-slate-950/20 px-2 py-0.5 rounded-full font-bold">Today</span>
            </button>

            {/* Solo Random Game */}
            <button
              onClick={() => initGame("solo")}
              className="w-full py-3.5 px-5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold rounded-2xl transition duration-150 flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/25 text-base"
            >
              <span>Play Random Solo</span>
            </button>

            {/* Feature 2: Fog of War Peer Race */}
            <button
              onClick={() => setView("lobby")}
              className="w-full py-3.5 px-5 bg-slate-800/90 hover:bg-slate-700 active:bg-slate-800 text-slate-200 font-bold rounded-2xl transition duration-150 border border-slate-700 flex items-center justify-center gap-3 text-base"
            >
              <span className="text-indigo-400">👥</span>
              <span>1v1 Peer Race (Fog of War)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: PEER LOBBY
  // ==========================================
  if (view === "lobby") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
        <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-3xl p-7 shadow-2xl space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>🌫️</span> 1v1 Blind Match (Fog of War)
            </h2>
            <button
              onClick={() => setView("home")}
              className="text-xs text-slate-400 hover:text-white transition"
            >
              Back
            </button>
          </div>

          {lobbyStatus === "hosting" ? (
            <div className="space-y-5 text-center">
              <div className="p-4 bg-indigo-950/40 border border-indigo-500/30 rounded-2xl space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold block">
                  Room Code
                </span>
                <span className="text-3xl font-black text-indigo-300 font-mono tracking-widest">
                  {roomCode}
                </span>
                <span className="text-[11px] text-slate-400 block pt-1">
                  Share this code with your opponent
                </span>
              </div>

              {pendingGuest ? (
                <div className="p-4 bg-emerald-950/50 border border-emerald-500/40 rounded-2xl text-left space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-emerald-400 font-bold block">Challenger Ready!</span>
                      <span className="text-sm font-semibold text-white">{pendingGuest.name}</span>
                    </div>
                    <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping"></span>
                  </div>

                  <button
                    onClick={handleAcceptGuest}
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold rounded-xl text-sm transition shadow-lg shadow-emerald-500/25"
                  >
                    Accept & Start Race! 🏁
                  </button>
                </div>
              ) : (
                <div className="p-5 border border-slate-800 rounded-2xl space-y-3">
                  <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin mx-auto"></div>
                  <p className="text-xs text-slate-400 font-medium">Waiting for challenger...</p>
                </div>
              )}
            </div>
          ) : lobbyStatus === "joining" ? (
            <div className="space-y-4 text-center py-4">
              <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin mx-auto"></div>
              <div>
                <h3 className="text-base font-bold text-white">Connected to Room {roomCode}</h3>
                <p className="text-xs text-slate-400 mt-1">Waiting for host to accept...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <button
                onClick={handleHostRoom}
                className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition text-sm flex items-center justify-center gap-2"
              >
                <span>Create New Room (Host)</span>
              </button>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase tracking-wider font-semibold">
                  Or Join Existing
                </span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>

              <div className="space-y-2.5">
                <input
                  type="text"
                  placeholder="Enter Room Code"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-center text-white placeholder-slate-500 uppercase tracking-widest font-mono text-base font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleJoinRoom}
                  disabled={!joinCodeInput.trim()}
                  className="w-full py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold rounded-xl text-sm transition border border-slate-700"
                >
                  Request to Join Room
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 3: ACTIVE GAME
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-between p-4 sm:p-6 selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="w-full max-w-xl flex items-center justify-between py-2 border-b border-slate-800/80 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center font-bold text-indigo-400">
            W
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              WordBridge
            </h1>
            <span className="text-[11px] text-slate-400">
              {gameType === "daily"
                ? "Daily Global Challenge"
                : gameType === "peer"
                ? `1v1 Match • Room ${roomCode}`
                : "Solo Challenge"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border border-slate-800 px-3 py-1 rounded-xl text-right">
            <span className="text-[9px] uppercase font-bold text-slate-400 block tracking-wider">
              Score Potential
            </span>
            <span className="font-mono text-sm font-extrabold text-amber-400">
              {currentLiveScore.toLocaleString()}
            </span>
          </div>

          <button
            onClick={() => setView("home")}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl transition border border-slate-700/60"
          >
            Menu
          </button>
        </div>
      </header>

      {/* Main Game Container */}
      <main className="w-full max-w-xl flex-1 flex flex-col justify-between bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl relative overflow-hidden">
        {loadingPair || !targetPair ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[380px] space-y-3">
            <div className="w-10 h-10 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
            <p className="text-sm text-slate-400 font-medium animate-pulse">
              Generating semantic bridge & verifying distance...
            </p>
          </div>
        ) : (
          <>
            {/* FEATURE 2: FOG OF WAR OPPONENT BAR */}
            {gameType === "peer" && opponent && (
              <div className="mb-4 p-3 bg-indigo-950/30 border border-indigo-500/30 rounded-2xl text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="font-bold text-slate-200">Opponent: {opponent.name}</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Step {opponent.steps.length} {opponent.hasWon ? "🏁 Finished!" : ""}
                  </span>
                </div>

                {/* Fog of war masked tiles */}
                <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                  {opponent.steps.map((st, i) => (
                    <span
                      key={i}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition ${
                        st.relatedness >= 85
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                          : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                      }`}
                      title={hasWon || opponentWon ? st.word : "Word hidden until game finishes"}
                    >
                      {hasWon || opponentWon && st.word
                        ? st.word
                        : `Step ${i + 1} (${st.relatedness}%)`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Goal Indicator Card */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-2xl p-4 mb-3 shadow-inner">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2 font-medium">
                <span className="flex items-center gap-1.5 font-bold tracking-wider text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                  CHALLENGE
                </span>
                <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[10px] font-semibold">
                  {targetPair.difficulty} ({targetPair.baselineScore}% Baseline)
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                {/* Start Word */}
                <div className="flex-1 bg-slate-800/80 border border-slate-700/80 rounded-xl p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-0.5">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Start</span>
                    <button
                      type="button"
                      onClick={() => handleToggleDefinition(targetPair.source)}
                      className={`text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold transition border ${
                        activeDefinition?.word === targetPair.source.toLowerCase()
                          ? "bg-indigo-500 text-white border-indigo-400 shadow-sm shadow-indigo-500/50"
                          : "text-slate-400 hover:text-indigo-300 border-slate-600 hover:border-indigo-400/60 bg-slate-800/80"
                      }`}
                      title={`View definition of "${targetPair.source}"`}
                      aria-label={`View definition of ${targetPair.source}`}
                    >
                      ?
                    </button>
                  </div>
                  <span
                    onClick={() => handleToggleDefinition(targetPair.source)}
                    className="text-lg sm:text-xl font-extrabold text-indigo-300 capitalize tracking-wide cursor-pointer hover:underline decoration-indigo-400/40 underline-offset-4 transition"
                    title={`Click for definition of "${targetPair.source}"`}
                  >
                    {targetPair.source}
                  </span>
                </div>

                <div className="flex flex-col items-center justify-center text-slate-500">
                  <svg className="w-5 h-5 text-indigo-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <span className="text-[9px] font-semibold text-indigo-400/80 mt-0.5">&gt;= 70%</span>
                </div>

                {/* Target Word */}
                <div className="flex-1 bg-slate-800/80 border border-slate-700/80 rounded-xl p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-0.5">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Target</span>
                    <button
                      type="button"
                      onClick={() => handleToggleDefinition(targetPair.target)}
                      className={`text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold transition border ${
                        activeDefinition?.word === targetPair.target.toLowerCase()
                          ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm shadow-emerald-500/50"
                          : "text-slate-400 hover:text-emerald-300 border-slate-600 hover:border-emerald-400/60 bg-slate-800/80"
                      }`}
                      title={`View definition of "${targetPair.target}"`}
                      aria-label={`View definition of ${targetPair.target}`}
                    >
                      ?
                    </button>
                  </div>
                  <span
                    onClick={() => handleToggleDefinition(targetPair.target)}
                    className="text-lg sm:text-xl font-extrabold text-emerald-300 capitalize tracking-wide cursor-pointer hover:underline decoration-emerald-400/40 underline-offset-4 transition"
                    title={`Click for definition of "${targetPair.target}"`}
                  >
                    {targetPair.target}
                  </span>
                </div>
              </div>

              {/* Word Definition Drawer */}
              {activeDefinition && (
                <div className="mt-3 p-3 bg-slate-950/90 border border-indigo-500/30 rounded-xl text-left shadow-lg">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white capitalize text-sm">
                        {activeDefinition.word}
                      </span>
                      {activeDefinition.partOfSpeech && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-mono italic">
                          {activeDefinition.partOfSpeech}
                        </span>
                      )}
                      {activeDefinition.loading && (
                        <span className="w-2.5 h-2.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveDefinition(null)}
                      className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-slate-800 transition"
                      aria-label="Close definition"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    {activeDefinition.definition}
                  </p>
                </div>
              )}
            </div>

            {/* FEATURE 1: SEMANTIC COMPASS / HEATMAP BAR */}
            <div className="mb-3 px-4 py-2 bg-slate-800/40 border border-slate-700/50 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-sm">🧭</span>
                <span className="text-slate-400 font-medium">Target Proximity:</span>
                <span className="font-mono font-bold text-white">{targetProximity}%</span>
              </div>

              <div className="flex items-center gap-2">
                {proximityDelta === "hotter" && (
                  <span className="text-amber-400 font-bold flex items-center gap-1 animate-pulse">
                    <span>🔥</span> Heating Up!
                  </span>
                )}
                {proximityDelta === "colder" && (
                  <span className="text-cyan-400 font-bold flex items-center gap-1 animate-pulse">
                    <span>❄️</span> Getting Colder
                  </span>
                )}

                {/* Visual heat gauge */}
                <div className="w-20 bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      targetProximity >= 60
                        ? "bg-emerald-400"
                        : targetProximity >= 35
                        ? "bg-amber-400"
                        : "bg-indigo-400"
                    }`}
                    style={{ width: `${Math.min(100, targetProximity)}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Path History Chain */}
            <div className="flex-1 min-h-[170px] max-h-[220px] overflow-y-auto pr-1 space-y-2 mb-3" ref={scrollRef}>
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                <span>Your Chain ({history.length} {history.length === 1 ? "word" : "words"})</span>
                <span>Missed Attempts: <b className="text-rose-400">{failedAttempts}</b></span>
              </div>

              {history.map((step, idx) => {
                const isStart = idx === 0;
                const isTarget = step.word.toLowerCase() === targetWord.toLowerCase();
                return (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                          isStart
                            ? "bg-indigo-500 text-white"
                            : isTarget
                            ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40"
                            : "bg-slate-800 text-slate-300 border border-slate-700"
                        }`}
                      >
                        {idx + 1}
                      </div>
                    </div>

                    <div
                      className={`flex-1 flex items-center justify-between px-4 py-2 rounded-xl border transition ${
                        isTarget
                          ? "bg-emerald-950/40 border-emerald-500/50 shadow-md shadow-emerald-950/50"
                          : isStart
                          ? "bg-indigo-950/30 border-indigo-500/30"
                          : "bg-slate-800/60 border-slate-700/50"
                      }`}
                    >
                      <span className="font-semibold text-base capitalize tracking-wide text-white">
                        {step.word}
                      </span>

                      {!isStart && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-400 text-[11px]">Related:</span>
                          <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                            {step.relatednessToPrevious}%
                          </span>
                        </div>
                      )}
                      {isStart && (
                        <span className="text-xs text-indigo-400 font-medium px-2 py-0.5 rounded-md bg-indigo-500/10">
                          Origin
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Feedback / Error Message Box */}
            {feedback && (
              <div
                className={`p-3 mb-3 rounded-xl text-xs font-medium border flex items-start justify-between gap-3 animate-in fade-in duration-200 ${
                  feedback.type === "success"
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-200"
                    : feedback.type === "error"
                    ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                    : "bg-indigo-500/15 border-indigo-500/30 text-indigo-200"
                }`}
              >
                <span>{feedback.message}</span>
                {feedback.score !== undefined && (
                  <span className="font-mono font-bold px-2 py-0.5 rounded bg-black/30 shrink-0">
                    {feedback.score}%
                  </span>
                )}
              </div>
            )}

            {/* Victory / Defeat Screen & Reveal Comparison */}
            {(hasWon || opponentWon) && (
              <div className="p-5 bg-gradient-to-br from-emerald-950/70 via-slate-900 to-indigo-950/60 border border-emerald-500/40 rounded-2xl text-center space-y-4 animate-in zoom-in-95 duration-300 mb-2">
                <div className="flex items-center justify-center gap-3">
                  <span className="text-4xl font-black bg-gradient-to-br from-amber-300 to-amber-500 bg-clip-text text-transparent px-3 py-1 bg-amber-500/10 rounded-2xl border border-amber-500/30">
                    {hasWon ? (opponentWon ? "2nd" : "WINNER") : "2nd"}
                  </span>
                  <div className="text-left">
                    <span className="text-xs uppercase tracking-wider text-slate-400 font-bold block">
                      {hasWon ? "Victory!" : "Opponent Finished First!"}
                    </span>
                    <span className="text-2xl font-black text-white">
                      {finalScore ? `${finalScore.totalScore.toLocaleString()} pts` : "Game Over"}
                    </span>
                  </div>
                </div>

                {/* FEATURE 2: SIDE-BY-SIDE PATHWAY REVEAL IN MULTIPLAYER */}
                {gameType === "peer" && opponent?.finalHistory && (
                  <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60 text-xs text-left space-y-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                      Paths Revealed (Side-by-Side)
                    </span>
                    <div className="space-y-1">
                      <div className="truncate">
                        <span className="text-indigo-400 font-bold">You: </span>
                        <span className="text-slate-200">{history.map((s) => s.word).join(" ➔ ")}</span>
                      </div>
                      <div className="truncate">
                        <span className="text-amber-400 font-bold">Opponent: </span>
                        <span className="text-slate-200">{opponent.finalHistory.join(" ➔ ")}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* FEATURE 3: GLOBAL PATH BENCHMARK ON DAILY CHALLENGE */}
                {gameType === "daily" && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs space-y-1 text-left">
                    <span className="text-amber-400 font-bold block">🏆 Daily Global Benchmark</span>
                    <p className="text-slate-300">
                      You solved today’s challenge in <b>{history.length - 1} steps</b>! Today’s par record is <b>4 steps</b>.
                    </p>
                  </div>
                )}

                {finalScore && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-slate-800/60 border border-slate-700/60 p-2 rounded-xl">
                      <span className="text-[10px] text-slate-400 block">Baseline Bonus</span>
                      <span className="font-bold text-indigo-300">+{finalScore.difficultyBonus}</span>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700/60 p-2 rounded-xl">
                      <span className="text-[10px] text-slate-400 block">Efficiency</span>
                      <span className="font-bold text-emerald-300">+{finalScore.stepEfficiency}</span>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700/60 p-2 rounded-xl">
                      <span className="text-[10px] text-slate-400 block">Avg Cohesion</span>
                      <span className="font-bold text-cyan-300">{finalScore.averageSimilarity}%</span>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700/60 p-2 rounded-xl">
                      <span className="text-[10px] text-slate-400 block">Miss Penalties</span>
                      <span className="font-bold text-rose-400">-{finalScore.missPenalty}</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={copyShareText}
                    className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-100 font-semibold rounded-xl text-sm transition border border-slate-700/70 flex items-center justify-center gap-2"
                  >
                    {copied ? "Copied! 🎉" : "Share"}
                  </button>

                  <button
                    onClick={() => (gameType === "peer" ? setView("home") : initGame(gameType))}
                    className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-sm transition shadow-lg shadow-emerald-500/20"
                  >
                    {gameType === "peer" ? "Main Menu" : "Play Next"}
                  </button>
                </div>
              </div>
            )}

            {/* Input Form for Next Step */}
            {!hasWon && !opponentWon && (
              <form onSubmit={handleStepSubmit} className="space-y-2.5">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder={`Step from "${currentWord}"...`}
                      value={nextWord}
                      onChange={handleInputChange}
                      disabled={loading}
                      autoFocus
                      className="w-full px-4 py-3 bg-slate-800/90 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm sm:text-base font-medium disabled:opacity-50 transition"
                    />
                    <span className="absolute right-3 top-3 text-[10px] text-slate-500 hidden sm:block">
                      A-Z only
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="py-3 px-6 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded-xl text-sm transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 disabled:shadow-none shrink-0"
                  >
                    {loading ? "Evaluating..." : "Submit Word"}
                  </button>
                </div>

                <div className="flex justify-between items-center text-[11px] text-slate-500 px-1">
                  <span>Rule: Must be &gt;= 70% related to <b>"{currentWord}"</b></span>
                  {nextWord.length === 1 ? (
                    <span className="text-slate-400">Min 2 letters</span>
                  ) : isDuplicate ? (
                    <span className="text-rose-400 font-medium">Already used in chain</span>
                  ) : (
                    <span>Real-time semantic check</span>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500 py-2">
        WordBridge • Real-time Word Association
      </footer>
    </div>
  );
}
