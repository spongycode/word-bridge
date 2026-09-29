"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { WordPair } from "./domains";
import { calculateGameScore, ScoreBreakdown } from "./lib/scoring";
import { connectAbly, closeAblyRealtime, identityOf } from "./lib/ably";
import { loadMatchHistory, recordMatch, patchOpponentPath, clearAllMatches } from "./lib/matchHistory";
import { fetchWordDefinition } from "./lib/dictionary";
import { useAuthUser } from "./lib/supabase/useAuthUser";
import type { User } from "@supabase/supabase-js";
import {
  getOrCreateGuestName,
  saveGuestName,
  saveActiveGameSession,
  getActiveGameSession,
  clearActiveGameSession,
  MatchHistoryItem,
  ActiveGameSession,
  OpponentState,
  StepRecord,
} from "./lib/player";
import { useProfile } from "./lib/supabase/profile";
import type { DailyRunState } from "./lib/dailyRun";
import PlayerIdentity from "./components/PlayerIdentity";
import DailyLeaderboard from "./components/DailyLeaderboard";

const STEP_THRESHOLD = 70;

export default function GamePage() {
  // Navigation: "home" | "lobby" | "playing"
  const { user, authLoading, authEnabled, signInWithGoogle, signOut } = useAuthUser();
  const { profile, updateUsername } = useProfile(user);
  const [authError, setAuthError] = useState(false);
  const [gameType, setGameType] = useState<"solo" | "daily" | "peer">("solo");
  const [view, setView] = useState<"home" | "lobby" | "playing" | "leaderboard">("home");
  // Ranked daily = signed-in run validated and stored by the server (one attempt per day)
  const [dailyRanked, setDailyRanked] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  // Game state
  const [targetPair, setTargetPair] = useState<WordPair | null>(null);
  const [history, setHistory] = useState<StepRecord[]>([]);
  const [nextWord, setNextWord] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingPair, setLoadingPair] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Feature 1: Semantic Compass (Heatmap / Proximity)
  const [targetProximity, setTargetProximity] = useState<number>(0);
  const [proximityDelta, setProximityDelta] = useState<"hotter" | "colder" | null>(null);

  // Feature 2: Fog of War Peer Multiplayer
  const [guestName, setGuestName] = useState<string>("Guest");
  // Signed-in players always use their unique profile username
  const username = profile?.username ?? guestName;
  const [activeSavedGame, setActiveSavedGame] = useState<ActiveGameSession | null>(null);
  const [matchHistory, setMatchHistory] = useState<MatchHistoryItem[]>([]);
  const [lobbyTab, setLobbyTab] = useState<"lobby" | "history">("lobby");
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState<string>("");
  const [joinCodeInput, setJoinCodeInput] = useState<string>("");
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [lobbyStatus, setLobbyStatus] = useState<string>("idle");
  const [pendingGuest, setPendingGuest] = useState<{ clientId: string; name: string } | null>(null);
  const [opponent, setOpponent] = useState<OpponentState | null>(null);

  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error";
    message: string;
    score?: number;
    threshold?: number;
  } | null>(null);

  const [hasWon, setHasWon] = useState(false);
  const [opponentWon, setOpponentWon] = useState(false);
  // Who reached the target first in a 1v1 round (decided by channel message order)
  const [raceWinner, setRaceWinner] = useState<"me" | "opponent" | null>(null);
  const [finalScore, setFinalScore] = useState<ScoreBreakdown | null>(null);

  // Feature 2b: Peer Rematch
  const [rematchState, setRematchState] = useState<"idle" | "requested" | "starting">("idle");

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ablyChannelRef = useRef<any>(null);
  const defCacheRef = useRef<Record<string, { partOfSpeech?: string; definition: string }>>({});
  // Rematch refs (mutable so channel subscribers never read stale values)
  const isHostRef = useRef(false);
  const rematchRequestedRef = useRef(false);
  const rematchOpponentRef = useRef(false);
  const rematchStartedRef = useRef(false);
  // Mirrors history so channel subscribers can read the latest path at game over
  const historyRef = useRef<StepRecord[]>([]);
  const usernameRef = useRef("Guest");
  const targetPairRef = useRef<WordPair | null>(null);
  const opponentRef = useRef<OpponentState | null>(null);
  const roomCodeRef = useRef("");
  const raceWinnerRef = useRef<"me" | "opponent" | null>(null);
  const roundRef = useRef(0);
  const roundSavedRef = useRef<string | null>(null);
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Server-verified realtime identity for this tab ("<identity>.<tab>"), set once connected
  const myIdRef = useRef("");
  // Random per-room id so match history keys never collide when room codes are reused
  const matchIdRef = useRef("");
  const hasWonRef = useRef(false);
  const opponentWonRef = useRef(false);
  const userRef = useRef<User | null>(null);

  // Word definition tooltip/card state
  const [activeDefinition, setActiveDefinition] = useState<{
    word: string;
    partOfSpeech?: string;
    definition: string;
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    setGuestName(getOrCreateGuestName());

    // Check for an active saved session (match history loads once auth resolves)
    setActiveSavedGame(getActiveGameSession());

    const handleScrollLock = () => {
      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 100);
      }
    };

    window.addEventListener("scroll", handleScrollLock, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleScrollLock);
      window.visualViewport.addEventListener("scroll", handleScrollLock);
    }

    return () => {
      window.removeEventListener("scroll", handleScrollLock);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleScrollLock);
        window.visualViewport.removeEventListener("scroll", handleScrollLock);
      }
    };
  }, []);

  // Deep-link join: ?join=CODE in the URL auto-starts the room join flow
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error")) {
      setAuthError(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const code = params.get("join")?.trim().toUpperCase();
    if (code) setPendingJoinCode(code);
  }, []);

  useEffect(() => {
    if (!pendingJoinCode || authLoading) return;
    window.history.replaceState({}, "", window.location.pathname);
    setJoinCodeInput(pendingJoinCode);
    setPendingJoinCode(null);
    handleJoinRoom(pendingJoinCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJoinCode, authLoading]);

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

  const startHistory = (pair: WordPair) => {
    const initial: StepRecord[] = [{ word: pair.source, relatednessToPrevious: 100, scoreVal: 3.0 }];
    setHistory(initial);
    historyRef.current = initial;
  };

  // Rebuilds local game state from the server-stored ranked daily run
  const applyDailyRun = (run: DailyRunState, pair: WordPair) => {
    const steps: StepRecord[] = run.path.map((word, i) => ({
      word,
      relatednessToPrevious: i === 0 ? 100 : run.stepScores[i - 1],
      scoreVal: 0,
    }));
    setHistory(steps);
    historyRef.current = steps;
    setFailedAttempts(run.failedAttempts);
    if (run.finished) {
      setHasWon(true);
      setFinalScore(
        calculateGameScore({
          baselineScore: pair.baselineScore ?? 15,
          stepCount: steps.length - 1,
          stepSimilarities: run.stepScores,
          failedAttempts: run.failedAttempts,
        })
      );
    }
  };

  // Start Solo / Daily Game
  const initGame = async (type: "solo" | "daily") => {
    leaveChannel();
    setActiveDefinition(null);
    setGameType(type);
    setView("playing");
    setLoadingPair(true);
    setPairError(null);
    setTargetPair(null);
    targetPairRef.current = null;
    setHistory([]);
    setFeedback(null);
    setHasWon(false);
    setOpponentWon(false);
    setFinalScore(null);
    setFailedAttempts(0);
    setNextWord("");
    setCopied(false);
    setOpponent(null);
    opponentRef.current = null;
    setProximityDelta(null);
    setDailyRanked(false);
    resetRace();

    try {
      if (type === "daily") {
        const res = await fetch("/api/daily");
        if (!res.ok) throw new Error("Failed to load the daily challenge");
        const { puzzle, run, ranked }: { puzzle: WordPair; run: DailyRunState | null; ranked: boolean } = await res.json();
        targetPairRef.current = puzzle;
        setTargetPair(puzzle);
        setDailyRanked(ranked);
        if (ranked && run) {
          applyDailyRun(run, puzzle);
          setTargetProximity(run.lastProximity);
        } else {
          startHistory(puzzle);
          setTargetProximity(puzzle.baselineScore ?? 15);
        }
      } else {
        const res = await fetch("/api/pair");
        if (!res.ok) throw new Error("Failed to generate a word pair");
        const pair: WordPair = await res.json();
        targetPairRef.current = pair;
        setTargetPair(pair);
        startHistory(pair);
        setTargetProximity(pair.baselineScore ?? 15);
      }
    } catch (err) {
      console.error("Failed to load pair:", err);
      setPairError("Could not load a puzzle. Check your connection and try again.");
    } finally {
      setLoadingPair(false);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  };

  const handleSaveUsername = async (name: string): Promise<string | null> => {
    if (user) return updateUsername(name);
    const err = saveGuestName(name);
    if (!err) setGuestName(name.trim());
    return err;
  };

  // Keep refs in sync so Ably subscribers never read stale React state
  useEffect(() => {
    usernameRef.current = username;
  }, [username]);
  useEffect(() => {
    targetPairRef.current = targetPair;
  }, [targetPair]);
  useEffect(() => {
    opponentRef.current = opponent;
  }, [opponent]);
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);
  useEffect(() => {
    hasWonRef.current = hasWon;
  }, [hasWon]);
  useEffect(() => {
    opponentWonRef.current = opponentWon;
  }, [opponentWon]);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // A new identity (sign in / sign out) needs a fresh realtime token
  const lastIdentityRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (authLoading) return;
    const identity = user?.id ?? null;
    if (lastIdentityRef.current !== undefined && lastIdentityRef.current !== identity) closeAblyRealtime();
    lastIdentityRef.current = identity;
  }, [user, authLoading]);

  // History comes from Supabase for signed-in players, localStorage for guests
  const refreshMatchHistory = useCallback(async () => {
    setMatchHistory(await loadMatchHistory(userRef.current));
  }, []);
  useEffect(() => {
    if (!authLoading) refreshMatchHistory();
  }, [user, authLoading, refreshMatchHistory]);

  const matchKey = () => `${matchIdRef.current}#${roundRef.current}`;

  // Opponent messages are matched by identity so a reloaded tab (new clientId suffix) is still recognized
  const isOpponent = (clientId: string | undefined) => {
    const opp = opponentRef.current;
    return Boolean(opp && clientId && clientId !== myIdRef.current && identityOf(clientId) === identityOf(opp.clientId));
  };

  const resetRace = () => {
    raceWinnerRef.current = null;
    setRaceWinner(null);
  };

  const ensureRealtime = async (): Promise<string> => {
    const { clientId } = await connectAbly();
    myIdRef.current = clientId;
    return clientId;
  };

  // Unsubscribe and detach from the current room so old rooms can't leak events into new screens
  const leaveChannel = () => {
    if (joinTimeoutRef.current) {
      clearTimeout(joinTimeoutRef.current);
      joinTimeoutRef.current = null;
    }
    const channel = ablyChannelRef.current;
    if (channel) {
      try {
        channel.unsubscribe();
        channel.detach().catch(() => {});
      } catch {}
    }
    ablyChannelRef.current = null;
  };

  // Snapshot the in-progress round so a refresh/crash can resume it
  const persistSession = (overrides: Partial<ActiveGameSession> = {}) => {
    const pair = targetPairRef.current;
    if (!pair || raceWinnerRef.current) return;
    saveActiveGameSession({
      roomCode: roomCodeRef.current,
      isHost: isHostRef.current,
      targetPair: pair,
      history: historyRef.current,
      hasWon: hasWonRef.current,
      opponentWon: opponentWonRef.current,
      opponent: opponentRef.current,
      matchId: matchIdRef.current,
      round: roundRef.current,
      updatedAt: Date.now(),
      ...overrides,
    });
  };

  // Saves exactly one history record per match round
  const recordPeerResult = (result: "won" | "lost", opponentPath?: string[]) => {
    const pair = targetPairRef.current;
    const key = matchKey();
    if (!pair || roundSavedRef.current === key) return;
    roundSavedRef.current = key;
    const opp = opponentRef.current;
    const oppPath = opponentPath ?? opp?.finalHistory;
    clearActiveGameSession();
    setActiveSavedGame(null);
    recordMatch(userRef.current, {
      matchKey: key,
      roomCode: roomCodeRef.current,
      sourceWord: pair.source,
      targetWord: pair.target,
      myUsername: usernameRef.current,
      mySteps: Math.max(0, historyRef.current.length - 1),
      myPath: historyRef.current.map((s) => s.word),
      opponentName: opp?.name || "Opponent",
      opponentSteps: oppPath ? oppPath.length - 1 : undefined,
      opponentPath: oppPath,
      result,
    }).then(refreshMatchHistory);
  };

  const revealMyPath = () => {
    // Loser shares their (possibly incomplete) word list with the winner at game over
    ablyChannelRef.current?.publish("reveal_path", {
      round: roundRef.current,
      finalHistory: historyRef.current.map((s) => s.word),
    });
  };

  // Settles the round once, identically on both clients
  const settleRace = (winner: "me" | "opponent", opponentPath?: string[]) => {
    if (raceWinnerRef.current) return;
    raceWinnerRef.current = winner;
    setRaceWinner(winner);
    if (winner === "me") {
      recordPeerResult("won");
    } else {
      opponentWonRef.current = true;
      setOpponentWon(true);
      revealMyPath();
      recordPeerResult("lost", opponentPath);
    }
  };

  const updateOpponent = (patch: Partial<OpponentState>) => {
    const opp = opponentRef.current;
    if (!opp) return;
    const updated = { ...opp, ...patch };
    opponentRef.current = updated;
    setOpponent(updated);
  };

  // Single set of in-game handlers shared by host, guest, and resumed sessions.
  // msg.clientId is stamped by Ably from the server-issued token, so it can't be spoofed.
  const subscribeGameEvents = (channel: any) => {
    channel.subscribe("peer_step", (msg: any) => {
      const d = msg.data;
      if (d.round !== roundRef.current) return; // stale message from a previous round
      const isMine = msg.clientId === myIdRef.current;
      if (!isMine && !isOpponent(msg.clientId)) return; // ignore anyone who isn't in this match

      if (!isMine) {
        const opp = opponentRef.current!;
        updateOpponent({
          clientId: msg.clientId,
          name: d.name || opp.name,
          steps: [...opp.steps, { step: d.step, relatedness: d.relatedness }],
          hasWon: d.hasWon,
          finalHistory: d.finalHistory ?? opp.finalHistory,
        });
        if (d.hasWon) {
          opponentWonRef.current = true;
          setOpponentWon(true);
        }
        persistSession();
      }

      // Ably delivers channel messages in the same order to everyone (including our own echo),
      // so the first win message seen decides the race identically on both clients.
      if (d.hasWon) settleRace(isMine ? "me" : "opponent", isMine ? undefined : d.finalHistory);
    });

    channel.subscribe("reveal_path", (msg: any) => {
      const d = msg.data;
      if (d.round !== roundRef.current || !isOpponent(msg.clientId)) return;
      updateOpponent({ finalHistory: d.finalHistory });
      patchOpponentPath(userRef.current, matchKey(), d.finalHistory).then(refreshMatchHistory);
    });

    // Reconnect recovery: a returning player asks for the opponent's current round state
    channel.subscribe("state_request", (msg: any) => {
      if (msg.data.round !== roundRef.current || !isOpponent(msg.clientId)) return;
      updateOpponent({ clientId: msg.clientId });
      const opp = opponentRef.current;
      const winner = raceWinnerRef.current;
      channel.publish("state_sync", {
        round: roundRef.current,
        name: usernameRef.current,
        steps: historyRef.current.slice(1).map((s, i) => ({ step: i + 1, relatedness: s.relatednessToPrevious })),
        hasWon: hasWonRef.current,
        finalHistory: winner || hasWonRef.current ? historyRef.current.map((s) => s.word) : undefined,
        raceWinnerId: winner === "me" ? myIdRef.current : winner === "opponent" ? opp?.clientId : null,
      });
    });

    channel.subscribe("state_sync", (msg: any) => {
      const d = msg.data;
      if (d.round !== roundRef.current || !isOpponent(msg.clientId)) return;
      updateOpponent({
        clientId: msg.clientId,
        name: d.name || opponentRef.current?.name,
        steps: d.steps,
        hasWon: d.hasWon,
        finalHistory: d.finalHistory ?? opponentRef.current?.finalHistory,
      });
      if (d.hasWon) {
        opponentWonRef.current = true;
        setOpponentWon(true);
      }
      if (d.raceWinnerId) {
        settleRace(identityOf(d.raceWinnerId) === identityOf(myIdRef.current) ? "me" : "opponent", d.finalHistory);
      }
      persistSession();
    });

    // Peer rematch handshake (identical on host + challenger side)
    channel.subscribe("rematch_request", (msg: any) => {
      if (!isOpponent(msg.clientId)) return;
      rematchOpponentRef.current = true;
      maybeStartRematch();
    });

    channel.subscribe("rematch_cancel", (msg: any) => {
      if (!isOpponent(msg.clientId)) return;
      rematchOpponentRef.current = false;
    });

    channel.subscribe("rematch_start", (msg: any) => {
      // Only the host (our opponent, from the challenger's side) may start a new round
      if (isHostRef.current || !isOpponent(msg.clientId)) return;
      startRematchRound(msg.data.targetPair as WordPair, msg.data.round);
    });
  };

  // Common state reset when a 1v1 round begins
  const beginPeerRound = (pair: WordPair, opp: OpponentState) => {
    setActiveDefinition(null);
    targetPairRef.current = pair;
    setTargetPair(pair);
    setTargetProximity(pair.baselineScore ?? 15);
    opponentRef.current = opp;
    setOpponent(opp);
    const initialHistory: StepRecord[] = [{ word: pair.source, relatednessToPrevious: 100, scoreVal: 3.0 }];
    setHistory(initialHistory);
    historyRef.current = initialHistory;
    setNextWord("");
    setFeedback(null);
    hasWonRef.current = false;
    setHasWon(false);
    opponentWonRef.current = false;
    setOpponentWon(false);
    setFinalScore(null);
    setFailedAttempts(0);
    setCopied(false);
    setProximityDelta(null);
    resetRace();

    persistSession({ history: initialHistory, hasWon: false, opponentWon: false, opponent: opp });
    setActiveSavedGame(getActiveGameSession());

    setGameType("peer");
    setView("playing");
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handleResumeSavedGame = async () => {
    const session = activeSavedGame || getActiveGameSession();
    if (!session) return;
    leaveChannel();
    setActiveDefinition(null);
    setRoomCode(session.roomCode);
    roomCodeRef.current = session.roomCode;
    matchIdRef.current = session.matchId;
    roundRef.current = session.round;
    setIsHost(session.isHost);
    isHostRef.current = session.isHost;
    targetPairRef.current = session.targetPair;
    setTargetPair(session.targetPair);
    setTargetProximity(session.targetPair.baselineScore ?? 15);
    setHistory(session.history);
    historyRef.current = session.history;
    opponentRef.current = session.opponent;
    setOpponent(session.opponent);
    hasWonRef.current = session.hasWon;
    setHasWon(session.hasWon);
    opponentWonRef.current = session.opponentWon;
    setOpponentWon(session.opponentWon);
    setFeedback(null);
    resetRace();
    setGameType("peer");
    setView("playing");

    try {
      const { ably } = await connectAbly();
      myIdRef.current = ably.auth.clientId;
      const channel = ably.channels.get(`game:room_${session.roomCode}`);
      ablyChannelRef.current = channel;
      subscribeGameEvents(channel);
      // Ask the opponent what happened while we were away
      channel.publish("state_request", { round: roundRef.current });
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Could not reconnect to the match." });
    }

    // Fallback when the opponent is offline: a signed-in winner's stored result settles the round
    fetch(`/api/matches/outcome?key=${encodeURIComponent(matchKey())}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.winner && !raceWinnerRef.current) {
          updateOpponent({ hasWon: true, finalHistory: data.winner.path });
          settleRace("opponent", data.winner.path);
        }
      })
      .catch(() => {});

    setTimeout(() => inputRef.current?.focus(), 150);
  };

  const handleAbandonSavedGame = () => {
    clearActiveGameSession();
    setActiveSavedGame(null);
  };

  // Peer Multiplayer Setup
  const handleHostRoom = async () => {
    leaveChannel();
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomCode(code);
    roomCodeRef.current = code;
    matchIdRef.current = crypto.randomUUID();
    roundRef.current = 0;
    setIsHost(true);
    isHostRef.current = true;
    setLobbyStatus("hosting");
    setView("lobby");
    setPendingGuest(null);
    setFeedback(null);
    opponentRef.current = null;
    setOpponent(null);
    targetPairRef.current = null;
    setTargetPair(null);

    let myId: string;
    try {
      myId = await ensureRealtime();
    } catch (err: any) {
      setLobbyStatus("idle");
      setFeedback({ type: "error", message: err?.message || "Could not connect to multiplayer." });
      return;
    }

    const { ably } = await connectAbly();
    const channel = ably.channels.get(`game:room_${code}`);
    ablyChannelRef.current = channel;

    channel.subscribe("join_request", (msg: any) => {
      const guestId: string | undefined = msg.clientId;
      if (!guestId || guestId === myId) return;
      const reject = (reason: string) => channel.publish("join_rejected", { targetClientId: guestId, reason });

      // Same person (another tab, or the same account on another device) can't play themselves
      if (identityOf(guestId) === identityOf(myId)) return reject("You can't join your own room.");
      // Room is locked once a match has started
      if (opponentRef.current) return reject("This room is already in a match.");

      setPendingGuest({ clientId: guestId, name: msg.data.name || "Challenger" });
    });

    subscribeGameEvents(channel);

    try {
      const res = await fetch("/api/pair");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to generate a word pair");
      targetPairRef.current = body;
      setTargetPair(body);
    } catch (err: any) {
      console.error(err);
      setFeedback({ type: "error", message: err?.message || "Could not generate a word pair. Go back and try again." });
    }
  };

  const handleAcceptGuest = () => {
    const pair = targetPairRef.current;
    if (!pendingGuest || !ablyChannelRef.current || !pair) return;

    ablyChannelRef.current.publish("join_accepted", {
      targetPair: pair,
      hostName: username,
      guestId: pendingGuest.clientId,
      matchId: matchIdRef.current,
    });

    const opp: OpponentState = {
      clientId: pendingGuest.clientId,
      name: pendingGuest.name,
      steps: [],
      hasWon: false,
    };
    setPendingGuest(null);
    beginPeerRound(pair, opp);
  };

  const handleJoinRoom = async (codeArg?: string) => {
    const code = (codeArg ?? joinCodeInput).trim().toUpperCase();
    if (!code) return;

    leaveChannel();
    setRoomCode(code);
    roomCodeRef.current = code;
    roundRef.current = 0;
    setIsHost(false);
    isHostRef.current = false;
    setLobbyStatus("joining");
    setView("lobby");
    setFeedback(null);
    opponentRef.current = null;
    setOpponent(null);

    const failJoin = (message: string) => {
      leaveChannel();
      setLobbyStatus("idle");
      setFeedback({ type: "error", message });
    };

    let myId: string;
    try {
      myId = await ensureRealtime();
    } catch (err: any) {
      failJoin(err?.message || "Could not connect to multiplayer.");
      return;
    }

    const { ably } = await connectAbly();
    const channel = ably.channels.get(`game:room_${code}`);
    ablyChannelRef.current = channel;

    channel.subscribe("join_rejected", (msg: any) => {
      if (msg.data.targetClientId === myId && msg.clientId !== myId) failJoin(msg.data.reason || "Failed to join room.");
    });

    channel.subscribe("join_accepted", (msg: any) => {
      if (msg.data.guestId !== myId || !msg.clientId || msg.clientId === myId) return;
      if (joinTimeoutRef.current) {
        clearTimeout(joinTimeoutRef.current);
        joinTimeoutRef.current = null;
      }
      matchIdRef.current = msg.data.matchId;
      const opp: OpponentState = {
        clientId: msg.clientId, // host identity verified by Ably
        name: msg.data.hostName || "Host",
        steps: [],
        hasWon: false,
      };
      beginPeerRound(msg.data.targetPair as WordPair, opp);
    });

    subscribeGameEvents(channel);

    // Subscribe before publishing so a fast host reply is never missed
    channel.publish("join_request", { name: username });

    // Give up if no host responds (wrong code, or host is offline)
    joinTimeoutRef.current = setTimeout(() => {
      joinTimeoutRef.current = null;
      failJoin(`No response from room ${code}. Check the code or ask the host to share it again.`);
    }, 30000);
  };

  // Feature 2b: Peer Rematch
  const startRematchRound = (pair: WordPair, round: number) => {
    roundRef.current = round;
    const prev = opponentRef.current;
    const opp: OpponentState = { clientId: prev?.clientId ?? "", name: prev?.name ?? "Opponent", steps: [], hasWon: false };
    rematchRequestedRef.current = false;
    rematchOpponentRef.current = false;
    rematchStartedRef.current = false;
    setRematchState("idle");
    beginPeerRound(pair, opp);
  };

  const maybeStartRematch = async () => {
    if (!rematchRequestedRef.current || !rematchOpponentRef.current || rematchStartedRef.current) return;
    rematchStartedRef.current = true;
    if (!isHostRef.current) return; // challenger waits for the host to share a fresh pair

    setRematchState("starting");
    try {
      const res = await fetch("/api/pair");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to generate a word pair");
      const pair: WordPair = body;
      const nextRound = roundRef.current + 1;
      ablyChannelRef.current?.publish("rematch_start", { targetPair: pair, round: nextRound });
      startRematchRound(pair, nextRound);
    } catch (err: any) {
      console.error("Failed to load rematch pair:", err);
      rematchStartedRef.current = false;
      setRematchState("requested");
      setFeedback({ type: "error", message: err?.message || "Failed to start rematch. Please try again." });
    }
  };

  const requestRematch = () => {
    if (!ablyChannelRef.current || rematchStartedRef.current) return;

    // Second tap on the pending button cancels the request
    if (rematchRequestedRef.current) {
      rematchRequestedRef.current = false;
      rematchOpponentRef.current = false;
      setRematchState("idle");
      ablyChannelRef.current.publish("rematch_cancel", {});
      return;
    }

    rematchRequestedRef.current = true;
    setRematchState("requested");
    ablyChannelRef.current.publish("rematch_request", {});
    maybeStartRematch();
  };

  const goHome = () => {
    leaveChannel();
    rematchRequestedRef.current = false;
    rematchOpponentRef.current = false;
    rematchStartedRef.current = false;
    setRematchState("idle");
    setLobbyStatus("idle");
    setPendingGuest(null);
    setFeedback(null);
    setView("home");
  };

  const shareJoinLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?join=${roomCode}`;
    const text = `Join my WordBridge game! Room ${roomCode}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "WordBridge", text, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // user dismissed the native share sheet — nothing to do
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2500);
  };

  const currentWord = history.length > 0 ? history[history.length - 1].word : "";
  const targetWord = targetPair?.target || "";

  const scrollToBottom = useCallback((smooth = false) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom(true);
    const t1 = setTimeout(() => scrollToBottom(false), 50);
    const t2 = setTimeout(() => scrollToBottom(false), 150);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [history, scrollToBottom]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = e.target.value.replace(/[^a-zA-Z]/g, "");
    setNextWord(sanitized);
    if (feedback) setFeedback(null);
  };

  const candidateLower = nextWord.trim().toLowerCase();
  const isDuplicate = history.some((s) => s.word.toLowerCase() === candidateLower);
  const isSameAsCurrent = candidateLower === currentWord.toLowerCase();
  const canSubmit = candidateLower.length >= 2 && !isDuplicate && !isSameAsCurrent && !loading;

  const currentStepCount = Math.max(0, history.length - 1);
  // Same formula as the final score, projected as if the next step reaches the target
  const currentLiveScore =
    finalScore?.totalScore ??
    (targetPair
      ? calculateGameScore({
          baselineScore: targetPair.baselineScore ?? 15,
          stepCount: currentStepCount + 1,
          stepSimilarities: history.slice(1).map((s) => s.relatednessToPrevious),
          failedAttempts,
        }).totalScore
      : 0);

  const updateProximity = (newProximityPct: number) => {
    if (newProximityPct > targetProximity) setProximityDelta("hotter");
    else if (newProximityPct < targetProximity) setProximityDelta("colder");
    else setProximityDelta(null);
    setTargetProximity(newProximityPct);
  };

  // Fog of war broadcast: opponent sees step count + relatedness, words only at game over
  const publishPeerStep = (steps: StepRecord[], won: boolean) => {
    ablyChannelRef.current?.publish("peer_step", {
      name: usernameRef.current,
      round: roundRef.current,
      step: steps.length - 1,
      relatedness: steps[steps.length - 1].relatednessToPrevious,
      hasWon: won,
      finalHistory: won ? steps.map((s) => s.word) : undefined,
    });
  };

  const submitRankedDailyStep = async () => {
    const res = await fetch("/api/daily", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: candidateLower }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Evaluation failed");

    const pair = targetPairRef.current;
    if (pair) applyDailyRun(data.run as DailyRunState, pair);

    if (!data.accepted) {
      setFeedback({
        type: "warning",
        message: `Too distant from "${currentWord}"`,
        score: data.relatedness,
        threshold: STEP_THRESHOLD,
      });
      return;
    }

    updateProximity(data.proximity);
    setNextWord("");
    const run: DailyRunState = data.run;
    setFeedback(
      run.finished
        ? { type: "success", message: `Reached "${targetWord}" in ${run.path.length - 1} steps.`, score: data.relatedness }
        : { type: "success", message: `Step accepted • Target: ${data.proximity}%`, score: data.relatedness }
    );
  };

  const handleStepSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    inputRef.current?.focus();
    setLoading(true);
    setFeedback(null);

    try {
      if (gameType === "daily" && dailyRanked) {
        await submitRankedDailyStep();
        return;
      }

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

      const pct: number = data.relatedness;
      const proximity: number = data.proximity;

      if (pct < STEP_THRESHOLD) {
        setFailedAttempts((prev) => prev + 1);
        setFeedback({
          type: "warning",
          message: `Too distant from "${currentWord}"`,
          score: pct,
          threshold: STEP_THRESHOLD,
        });
        return;
      }

      updateProximity(proximity);

      const withCandidate: StepRecord[] = [
        ...history,
        { word: candidateLower, relatednessToPrevious: pct, scoreVal: data.similarityScore },
      ];
      const hitTarget = candidateLower === targetWord.toLowerCase();
      // Auto-connect if candidate is >= 70% related to the target
      const autoConnect = !hitTarget && proximity >= STEP_THRESHOLD;
      const finalSteps: StepRecord[] = autoConnect
        ? [...withCandidate, { word: targetWord, relatednessToPrevious: proximity, scoreVal: 3.0 }]
        : withCandidate;
      const won = hitTarget || autoConnect;

      setHistory(finalSteps);
      historyRef.current = finalSteps;
      setNextWord("");

      if (gameType === "peer") {
        if (won) hasWonRef.current = true; // reflect immediately for reconnect state sync
        if (autoConnect) publishPeerStep(withCandidate, false);
        publishPeerStep(finalSteps, won);
        persistSession({ history: finalSteps, hasWon: won });
      }

      if (won) {
        setFinalScore(
          calculateGameScore({
            baselineScore: targetPair?.baselineScore ?? 15,
            stepCount: finalSteps.length - 1,
            stepSimilarities: finalSteps.slice(1).map((s) => s.relatednessToPrevious),
            failedAttempts,
          })
        );
        setHasWon(true);
        setFeedback({
          type: "success",
          message: hitTarget
            ? `Reached "${targetWord}" in ${finalSteps.length - 1} steps.`
            : `Connected to "${targetWord}" (${proximity}% related).`,
          score: hitTarget ? pct : proximity,
        });
      } else {
        setFeedback({ type: "success", message: `Step accepted • Target: ${proximity}%`, score: pct });
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

  const shareResult = async () => {
    if (!targetPair || !finalScore) return;
    const isDailyChallenge = gameType === "daily";
    const myPath = history.map((s) => s.word).join(" → ");
    const opponentPath =
      gameType === "peer" && opponent?.finalHistory
        ? `Opponent: ${opponent.finalHistory.join(" → ")}`
        : "";
    const shareText = [
      `WordBridge ${isDailyChallenge ? "(Daily Challenge)" : ""}`,
      `${targetPair.source} ➔ ${targetPair.target}`,
      `Solved in ${history.length - 1} steps • Rank ${finalScore.rank} (${finalScore.title})`,
      `Score: ${finalScore.totalScore.toLocaleString()} pts • Cohesion: ${finalScore.averageSimilarity}%`,
      `Path: ${myPath}`,
      opponentPath,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      if (navigator.share) {
        await navigator.share({ title: "WordBridge", text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // user dismissed the native share sheet — nothing to do
    }
  };

  const totalMatches = matchHistory.length;
  const winsCount = matchHistory.filter((m) => m.result === "won").length;
  const lossesCount = matchHistory.filter((m) => m.result === "lost").length;
  const winRate = totalMatches > 0 ? Math.round((winsCount / totalMatches) * 100) : 0;

  function formatTimeAgo(timestamp: number): string {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  // ==========================================
  // VIEW 1: HOME PAGE (Minimalist Monochrome)
  // ==========================================
  if (view === "home") {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-6 selection:bg-zinc-800 selection:text-white">
        <div className="w-full max-w-md space-y-6">
          {/* Player Identity Bar */}
          <PlayerIdentity username={username} label={user ? "Player:" : "Guest:"} onSave={handleSaveUsername} />

          {/* Google Sign-in (optional; guest play still works) */}
          {authEnabled && !authLoading && (
            <div className="flex items-center justify-between p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-xl">
              {user ? (
                <>
                  <span className="text-[11px] font-mono text-zinc-400 truncate">
                    Signed in as <span className="text-white">{user.email}</span>
                  </span>
                  <button
                    onClick={signOut}
                    className="text-[11px] font-mono text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 bg-zinc-900 px-2 py-0.5 rounded transition shrink-0 ml-2"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[11px] font-mono text-zinc-400">Playing as guest</span>
                  <button
                    onClick={signInWithGoogle}
                    className="text-[11px] font-mono text-black bg-white hover:bg-zinc-200 px-2.5 py-0.5 rounded font-semibold transition"
                  >
                    Sign in with Google
                  </button>
                </>
              )}
            </div>
          )}
          {authError && (
            <p className="text-[11px] font-mono text-red-400 text-center">Sign-in failed. Please try again.</p>
          )}

          {/* Header */}
          <div className="text-center space-y-2.5">
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

          {/* Active 1v1 Game Alert if available */}
          {activeSavedGame && (
            <div className="p-3.5 bg-zinc-900/90 border border-zinc-700 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-mono tracking-wider text-emerald-400 flex items-center gap-1.5 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                  Active 1v1 Match Found
                </span>
                <span className="text-xs font-mono text-zinc-400">Room {activeSavedGame.roomCode}</span>
              </div>
              <p className="text-xs text-zinc-300 font-mono">
                Bridge: <span className="text-white font-semibold capitalize">{activeSavedGame.targetPair.source}</span> ➔ <span className="text-white font-semibold capitalize">{activeSavedGame.targetPair.target}</span>
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleResumeSavedGame}
                  className="flex-1 py-1.5 bg-white text-black font-semibold rounded-lg text-xs hover:bg-zinc-200 transition-colors"
                >
                  Resume Match
                </button>
                <button
                  onClick={handleAbandonSavedGame}
                  className="px-3 py-1.5 bg-zinc-800 text-zinc-400 hover:text-white rounded-lg text-xs transition-colors border border-zinc-700"
                >
                  Abandon
                </button>
              </div>
            </div>
          )}

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
                  {user ? "One ranked attempt per day" : "Same puzzle for everyone • sign in to rank"}
                </span>
              </div>
              <span className="text-sm font-mono text-zinc-500 group-hover:translate-x-0.5 transition-transform">
                →
              </span>
            </button>
            <button
              onClick={() => setView("leaderboard")}
              className="w-full -mt-1 py-2 text-xs font-mono text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 bg-zinc-950 rounded-xl transition"
            >
              View today&apos;s leaderboard
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
              onClick={() => {
                setActiveSavedGame(getActiveGameSession());
                refreshMatchHistory();
                setView("lobby");
              }}
              className="w-full p-4 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-white transition-colors rounded-xl flex items-center justify-between text-left group"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm block">1v1 Blind Match</span>
                  {activeSavedGame && (
                    <span className="text-[9px] font-mono uppercase bg-emerald-950 text-emerald-300 border border-emerald-800 px-1.5 py-0.2 rounded">
                      Live
                    </span>
                  )}
                </div>
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
  // VIEW: DAILY LEADERBOARD
  // ==========================================
  if (view === "leaderboard") {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-5 sm:p-7 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800/40">
            <h2 className="text-base font-semibold text-white">Daily Leaderboard</h2>
            <button onClick={goHome} className="text-xs text-zinc-400 hover:text-white transition-colors font-mono">
              ← Back
            </button>
          </div>
          <DailyLeaderboard />
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: PEER LOBBY & MATCH HISTORY
  // ==========================================
  if (view === "lobby") {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6 selection:bg-zinc-800 selection:text-white">
        <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-5 sm:p-7 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800/40">
            <div>
              <h2 className="text-base font-semibold text-white">1v1 Blind Match</h2>
              <span className="text-xs text-zinc-500 font-mono">Fog of War Race</span>
            </div>
            <button
              onClick={goHome}
              className="text-xs text-zinc-400 hover:text-white transition-colors font-mono"
            >
              ← Back
            </button>
          </div>

          {/* Player Identity Pill */}
          <PlayerIdentity username={username} label="You:" onSave={handleSaveUsername} />

          {/* Lobby Navigation Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono">
            <button
              onClick={() => setLobbyTab("lobby")}
              className={`py-1.5 rounded-lg transition text-center font-medium ${
                lobbyTab === "lobby"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Match Lobby
            </button>
            <button
              onClick={() => {
                refreshMatchHistory();
                setLobbyTab("history");
              }}
              className={`py-1.5 rounded-lg transition text-center font-medium ${
                lobbyTab === "history"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Match History ({matchHistory.length})
            </button>
          </div>

          {/* TAB 1: MATCH LOBBY */}
          {lobbyTab === "lobby" && (
            <>
              {/* Active Game Alert */}
              {activeSavedGame && (
                <div className="p-3.5 bg-zinc-900 border border-zinc-700/80 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-emerald-400 flex items-center gap-1.5 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                      Live Match in Progress
                    </span>
                    <span className="text-xs font-mono text-zinc-400">Room {activeSavedGame.roomCode}</span>
                  </div>
                  <p className="text-xs text-zinc-300 font-mono">
                    <span className="capitalize font-semibold text-white">{activeSavedGame.targetPair.source}</span> ➔ <span className="capitalize font-semibold text-white">{activeSavedGame.targetPair.target}</span>
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleResumeSavedGame}
                      className="flex-1 py-2 bg-white text-black font-semibold rounded-lg text-xs hover:bg-zinc-200 transition-colors font-mono"
                    >
                      Resume Match
                    </button>
                    <button
                      onClick={handleAbandonSavedGame}
                      className="px-3 py-2 bg-zinc-800 text-zinc-400 hover:text-white rounded-lg text-xs transition-colors border border-zinc-700 font-mono"
                    >
                      Abandon
                    </button>
                  </div>
                </div>
              )}

              {/* Notification / Feedback */}
              {feedback && (
                <div
                  className={`p-2.5 rounded-xl text-xs font-mono border flex items-center justify-between gap-3 ${
                    feedback.type === "error"
                      ? "bg-rose-950/30 border-rose-900/40 text-rose-400"
                      : "bg-zinc-900 border-zinc-800 text-zinc-200"
                  }`}
                >
                  <span>{feedback.message}</span>
                </div>
              )}

              {lobbyStatus === "hosting" ? (
                <div className="space-y-5 text-center">
                  <div
                    onClick={copyRoomCode}
                    role="button"
                    aria-label="Tap to copy room code"
                    className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2 cursor-pointer select-none transition hover:border-zinc-700 active:scale-[0.99]"
                  >
                    <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-400 block">
                      Room Code
                    </span>
                    <span className="text-4xl font-bold text-white font-mono tracking-widest block">
                      {roomCode}
                    </span>
                    <span className="text-xs text-zinc-400 block pt-1">
                      {codeCopied ? "Code copied!" : "Tap to copy"}
                    </span>
                  </div>

                  <button
                    onClick={shareJoinLink}
                    className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-lg text-sm transition border border-zinc-800 font-mono"
                  >
                    {copied ? "Link Copied!" : "Share Join Link"}
                  </button>

                  {pendingGuest ? (
                    <div className="p-4 border border-zinc-700 bg-zinc-900 rounded-xl text-left space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-mono uppercase text-zinc-400 block">
                            Challenger Request
                          </span>
                          <span className="text-sm font-semibold text-white font-mono">{pendingGuest.name}</span>
                        </div>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      </div>

                      <button
                        onClick={handleAcceptGuest}
                        disabled={!targetPair}
                        className="w-full py-3 bg-white text-black font-semibold rounded-lg text-sm hover:bg-zinc-200 transition-colors font-mono disabled:opacity-40"
                      >
                        {targetPair ? "Accept & Begin Match" : "Preparing words…"}
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
                    <h3 className="text-sm font-semibold text-white font-mono">Connected to Room {roomCode}</h3>
                    <p className="text-xs text-zinc-400 mt-1 font-mono">Waiting for host approval...</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <button
                    onClick={handleHostRoom}
                    className="w-full py-3.5 px-4 bg-white text-black font-semibold rounded-xl transition text-sm hover:bg-zinc-200 font-mono"
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

                  <div className="space-y-2.5">
                    <input
                      type="text"
                      placeholder="ROOM CODE"
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      maxLength={6}
                      className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-center text-white placeholder-zinc-600 uppercase tracking-widest font-mono text-base font-bold focus:outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={() => handleJoinRoom()}
                      disabled={!joinCodeInput.trim()}
                      className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white font-medium rounded-xl text-sm transition border border-zinc-800 font-mono"
                    >
                      Join Match
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: MATCH HISTORY */}
          {lobbyTab === "history" && (
            <div className="space-y-4">
              {/* Stats Summary Bar */}
              <div className="grid grid-cols-4 gap-1.5 p-2 bg-zinc-900/80 border border-zinc-800/60 rounded-xl text-center font-mono">
                <div className="p-1">
                  <span className="text-[9px] text-zinc-500 uppercase block">Matches</span>
                  <span className="text-sm font-bold text-white">{totalMatches}</span>
                </div>
                <div className="p-1">
                  <span className="text-[9px] text-emerald-400 uppercase block">Wins</span>
                  <span className="text-sm font-bold text-emerald-400">{winsCount}</span>
                </div>
                <div className="p-1">
                  <span className="text-[9px] text-rose-400 uppercase block">Losses</span>
                  <span className="text-sm font-bold text-rose-400">{lossesCount}</span>
                </div>
                <div className="p-1">
                  <span className="text-[9px] text-zinc-400 uppercase block">Win %</span>
                  <span className="text-sm font-bold text-white">{winRate}%</span>
                </div>
              </div>

              {/* Match History List */}
              {matchHistory.length === 0 ? (
                <div className="p-8 text-center border border-zinc-900 rounded-xl space-y-2">
                  <span className="text-2xl block">⚔️</span>
                  <p className="text-xs text-zinc-400 font-mono">No multiplayer matches recorded yet.</p>
                  <p className="text-[11px] text-zinc-600">Play a 1v1 match to track your match history here.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {matchHistory.map((item) => {
                    const isExpanded = expandedMatchId === item.id;
                    const isWon = item.result === "won";
                    return (
                      <div
                        key={item.id}
                        className="bg-zinc-900/50 border border-zinc-800/60 hover:border-zinc-700/80 rounded-xl p-3 space-y-2 text-xs font-mono transition"
                      >
                        <div
                          onClick={() => setExpandedMatchId(isExpanded ? null : item.id)}
                          className="flex items-center justify-between cursor-pointer select-none"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${
                                  isWon
                                    ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                                    : "bg-rose-950 text-rose-300 border border-rose-800"
                                }`}
                              >
                                {isWon ? "Victory" : "Defeat"}
                              </span>
                              <span className="text-zinc-200 font-medium capitalize">
                                {item.sourceWord} ➔ {item.targetWord}
                              </span>
                            </div>
                            <div className="text-[10px] text-zinc-500">
                              vs <span className="text-zinc-400 font-semibold">{item.opponentName}</span> • {item.mySteps} {item.mySteps === 1 ? "step" : "steps"}
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] text-zinc-500 block">
                              {formatTimeAgo(item.timestamp)}
                            </span>
                            <span className="text-zinc-500 text-xs">{isExpanded ? "▲" : "▼"}</span>
                          </div>
                        </div>

                        {/* Expanded Paths Drawer */}
                        {isExpanded && (
                          <div className="pt-2 border-t border-zinc-800 space-y-1.5 text-[11px]">
                            <div className="break-words whitespace-normal text-zinc-300">
                              <span className="text-white font-semibold">You ({item.myUsername}): </span>
                              {item.myPath.join(" ➔ ")}
                            </div>
                            {item.opponentPath && item.opponentPath.length > 0 && (
                              <div className="break-words whitespace-normal text-zinc-400">
                                <span className="text-zinc-300 font-semibold">{item.opponentName}: </span>
                                {item.opponentPath.join(" ➔ ")}
                              </div>
                            )}
                            <div className="text-[9px] text-zinc-600 font-mono pt-0.5">
                              Room: {item.roomCode}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {matchHistory.length > 0 && (
                <div className="pt-1 flex justify-end">
                  <button
                    onClick={async () => {
                      await clearAllMatches(user);
                      setMatchHistory([]);
                    }}
                    className="text-[10px] font-mono text-zinc-500 hover:text-rose-400 transition"
                  >
                    Clear History
                  </button>
                </div>
              )}
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
    <div className="fixed inset-0 overflow-hidden bg-black text-zinc-100 flex flex-col items-center justify-between p-2 sm:p-4 selection:bg-zinc-800 selection:text-white">
      {/* Header (shrink-0) */}
      <header className="w-full max-w-xl flex items-center justify-between py-1.5 sm:py-2 border-b border-zinc-800/40 mb-2 sm:mb-3 shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            onClick={goHome}
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
        {pairError ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-0 space-y-3 text-center">
            <p className="text-xs font-mono text-rose-400">{pairError}</p>
            <button
              onClick={() => initGame(gameType === "daily" ? "daily" : "solo")}
              className="px-4 py-2 bg-white text-black font-semibold rounded-lg text-xs hover:bg-zinc-200 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : loadingPair || !targetPair ? (
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
                      {opponent.steps.length} {opponent.steps.length === 1 ? "step" : "steps"} {opponent.hasWon ? "• Finished" : ""}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                    {opponent.steps.map((st, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded text-[10px] font-mono border border-zinc-800 bg-zinc-950 text-zinc-300"
                        title={hasWon || opponentWon ? st.word : "Word hidden until game finishes"}
                      >
                        {st.word
                          ? st.word
                          : `Step ${i + 1} (${st.relatedness}%)`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Target Goal Card */}
              <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-2.5 sm:p-3.5">
                <div className="flex items-center justify-between gap-2 sm:gap-3">
                  {/* Start Word */}
                  <button
                    type="button"
                    onClick={() => handleToggleDefinition(targetPair.source)}
                    className={`flex-1 rounded-lg sm:rounded-xl p-2 sm:p-2.5 text-center transition cursor-pointer select-none border active:scale-[0.98] ${
                      activeDefinition?.word === targetPair.source.toLowerCase()
                        ? "bg-zinc-900/90 border-zinc-600 shadow-sm"
                        : "bg-zinc-950/60 border-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-900/40"
                    }`}
                    title={`Click for definition of "${targetPair.source}"`}
                    aria-label={`Definition for ${targetPair.source}`}
                  >
                    <div className="flex items-center justify-center gap-1 mb-0.5 pointer-events-none">
                      <span className="text-[9px] sm:text-[10px] font-mono uppercase text-zinc-400">Start</span>
                      <span
                        className={`text-[9px] sm:text-[10px] w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-mono border transition ${
                          activeDefinition?.word === targetPair.source.toLowerCase()
                            ? "bg-zinc-800 text-zinc-100 border-zinc-600"
                            : "text-zinc-500 border-zinc-800 bg-zinc-900/60"
                        }`}
                      >
                        ?
                      </span>
                    </div>
                    <span className="text-base sm:text-xl font-bold tracking-tight text-white capitalize truncate block pointer-events-none">
                      {targetPair.source}
                    </span>
                  </button>

                  {/* Divider Arrow */}
                  <div className="flex items-center justify-center text-zinc-600 px-0.5 sm:px-1 shrink-0">
                    <span className="text-sm sm:text-base text-zinc-400">→</span>
                  </div>

                  {/* Target Word */}
                  <button
                    type="button"
                    onClick={() => handleToggleDefinition(targetPair.target)}
                    className={`flex-1 rounded-lg sm:rounded-xl p-2 sm:p-2.5 text-center transition cursor-pointer select-none border active:scale-[0.98] ${
                      activeDefinition?.word === targetPair.target.toLowerCase()
                        ? "bg-zinc-900/90 border-zinc-600 shadow-sm"
                        : "bg-zinc-950/60 border-zinc-800/40 hover:border-zinc-700 hover:bg-zinc-900/40"
                    }`}
                    title={`Click for definition of "${targetPair.target}"`}
                    aria-label={`Definition for ${targetPair.target}`}
                  >
                    <div className="flex items-center justify-center gap-1 mb-0.5 pointer-events-none">
                      <span className="text-[9px] sm:text-[10px] font-mono uppercase text-zinc-400">Target</span>
                      <span
                        className={`text-[9px] sm:text-[10px] w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-mono border transition ${
                          activeDefinition?.word === targetPair.target.toLowerCase()
                            ? "bg-zinc-800 text-zinc-100 border-zinc-600"
                            : "text-zinc-500 border-zinc-800 bg-zinc-900/60"
                        }`}
                      >
                        ?
                      </span>
                    </div>
                    <span className="text-base sm:text-xl font-bold tracking-tight text-white capitalize truncate block pointer-events-none">
                      {targetPair.target}
                    </span>
                  </button>
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
                    feedback.type === "success"
                      ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-400"
                      : feedback.type === "warning"
                      ? "bg-amber-950/30 border-amber-900/40 text-amber-400"
                      : "bg-rose-950/30 border-rose-900/40 text-rose-400"
                  }`}
                >
                  <span className="truncate">{feedback.message}</span>
                  {feedback.score !== undefined && (
                    <span
                      className={`font-bold px-2 py-0.5 rounded shrink-0 ${
                        feedback.type === "success"
                          ? "bg-emerald-900/40 text-emerald-300"
                          : feedback.type === "warning"
                          ? "bg-amber-900/40 text-amber-300"
                          : "bg-rose-900/40 text-rose-300"
                      }`}
                    >
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
                      {gameType === "peer"
                        ? raceWinner === "me"
                          ? "You Won the Race"
                          : hasWon
                          ? "Finished 2nd"
                          : "Opponent Won"
                        : "Bridge Completed"}
                    </span>
                    {finalScore ? (
                      <>
                        <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-white">
                          Rank {finalScore.rank}
                        </div>
                        <div className="text-xs text-zinc-400 font-mono">
                          {finalScore.totalScore.toLocaleString()} points
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-zinc-300 font-mono pt-1">
                        {opponent?.name ?? "Your opponent"} reached the target first.
                      </div>
                    )}
                  </div>

                  {/* Multiplayer Reveal */}
                  {gameType === "peer" && opponent?.finalHistory && (
                    <div className="p-2 sm:p-2.5 bg-zinc-950 border border-zinc-800/40 rounded-lg text-xs text-left space-y-1 font-mono">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400 block">
                        Paths Side-by-Side
                      </span>
                      <div className="break-words whitespace-normal max-h-20 overflow-y-auto text-zinc-300">
                        <span className="text-white font-semibold">You: </span>
                        {history.map((s) => s.word).join(" → ")}
                      </div>
                      <div className="break-words whitespace-normal max-h-20 overflow-y-auto text-zinc-400">
                        <span className="text-zinc-300 font-semibold">Opponent: </span>
                        {opponent.finalHistory.join(" → ")}
                      </div>
                    </div>
                  )}

                  {/* Daily Challenge Global Benchmark */}
                  {gameType === "daily" && (
                    <div className="p-2 sm:p-2.5 bg-zinc-950 border border-zinc-800/40 rounded-lg max-h-40 overflow-y-auto">
                      {dailyRanked ? (
                        <DailyLeaderboard compact refreshKey={history.length} />
                      ) : (
                        <p className="text-xs font-mono text-zinc-400 text-left">
                          Unranked guest run.{" "}
                          {authEnabled && (
                            <button onClick={signInWithGoogle} className="text-white underline">
                              Sign in
                            </button>
                          )}{" "}
                          to get one ranked attempt per day on the leaderboard.
                        </p>
                      )}
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

                  {gameType === "peer" && (
                    <button
                      onClick={requestRematch}
                      disabled={rematchState === "starting"}
                      className={`w-full py-2 sm:py-2.5 font-semibold rounded-lg text-sm transition-colors ${
                        rematchState === "idle"
                          ? "bg-white text-black hover:bg-zinc-200"
                          : "bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 border border-zinc-700"
                      }`}
                    >
                      {rematchState === "idle"
                        ? "Rematch"
                        : rematchState === "requested"
                        ? "Waiting for opponent…"
                        : "Starting round…"}
                    </button>
                  )}

                  <div className="flex gap-2 pt-0.5">
                    {finalScore && (
                      <button
                        onClick={shareResult}
                        className="flex-1 py-2 sm:py-2.5 bg-white text-black font-semibold rounded-lg text-sm hover:bg-zinc-200 transition-colors"
                      >
                        {copied ? "Copied" : "Share Result"}
                      </button>
                    )}

                    <button
                      onClick={() =>
                        gameType === "peer"
                          ? goHome()
                          : gameType === "daily"
                          ? setView("leaderboard")
                          : initGame("solo")
                      }
                      className="flex-1 py-2 sm:py-2.5 bg-zinc-800 text-zinc-200 hover:text-white hover:bg-zinc-700 font-semibold rounded-lg text-sm transition-colors border border-zinc-700"
                    >
                      {gameType === "peer" ? "Main Menu" : gameType === "daily" ? "Leaderboard" : "Play Next"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Input Form */
                <form onSubmit={handleStepSubmit} className="pt-0.5">
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder={`Step from "${currentWord}"...`}
                      value={nextWord}
                      onChange={handleInputChange}
                      onFocus={() => {
                        if (typeof window !== "undefined") {
                          setTimeout(() => window.scrollTo(0, 0), 30);
                        }
                        scrollToBottom(false);
                        setTimeout(() => scrollToBottom(false), 80);
                        setTimeout(() => scrollToBottom(false), 200);
                        setTimeout(() => scrollToBottom(false), 350);
                      }}
                      onClick={() => {
                        scrollToBottom(false);
                        setTimeout(() => scrollToBottom(false), 100);
                      }}
                      autoFocus
                      className="flex-1 px-3.5 py-2.5 sm:py-3 bg-zinc-900/60 border border-zinc-800/50 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700 font-medium text-sm sm:text-base transition-colors"
                    />

                    <button
                      type="submit"
                      disabled={!canSubmit || loading}
                      onMouseDown={(e) => e.preventDefault()}
                      className="py-2.5 sm:py-3 px-4 sm:px-5 bg-zinc-200 hover:bg-white active:bg-zinc-300 text-black font-semibold rounded-xl text-sm transition-colors disabled:opacity-20 shrink-0"
                    >
                      {loading ? "..." : "Submit"}
                    </button>
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
