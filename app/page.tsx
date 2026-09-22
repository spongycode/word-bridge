"use client";

import { useState, useEffect, useRef } from "react";
import { WordPair } from "./domains";
import { calculateGameScore, ScoreBreakdown } from "./lib/scoring";
import { getAblyRealtime } from "./lib/ably";

interface StepRecord {
  word: string;
  relatednessToPrevious: number;
  scoreVal: number;
}

interface OpponentState {
  clientId: string;
  name: string;
  stepCount: number;
  latestWord: string;
  relatedness: number;
  hasWon: boolean;
}

export default function GamePage() {
  // Navigation: "home" | "solo" | "peer_lobby" | "peer_game"
  const [mode, setMode] = useState<"home" | "solo" | "peer_lobby" | "peer_game">("home");

  // Game state
  const [targetPair, setTargetPair] = useState<WordPair | null>(null);
  const [history, setHistory] = useState<StepRecord[]>([]);
  const [nextWord, setNextWord] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPair, setLoadingPair] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [copied, setCopied] = useState(false);

  // Peer Multiplayer State
  const [myClientId, setMyClientId] = useState<string>("");
  const [roomCode, setRoomCode] = useState<string>("");
  const [joinCodeInput, setJoinCodeInput] = useState<string>("");
  const [isHost, setIsHost] = useState(false);
  const [lobbyStatus, setLobbyStatus] = useState<string>("idle"); // "hosting" | "joining"
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

  // Generate unique client ID on mount
  useEffect(() => {
    const id = `player_${Math.random().toString(36).substring(2, 7)}`;
    setMyClientId(id);
  }, []);

  // Solo Start
  const startSoloGame = async () => {
    setMode("solo");
    setLoadingPair(true);
    setFeedback(null);
    setHasWon(false);
    setOpponentWon(false);
    setFinalScore(null);
    setFailedAttempts(0);
    setNextWord("");
    setCopied(false);

    try {
      const res = await fetch("/api/pair");
      const pair: WordPair = await res.json();
      setTargetPair(pair);
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

  // Peer: Host a Room
  const handleHostRoom = async () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomCode(code);
    setIsHost(true);
    setLobbyStatus("hosting");
    setMode("peer_lobby");
    setPendingGuest(null);

    // Fetch the challenge pair upfront so both play the exact same pair
    const res = await fetch("/api/pair");
    const pair: WordPair = await res.json();
    setTargetPair(pair);

    // Subscribe to room channel
    const ably = getAblyRealtime(myClientId);
    const channel = ably.channels.get(`game:room_${code}`);
    ablyChannelRef.current = channel;

    channel.subscribe("join_request", (msg: any) => {
      // Guest wants to join!
      setPendingGuest({
        clientId: msg.data.clientId,
        name: msg.data.name || "Opponent",
      });
    });

    channel.subscribe("peer_step", (msg: any) => {
      if (msg.data.clientId !== myClientId) {
        setOpponent({
          clientId: msg.data.clientId,
          name: msg.data.name || "Opponent",
          stepCount: msg.data.stepCount,
          latestWord: msg.data.latestWord,
          relatedness: msg.data.relatedness,
          hasWon: msg.data.hasWon,
        });

        if (msg.data.hasWon) {
          setOpponentWon(true);
        }
      }
    });
  };

  // Peer Host: Accept Pending Guest
  const handleAcceptGuest = () => {
    if (!pendingGuest || !ablyChannelRef.current || !targetPair) return;

    // Broadcast room accepted with initial challenge pair
    ablyChannelRef.current.publish("join_accepted", {
      targetPair,
      hostId: myClientId,
      guestId: pendingGuest.clientId,
    });

    setOpponent({
      clientId: pendingGuest.clientId,
      name: pendingGuest.name,
      stepCount: 1,
      latestWord: targetPair.source,
      relatedness: 100,
      hasWon: false,
    });

    setHistory([
      {
        word: targetPair.source,
        relatednessToPrevious: 100,
        scoreVal: 3.0,
      },
    ]);

    setMode("peer_game");
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  // Peer Guest: Join Room
  const handleJoinRoom = () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;

    setRoomCode(code);
    setIsHost(false);
    setLobbyStatus("joining");
    setMode("peer_lobby");

    const ably = getAblyRealtime(myClientId);
    const channel = ably.channels.get(`game:room_${code}`);
    ablyChannelRef.current = channel;

    // Send request to host
    channel.publish("join_request", {
      clientId: myClientId,
      name: "Peer Player",
    });

    // Listen for host accept
    channel.subscribe("join_accepted", (msg: any) => {
      const pair: WordPair = msg.data.targetPair;
      setTargetPair(pair);
      setOpponent({
        clientId: msg.data.hostId,
        name: "Host Player",
        stepCount: 1,
        latestWord: pair.source,
        relatedness: 100,
        hasWon: false,
      });

      setHistory([
        {
          word: pair.source,
          relatednessToPrevious: 100,
          scoreVal: 3.0,
        },
      ]);

      setMode("peer_game");
      setTimeout(() => inputRef.current?.focus(), 150);
    });

    channel.subscribe("peer_step", (msg: any) => {
      if (msg.data.clientId !== myClientId) {
        setOpponent({
          clientId: msg.data.clientId,
          name: msg.data.name || "Opponent",
          stepCount: msg.data.stepCount,
          latestWord: msg.data.latestWord,
          relatedness: msg.data.relatedness,
          hasWon: msg.data.hasWon,
        });

        if (msg.data.hasWon) {
          setOpponentWon(true);
        }
      }
    });
  };

  const currentWord = history.length > 0 ? history[history.length - 1].word : "";
  const targetWord = targetPair?.target || "";

  // Auto-scroll history container
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  // Input filter: only letters
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = e.target.value.replace(/[^a-zA-Z]/g, "");
    setNextWord(sanitized);
    if (feedback?.type === "error") {
      setFeedback(null);
    }
  };

  const candidateLower = nextWord.trim().toLowerCase();
  const isDuplicate = history.some((s) => s.word.toLowerCase() === candidateLower);
  const isSameAsCurrent = candidateLower === currentWord.toLowerCase();
  const canSubmit = candidateLower.length >= 2 && !isDuplicate && !isSameAsCurrent && !loading;

  // Live score potential
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
      // Evaluate candidate similarity
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word1: currentWord, word2: candidateLower }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Evaluation failed");

      const noulProbability = data?.answers?.are_related?.noul ?? 0;
      const scoreVal = data?.answers?.similarity_score?.score ?? 0;
      const pct = Math.round(noulProbability * 100);

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

      // Step accepted
      const newHistory: StepRecord[] = [
        ...history,
        {
          word: candidateLower,
          relatednessToPrevious: pct,
          scoreVal,
        },
      ];
      setHistory(newHistory);
      setNextWord("");

      // Publish progress to Peer if in multiplayer
      if (mode === "peer_game" && ablyChannelRef.current) {
        ablyChannelRef.current.publish("peer_step", {
          clientId: myClientId,
          name: isHost ? "Host" : "Guest",
          stepCount: newHistory.length,
          latestWord: candidateLower,
          relatedness: pct,
          hasWon: false,
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

        // Broadcast victory to peer
        if (mode === "peer_game" && ablyChannelRef.current) {
          ablyChannelRef.current.publish("peer_step", {
            clientId: myClientId,
            name: isHost ? "Host" : "Guest",
            stepCount: finalSteps.length,
            latestWord: targetWord,
            relatedness: 100,
            hasWon: true,
          });
        }
      };

      // Direct target hit
      if (candidateLower === targetWord.toLowerCase()) {
        finalizeVictory(newHistory);
        setFeedback({
          type: "success",
          message: `🎉 Incredible! You reached "${targetWord}" in ${newHistory.length - 1} steps!`,
          score: pct,
        });
        setLoading(false);
        return;
      }

      // Proximity check to target word
      const targetRes = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word1: candidateLower, word2: targetWord }),
      });
      const targetData = await targetRes.json();
      const targetPct = Math.round((targetData?.answers?.are_related?.noul ?? 0) * 100);

      if (targetPct >= 70) {
        const finalHistory: StepRecord[] = [
          ...newHistory,
          {
            word: targetWord,
            relatednessToPrevious: targetPct,
            scoreVal: targetData?.answers?.similarity_score?.score ?? 3.0,
          },
        ];
        setHistory(finalHistory);
        finalizeVictory(finalHistory);
        setFeedback({
          type: "success",
          message: `🎉 Connection Complete! "${candidateLower}" connected to "${targetWord}" (${targetPct}% related)!`,
          score: targetPct,
        });
      } else {
        setFeedback({
          type: "info",
          message: `Step accepted (${pct}% to "${currentWord}"). Proximity to goal: ${targetPct}%.`,
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
    const shareText = `🧩 WordBridge
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
  // VIEW 1: HOME PAGE (SOLO vs PEER)
  // ==========================================
  if (mode === "home") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
        <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            Semantic Association Game
          </div>

          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              WordBridge
            </h1>
            <p className="text-sm text-slate-400 mt-2">
              Bridge distant concepts step-by-step using semantic relatedness (&ge; 70%).
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={startSoloGame}
              className="w-full py-4 px-5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold rounded-2xl transition duration-150 flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/25 text-base"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>Play Solo</span>
            </button>

            <button
              onClick={() => setMode("peer_lobby")}
              className="w-full py-4 px-5 bg-slate-800/90 hover:bg-slate-700 active:bg-slate-800 text-slate-200 font-bold rounded-2xl transition duration-150 border border-slate-700 flex items-center justify-center gap-3 text-base"
            >
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span>Peer 1v1 Race (Realtime)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: PEER LOBBY (HOST / JOIN / ACCEPT)
  // ==========================================
  if (mode === "peer_lobby") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
        <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-3xl p-7 shadow-2xl space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>👥</span> Realtime 1v1 Peer Match
            </h2>
            <button
              onClick={() => setMode("home")}
              className="text-xs text-slate-400 hover:text-white transition"
            >
              Back
            </button>
          </div>

          {lobbyStatus === "hosting" ? (
            /* HOST WAITING FOR PEER ACCEPTANCE */
            <div className="space-y-5 text-center">
              <div className="p-4 bg-indigo-950/40 border border-indigo-500/30 rounded-2xl space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold block">
                  Your Room Code
                </span>
                <span className="text-3xl font-black text-indigo-300 font-mono tracking-widest">
                  {roomCode}
                </span>
                <span className="text-[11px] text-slate-400 block pt-1">
                  Share this code with your friend
                </span>
              </div>

              {pendingGuest ? (
                <div className="p-4 bg-emerald-950/50 border border-emerald-500/40 rounded-2xl text-left space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-emerald-400 font-bold block">
                        Player Waiting to Join!
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {pendingGuest.name} ({pendingGuest.clientId})
                      </span>
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
                  <p className="text-xs text-slate-400 font-medium">
                    Waiting for peer to enter room code...
                  </p>
                </div>
              )}
            </div>
          ) : lobbyStatus === "joining" ? (
            /* GUEST WAITING FOR HOST ACCEPTANCE */
            <div className="space-y-4 text-center py-4">
              <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin mx-auto"></div>
              <div>
                <h3 className="text-base font-bold text-white">Connected to Room {roomCode}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Waiting for host to accept your request...
                </p>
              </div>
            </div>
          ) : (
            /* LOBBY MENU: CREATE OR JOIN */
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
                  placeholder="Enter 4-letter Room Code"
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
  // VIEW 3: ACTIVE GAME (SOLO or PEER RACE)
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
              {mode === "peer_game" ? `1v1 Match • Room ${roomCode}` : "Solo Challenge"}
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
            onClick={() => setMode("home")}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl transition border border-slate-700/60"
          >
            Exit
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
            {/* OPPONENT LIVE STATUS CARD (PEER MODE ONLY) */}
            {mode === "peer_game" && opponent && (
              <div className="mb-4 p-3 bg-indigo-950/30 border border-indigo-500/30 rounded-2xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="font-bold text-slate-200">Opponent: {opponent.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Step {opponent.stepCount}:</span>
                  <span className="font-semibold text-indigo-300 capitalize">"{opponent.latestWord}"</span>
                  {opponent.hasWon && (
                    <span className="text-rose-400 font-bold ml-1">Finished! 🏁</span>
                  )}
                </div>
              </div>
            )}

            {/* Goal Indicator Card */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-2xl p-4 mb-4 shadow-inner">
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
                <div className="flex-1 bg-slate-800/80 border border-slate-700/80 rounded-xl p-3 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">Start</span>
                  <span className="text-lg sm:text-xl font-extrabold text-indigo-300 capitalize tracking-wide">
                    {targetPair.source}
                  </span>
                </div>

                <div className="flex flex-col items-center justify-center text-slate-500">
                  <svg className="w-5 h-5 text-indigo-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <span className="text-[9px] font-semibold text-indigo-400/80 mt-0.5">&gt;= 70%</span>
                </div>

                <div className="flex-1 bg-slate-800/80 border border-slate-700/80 rounded-xl p-3 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">Target</span>
                  <span className="text-lg sm:text-xl font-extrabold text-emerald-300 capitalize tracking-wide">
                    {targetPair.target}
                  </span>
                </div>
              </div>
            </div>

            {/* Path History Chain */}
            <div className="flex-1 min-h-[190px] max-h-[250px] overflow-y-auto pr-1 space-y-2 mb-3" ref={scrollRef}>
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

            {/* Victory / Defeat Screen */}
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
                    onClick={() => (mode === "peer_game" ? setMode("home") : startSoloGame())}
                    className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-sm transition shadow-lg shadow-emerald-500/20"
                  >
                    {mode === "peer_game" ? "Main Menu" : "Play Next"}
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
                  <span>
                    Rule: Must be &gt;= 70% related to <b>"{currentWord}"</b>
                  </span>
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
