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
import type { DailyRunState, MatchFound } from "./lib/dailyRun";
import PlayerIdentity from "./components/PlayerIdentity";
import DailyLeaderboard from "./components/DailyLeaderboard";
import RulesSheet from "./components/RulesSheet";
import StatsCard from "./components/StatsCard";
import Countdown from "./components/Countdown";
import { buildShareText, dailyNumber } from "./lib/share";

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
  const [dailyDay, setDailyDay] = useState<string | null>(null);
  // Give up ends a solo/daily game without a score; bestPath shows how someone else solved it
  const [gaveUp, setGaveUp] = useState(false);
  const [bestPath, setBestPath] = useState<string[] | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [firstVisit, setFirstVisit] = useState(false);
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  // Random matchmaking: "searching" while queued; opponentConnected once they appear in the room
  const [searching, setSearching] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(true);

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
  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchingRef = useRef(false);
  const goneCountRef = useRef(0);
  const inboxRef = useRef<any>(null);
  const opponentConnectedRef = useRef(true);

  // Word definition tooltip/card state
  const [activeDefinition, setActiveDefinition] = useState<{
    word: string;
    partOfSpeech?: string;
    definition: string;
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    setGuestName(getOrCreateGuestName());

    // First visit: show the rules once
    try {
      if (!localStorage.getItem("wordbridge_seen_rules")) {
        setFirstVisit(true);
        setShowRules(true);
      }
    } catch {}

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
    if (run.gaveUp) {
      setGaveUp(true);
    } else if (run.finished) {
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
    cancelSearch();
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
    setGaveUp(false);
    setBestPath(null);
    setShowScoreDetails(false);
    resetRace();

    try {
      if (type === "daily") {
        const res = await fetch("/api/daily");
        if (!res.ok) throw new Error("Failed to load the daily challenge");
        const { puzzle, run, ranked }: { puzzle: WordPair; run: DailyRunState | null; ranked: boolean } = await res.json();
        targetPairRef.current = puzzle;
        setTargetPair(puzzle);
        setDailyDay((puzzle as WordPair & { day: string }).day);
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

  const closeRules = () => {
    setShowRules(false);
    setFirstVisit(false);
    try {
      localStorage.setItem("wordbridge_seen_rules", "1");
    } catch {}
  };

  // Ends a solo/daily game. Ranked daily records a "did not finish" and shows today's best path.
  const handleGiveUp = async () => {
    if (!window.confirm("Give up this puzzle? You won't get a score.")) return;
    setFeedback(null);
    if (gameType === "daily" && dailyRanked) {
      try {
        const res = await fetch("/api/daily", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "give_up" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not give up");
        setBestPath(data.bestPath ?? null);
      } catch (err: any) {
        setFeedback({ type: "error", message: err?.message || "Could not give up. Try again." });
        return;
      }
    }
    setGaveUp(true);
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
  const markOpponentConnected = () => {
    if (opponentConnectedRef.current) return;
    opponentConnectedRef.current = true;
    setOpponentConnected(true);
    if (presenceTimeoutRef.current) {
      clearTimeout(presenceTimeoutRef.current);
      presenceTimeoutRef.current = null;
    }
  };

  const subscribeGameEvents = (channel: any) => {
    // Any message from the opponent proves they're in the room
    channel.subscribe((msg: any) => {
      if (isOpponent(msg.clientId)) markOpponentConnected();
    });

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

  // Common state reset when a 1v1 round begins.
  // awaitOpponent: random matches wait for the opponent to show up in the room before trusting they're there.
  const beginPeerRound = (pair: WordPair, opp: OpponentState, awaitOpponent = false) => {
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

    opponentConnectedRef.current = !awaitOpponent;
    setOpponentConnected(!awaitOpponent);
    if (presenceTimeoutRef.current) clearTimeout(presenceTimeoutRef.current);
    if (awaitOpponent) {
      presenceTimeoutRef.current = setTimeout(() => {
        if (!opponentConnectedRef.current) {
          setFeedback({ type: "error", message: `${opp.name} didn't connect. Go back and find another match.` });
        }
      }, 20000);
    }
    // Announce ourselves; the opponent answers with their state (also used for presence)
    ablyChannelRef.current?.publish("state_request", { round: roundRef.current });

    setGameType("peer");
    setView("playing");
    setTimeout(() => inputRef.current?.focus(), 150);
  };

  // ==========================================
  // RANDOM MATCHMAKING
  // ==========================================
  const stopSearch = () => {
    searchingRef.current = false;
    setSearching(false);
    if (searchTimerRef.current) {
      clearInterval(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    const inbox = inboxRef.current;
    if (inbox) {
      try {
        inbox.unsubscribe();
        inbox.detach().catch(() => {});
      } catch {}
    }
    inboxRef.current = null;
  };

  const cancelSearch = () => {
    const wasSearching = searchingRef.current;
    stopSearch();
    if (wasSearching && myIdRef.current) {
      fetch("/api/matchmaking", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: myIdRef.current }),
      }).catch(() => {});
    }
  };

  const startMatchFromQueue = async (m: MatchFound) => {
    if (!searchingRef.current) return; // already matched or cancelled
    stopSearch();
    leaveChannel();
    setRoomCode(m.roomCode);
    roomCodeRef.current = m.roomCode;
    matchIdRef.current = m.matchId;
    roundRef.current = 0;
    const host = m.role === "host";
    setIsHost(host);
    isHostRef.current = host;

    const { ably } = await connectAbly();
    const channel = ably.channels.get(`room:${m.roomCode}`);
    ablyChannelRef.current = channel;
    subscribeGameEvents(channel);
    beginPeerRound(m.targetPair, { clientId: m.opponentClientId, name: m.opponentName, steps: [], hasWon: false }, true);
  };

  // Leave the queue if the tab closes mid-search so nobody gets matched with a ghost
  useEffect(() => {
    const onPageHide = () => {
      if (!searchingRef.current || !myIdRef.current) return;
      const payload = JSON.stringify({ clientId: myIdRef.current, action: "leave" });
      navigator.sendBeacon?.("/api/matchmaking", new Blob([payload], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  const findRandomMatch = async () => {
    leaveChannel();
    stopSearch();
    setFeedback(null);

    let myId: string;
    try {
      myId = await ensureRealtime();
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Could not connect to multiplayer." });
      return;
    }

    // Private inbox: the server posts "matched" here when someone pairs with us
    const { ably } = await connectAbly();
    const inbox = ably.channels.get(`inbox:${myId}`);
    inboxRef.current = inbox;
    inbox.subscribe("matched", (msg: any) => startMatchFromQueue(msg.data as MatchFound));

    searchingRef.current = true;
    setSearching(true);
    goneCountRef.current = 0;

    const poll = async (heartbeat: boolean) => {
      if (!searchingRef.current) return;
      try {
        const res = await fetch("/api/matchmaking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: myId, name: usernameRef.current, heartbeat }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Matchmaking failed");
        if (data.status === "matched") {
          startMatchFromQueue(data.match as MatchFound);
        } else if (data.status === "gone") {
          // Someone matched us; the inbox notice should arrive momentarily. Re-queue if it never does.
          goneCountRef.current += 1;
          if (goneCountRef.current >= 3) {
            goneCountRef.current = 0;
            poll(false);
          }
        } else {
          goneCountRef.current = 0;
        }
      } catch (err: any) {
        cancelSearch();
        setFeedback({ type: "error", message: err?.message || "Matchmaking failed. Try again." });
      }
    };

    await poll(false);
    if (searchingRef.current) searchTimerRef.current = setInterval(() => poll(true), 5000);
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
      const channel = ably.channels.get(`room:${session.roomCode}`);
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
    cancelSearch();
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
    const channel = ably.channels.get(`room:${code}`);
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

  // Anyone with the room code or link was invited, so accept the first valid request automatically
  useEffect(() => {
    if (pendingGuest && targetPair && lobbyStatus === "hosting" && !opponentRef.current) handleAcceptGuest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGuest, targetPair, lobbyStatus]);

  const handleJoinRoom = async (codeArg?: string) => {
    const code = (codeArg ?? joinCodeInput).trim().toUpperCase();
    if (!code) return;

    cancelSearch();
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
    const channel = ably.channels.get(`room:${code}`);
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
    cancelSearch();
    if (presenceTimeoutRef.current) {
      clearTimeout(presenceTimeoutRef.current);
      presenceTimeoutRef.current = null;
    }
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
        message: `Not close enough to "${currentWord}" (needs 70%)`,
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
        ? { type: "success", message: `Connected to "${targetWord}"!`, score: data.relatedness }
        : { type: "success", message: `Linked to "${currentWord}"`, score: data.relatedness }
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
          message: `Not close enough to "${currentWord}" (needs 70%)`,
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
            ? `Connected to "${targetWord}"!`
            : `Close enough — connected to "${targetWord}"!`,
          score: hitTarget ? pct : proximity,
        });
      } else {
        setFeedback({ type: "success", message: `Linked to "${currentWord}"`, score: pct });
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
    const shareText = buildShareText({
      mode: gameType,
      day: dailyDay ?? undefined,
      source: targetPair.source,
      target: targetPair.target,
      steps: history,
      score: finalScore,
      misses: failedAttempts,
      opponentPath: gameType === "peer" ? opponent?.finalHistory : undefined,
    });

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

  const isGameOver = hasWon || opponentWon || gaveUp;
  const rulesSheet = <RulesSheet open={showRules} onClose={closeRules} firstVisit={firstVisit} />;
  const helpButton = (
    <button
      onClick={() => setShowRules(true)}
      aria-label="How to play"
      className="w-8 h-8 shrink-0 rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-600 text-sm transition"
    >
      ?
    </button>
  );
  const modeCardClass =
    "w-full p-4 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-white transition-colors rounded-2xl flex items-center justify-between text-left group";

  // ==========================================
  // VIEW 1: HOME
  // ==========================================
  if (view === "home") {
    return (
      <div className="h-full overflow-y-auto bg-black text-zinc-100 selection:bg-zinc-800">
        {rulesSheet}
        <div className="min-h-full flex flex-col items-center justify-center p-5">
          <div className="w-full max-w-md space-y-6">
            {/* Account header */}
            <header className="flex items-center justify-between gap-2">
              <PlayerIdentity username={username} signedIn={Boolean(user)} onSave={handleSaveUsername} />
              <div className="flex items-center gap-2 shrink-0">
                {helpButton}
                {authEnabled && !authLoading &&
                  (user ? (
                    <button onClick={signOut} className="text-sm text-zinc-400 hover:text-white px-2 py-1 transition">
                      Sign out
                    </button>
                  ) : (
                    <button
                      onClick={signInWithGoogle}
                      className="text-sm font-semibold bg-white text-black hover:bg-zinc-200 px-3 py-1.5 rounded-full transition"
                    >
                      Sign in
                    </button>
                  ))}
              </div>
            </header>
            {authError && <p className="text-sm text-rose-400 text-center">Sign-in failed. Please try again.</p>}

            <div className="text-center space-y-2 pt-2">
              <h1 className="text-4xl font-semibold tracking-tight text-white">WordBridge</h1>
              <p className="text-base text-zinc-400">Get from one word to another, one related word at a time.</p>
            </div>

            {user && <StatsCard refreshKey={view} />}

            {activeSavedGame && (
              <div className="p-4 bg-zinc-900 border border-emerald-900/60 rounded-2xl space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-emerald-400 font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Race in progress
                  </span>
                  <span className="text-zinc-500 font-mono text-xs">Room {activeSavedGame.roomCode}</span>
                </div>
                <p className="text-sm text-zinc-300">
                  <span className="text-white font-semibold capitalize">{activeSavedGame.targetPair.source}</span> →{" "}
                  <span className="text-white font-semibold capitalize">{activeSavedGame.targetPair.target}</span>
                </p>
                <div className="flex gap-2">
                  <button onClick={handleResumeSavedGame} className="flex-1 py-2 bg-white text-black font-semibold rounded-xl text-sm hover:bg-zinc-200 transition-colors">
                    Resume
                  </button>
                  <button onClick={handleAbandonSavedGame} className="px-4 py-2 text-zinc-400 hover:text-white rounded-xl text-sm border border-zinc-700 transition-colors">
                    Abandon
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => initGame("daily")}
                className="w-full p-4 bg-white text-black hover:bg-zinc-200 transition-colors rounded-2xl flex items-center justify-between text-left group"
              >
                <div>
                  <span className="font-semibold text-base block">Daily puzzle</span>
                  <span className="text-sm text-zinc-600 block mt-0.5">
                    {user ? "One ranked try a day. Keep your streak going." : "Same puzzle for everyone. Sign in to rank."}
                  </span>
                  <span className="text-xs text-zinc-500 block mt-1">
                    <Countdown />
                  </span>
                </div>
                <span className="text-lg text-zinc-500 group-hover:translate-x-0.5 transition-transform">→</span>
              </button>

              <button onClick={() => initGame("solo")} className={modeCardClass}>
                <div>
                  <span className="font-semibold text-base block">Practice</span>
                  <span className="text-sm text-zinc-400 block mt-0.5">Unlimited random puzzles.</span>
                </div>
                <span className="text-lg text-zinc-500 group-hover:translate-x-0.5 transition-transform">→</span>
              </button>

              <button
                onClick={() => {
                  setActiveSavedGame(getActiveGameSession());
                  refreshMatchHistory();
                  setLobbyTab("lobby");
                  setView("lobby");
                }}
                className={modeCardClass}
              >
                <div>
                  <span className="font-semibold text-base block">Race</span>
                  <span className="text-sm text-zinc-400 block mt-0.5">Same words as your opponent. First to connect wins.</span>
                </div>
                <span className="text-lg text-zinc-500 group-hover:translate-x-0.5 transition-transform">→</span>
              </button>
            </div>

            <div className="flex items-center justify-center gap-4 text-sm">
              <button onClick={() => setView("leaderboard")} className="text-zinc-400 hover:text-white transition">
                Today&apos;s leaderboard
              </button>
              <span className="text-zinc-700">·</span>
              <button onClick={() => setShowRules(true)} className="text-zinc-400 hover:text-white transition">
                How to play
              </button>
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
      <div className="h-full overflow-y-auto bg-black text-zinc-100">
        {rulesSheet}
        <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Today&apos;s leaderboard</h2>
              <button onClick={goHome} className="text-sm text-zinc-400 hover:text-white transition-colors">
                ← Back
              </button>
            </div>
            {user && <StatsCard />}
            <DailyLeaderboard />
            <p className="text-xs text-zinc-500 text-center">
              <Countdown prefix="Resets in" />
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: RACE LOBBY & MATCH HISTORY
  // ==========================================
  if (view === "lobby") {
    return (
      <div className="h-full overflow-y-auto bg-black text-zinc-100">
        {rulesSheet}
        <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Race</h2>
                <span className="text-sm text-zinc-400">Playing as {username}</span>
              </div>
              <button onClick={goHome} className="text-sm text-zinc-400 hover:text-white transition-colors">
                ← Back
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl text-sm">
              {(["lobby", "history"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    if (tab === "history") refreshMatchHistory();
                    setLobbyTab(tab);
                  }}
                  className={`py-1.5 rounded-lg transition font-medium ${
                    lobbyTab === tab ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab === "lobby" ? "Play" : `History (${matchHistory.length})`}
                </button>
              ))}
            </div>

            {lobbyTab === "lobby" && (
              <>
                {activeSavedGame && !searching && lobbyStatus === "idle" && (
                  <div className="p-3.5 bg-zinc-900 border border-emerald-900/60 rounded-xl flex items-center justify-between gap-3">
                    <p className="text-sm text-zinc-300 min-w-0 truncate">
                      Race in progress:{" "}
                      <span className="text-white font-semibold capitalize">{activeSavedGame.targetPair.source}</span> →{" "}
                      <span className="text-white font-semibold capitalize">{activeSavedGame.targetPair.target}</span>
                    </p>
                    <button onClick={handleResumeSavedGame} className="shrink-0 px-3 py-1.5 bg-white text-black font-semibold rounded-lg text-sm">
                      Resume
                    </button>
                  </div>
                )}

                {feedback && (
                  <div className={`p-3 rounded-xl text-sm border ${feedback.type === "error" ? "bg-rose-950/30 border-rose-900/40 text-rose-300" : "bg-zinc-900 border-zinc-800 text-zinc-200"}`}>
                    {feedback.message}
                  </div>
                )}

                {searching ? (
                  <div className="py-6 space-y-4 text-center">
                    <div className="w-7 h-7 border-2 border-zinc-700 border-t-white rounded-full animate-spin mx-auto"></div>
                    <div>
                      <p className="text-base font-semibold text-white">Finding an opponent…</p>
                      <p className="text-sm text-zinc-400 mt-1">You&apos;ll start as soon as someone joins.</p>
                    </div>
                    <button onClick={cancelSearch} className="px-5 py-2 text-sm text-zinc-300 border border-zinc-700 rounded-xl hover:text-white transition">
                      Cancel
                    </button>
                  </div>
                ) : lobbyStatus === "hosting" ? (
                  <div className="space-y-4 text-center">
                    <div
                      onClick={copyRoomCode}
                      role="button"
                      aria-label="Tap to copy room code"
                      className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl space-y-1 cursor-pointer select-none transition hover:border-zinc-600 active:scale-[0.99]"
                    >
                      <span className="text-sm text-zinc-400 block">Send this code to a friend</span>
                      <span className="text-4xl font-bold text-white font-mono tracking-widest block">{roomCode}</span>
                      <span className="text-xs text-zinc-500 block">{codeCopied ? "Copied!" : "Tap to copy"}</span>
                    </div>
                    <button onClick={shareJoinLink} className="w-full py-2.5 bg-white text-black font-semibold rounded-xl text-sm hover:bg-zinc-200 transition">
                      {copied ? "Link copied!" : "Share invite link"}
                    </button>
                    <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
                      <span className="w-4 h-4 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></span>
                      {pendingGuest ? `${pendingGuest.name} joined. Starting…` : "Waiting for your friend to join…"}
                    </div>
                  </div>
                ) : lobbyStatus === "joining" ? (
                  <div className="py-6 space-y-3 text-center">
                    <div className="w-7 h-7 border-2 border-zinc-700 border-t-white rounded-full animate-spin mx-auto"></div>
                    <p className="text-base font-semibold text-white">Joining room {roomCode}…</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <button
                      onClick={findRandomMatch}
                      className="w-full p-4 bg-white text-black hover:bg-zinc-200 rounded-2xl text-left transition-colors"
                    >
                      <span className="font-semibold text-base block">Find an opponent</span>
                      <span className="text-sm text-zinc-600">Get matched with a random player.</span>
                    </button>

                    <div className="flex items-center gap-3 text-sm text-zinc-500">
                      <div className="flex-1 border-t border-zinc-800"></div>
                      or play a friend
                      <div className="flex-1 border-t border-zinc-800"></div>
                    </div>

                    <button onClick={handleHostRoom} className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-xl text-sm transition border border-zinc-800">
                      Create a room
                    </button>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleJoinRoom();
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        placeholder="Room code"
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                        maxLength={6}
                        className="flex-1 min-w-0 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-center text-white placeholder-zinc-500 uppercase tracking-widest font-mono text-base focus:outline-none focus:border-zinc-500"
                      />
                      <button
                        type="submit"
                        disabled={!joinCodeInput.trim()}
                        className="px-5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white font-medium rounded-xl text-sm transition border border-zinc-800"
                      >
                        Join
                      </button>
                    </form>
                  </div>
                )}
              </>
            )}

            {lobbyTab === "history" && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  {[
                    { label: "Played", value: totalMatches, cls: "text-white" },
                    { label: "Won", value: winsCount, cls: "text-emerald-400" },
                    { label: "Lost", value: lossesCount, cls: "text-rose-400" },
                    { label: "Win rate", value: `${winRate}%`, cls: "text-white" },
                  ].map((it) => (
                    <div key={it.label} className="bg-zinc-900 border border-zinc-800 rounded-xl py-2">
                      <div className={`text-base font-semibold ${it.cls}`}>{it.value}</div>
                      <div className="text-xs text-zinc-400">{it.label}</div>
                    </div>
                  ))}
                </div>

                {matchHistory.length === 0 ? (
                  <p className="py-8 text-center text-sm text-zinc-400">No races yet. Your results will show up here.</p>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {matchHistory.map((item) => {
                      const isExpanded = expandedMatchId === item.id;
                      const isWon = item.result === "won";
                      return (
                        <div key={item.id} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 space-y-2 text-sm">
                          <button
                            onClick={() => setExpandedMatchId(isExpanded ? null : item.id)}
                            className="w-full flex items-center justify-between gap-2 text-left"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${isWon ? "bg-emerald-950 text-emerald-300" : "bg-rose-950 text-rose-300"}`}>
                                  {isWon ? "Won" : "Lost"}
                                </span>
                                <span className="text-zinc-200 font-medium capitalize truncate">
                                  {item.sourceWord} → {item.targetWord}
                                </span>
                              </div>
                              <div className="text-xs text-zinc-500 mt-0.5">
                                vs {item.opponentName} · {item.mySteps} {item.mySteps === 1 ? "step" : "steps"} · {formatTimeAgo(item.timestamp)}
                              </div>
                            </div>
                            <span className="text-zinc-500 text-xs">{isExpanded ? "▲" : "▼"}</span>
                          </button>
                          {isExpanded && (
                            <div className="pt-2 border-t border-zinc-800 space-y-1 text-sm">
                              <p className="text-zinc-300 break-words">
                                <span className="text-white font-semibold">You: </span>
                                {item.myPath.join(" → ")}
                              </p>
                              {item.opponentPath && item.opponentPath.length > 0 && (
                                <p className="text-zinc-400 break-words">
                                  <span className="text-zinc-200 font-semibold">{item.opponentName}: </span>
                                  {item.opponentPath.join(" → ")}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {matchHistory.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      onClick={async () => {
                        if (!window.confirm("Delete your whole race history?")) return;
                        await clearAllMatches(user);
                        setMatchHistory([]);
                      }}
                      className="text-xs text-zinc-500 hover:text-rose-400 transition"
                    >
                      Clear history
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 3: ACTIVE GAME (Mobile Viewport Optimized)
  // ==========================================
  const modeLabel =
    gameType === "daily" ? (dailyDay ? `Daily #${dailyNumber(dailyDay)}` : "Daily") : gameType === "peer" ? `Race vs ${opponent?.name ?? "…"}` : "Practice";
  const canGiveUp = gameType !== "peer" && !isGameOver && !loadingPair && Boolean(targetPair);
  const gameOverTitle = gaveUp
    ? "You gave up"
    : gameType === "peer"
    ? raceWinner === "me"
      ? "You won the race!"
      : hasWon
      ? "Finished 2nd"
      : `${opponent?.name ?? "Your opponent"} won`
    : "Bridge complete!";

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-zinc-100 flex flex-col items-center justify-between p-2 sm:p-4 selection:bg-zinc-800 selection:text-white">
      {rulesSheet}
      {/* Header (shrink-0) */}
      <header className="w-full max-w-xl flex items-center justify-between gap-2 py-1.5 sm:py-2 border-b border-zinc-800/40 mb-2 sm:mb-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={goHome} className="text-sm text-zinc-400 hover:text-white transition-colors shrink-0">
            ← Exit
          </button>
          <span className="text-sm font-medium text-zinc-200 truncate">{modeLabel}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canGiveUp && (
            <button onClick={handleGiveUp} className="text-sm text-zinc-400 hover:text-white px-2 py-1 transition">
              Give up
            </button>
          )}
          {helpButton}
        </div>
      </header>

      {/* Main Game Container */}
      <main className="w-full max-w-xl flex-1 flex flex-col justify-between bg-zinc-950 border border-zinc-800/40 rounded-xl sm:rounded-2xl p-3 sm:p-5 shadow-xl relative min-h-0 overflow-hidden">
        {pairError ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-0 space-y-3 text-center">
            <p className="text-sm text-rose-400">{pairError}</p>
            <button
              onClick={() => initGame(gameType === "daily" ? "daily" : "solo")}
              className="px-5 py-2 bg-white text-black font-semibold rounded-xl text-sm hover:bg-zinc-200 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : loadingPair || !targetPair ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-0 space-y-3">
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin"></div>
            <p className="text-sm text-zinc-400">Picking your words…</p>
          </div>
        ) : (
          <>
            {/* Top pinned block: Opponent + Goal Card + Closeness (shrink-0) */}
            <div className="shrink-0 space-y-2 mb-2">
              {gameType === "peer" && opponent && (
                <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-zinc-200 flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${opponentConnected ? "bg-emerald-400" : "bg-zinc-600 animate-pulse"}`}></span>
                      <span className="truncate">{opponent.name}</span>
                    </span>
                    <span className="text-zinc-400 text-xs shrink-0">
                      {!opponentConnected
                        ? "Connecting…"
                        : `${opponent.steps.length} ${opponent.steps.length === 1 ? "step" : "steps"}${opponent.hasWon ? " · finished" : ""}`}
                    </span>
                  </div>
                  {opponent.steps.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto">
                      {opponent.steps.map((st, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md text-xs font-mono border border-zinc-800 bg-zinc-950 text-zinc-300 shrink-0">
                          {st.relatedness}%
                        </span>
                      ))}
                      <span className="text-xs text-zinc-500 shrink-0 pl-1">words hidden</span>
                    </div>
                  )}
                </div>
              )}

              {/* Start → Target */}
              <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-2.5 sm:p-3.5">
                <div className="flex items-center justify-between gap-2 sm:gap-3">
                  {[
                    { label: "Start", word: targetPair.source },
                    { label: "Target", word: targetPair.target },
                  ].map((card, i) => (
                    <div key={card.label} className="contents">
                      {i === 1 && <span className="text-base text-zinc-500 shrink-0">→</span>}
                      <button
                        type="button"
                        onClick={() => handleToggleDefinition(card.word)}
                        className={`flex-1 min-w-0 rounded-xl p-2 sm:p-2.5 text-center transition select-none border active:scale-[0.98] ${
                          activeDefinition?.word === card.word.toLowerCase()
                            ? "bg-zinc-900 border-zinc-600"
                            : "bg-zinc-950/60 border-zinc-800/40 hover:border-zinc-700"
                        }`}
                        aria-label={`Definition of ${card.word}`}
                      >
                        <span className="text-xs text-zinc-400 block">{card.label} · tap for meaning</span>
                        <span className="text-lg sm:text-xl font-bold tracking-tight text-white capitalize truncate block">{card.word}</span>
                      </button>
                    </div>
                  ))}
                </div>

                {activeDefinition && (
                  <div className="mt-2 pt-2 border-t border-zinc-800 text-left">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white capitalize text-sm">{activeDefinition.word}</span>
                        {activeDefinition.partOfSpeech && <span className="text-xs italic text-zinc-400">{activeDefinition.partOfSpeech}</span>}
                        {activeDefinition.loading && <span className="w-3 h-3 border border-zinc-500 border-t-white rounded-full animate-spin"></span>}
                      </div>
                      <button type="button" onClick={() => setActiveDefinition(null)} className="text-zinc-500 hover:text-white text-sm px-1.5" aria-label="Close definition">
                        ✕
                      </button>
                    </div>
                    <p className="text-zinc-300 text-sm leading-relaxed max-h-20 overflow-y-auto">{activeDefinition.definition}</p>
                  </div>
                )}
              </div>

              {/* Closeness to target */}
              <div className="px-3 sm:px-4 py-2 bg-zinc-900/40 border border-zinc-800/30 rounded-xl flex items-center justify-between gap-3 text-sm">
                <span className="text-zinc-400">
                  Closeness to target <b className="text-white font-mono">{targetProximity}%</b>
                  {proximityDelta === "hotter" && <span className="text-emerald-400"> · warmer</span>}
                  {proximityDelta === "colder" && <span className="text-sky-400"> · colder</span>}
                </span>
                <div className="w-16 sm:w-24 bg-zinc-800 h-1.5 rounded-full overflow-hidden shrink-0">
                  <div className="h-full bg-zinc-200 transition-all duration-300" style={{ width: `${Math.min(100, targetProximity)}%` }}></div>
                </div>
              </div>
            </div>

            {/* Middle: path (flex-1 min-h-0 overflow-y-auto) */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5 mb-2" ref={scrollRef}>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1 sticky top-0 bg-zinc-950/95 py-0.5 z-10 backdrop-blur-sm">
                <span>Your path</span>
                <span>
                  Misses <b className="text-zinc-200 font-mono">{failedAttempts}</b>
                </span>
              </div>

              {history.map((step, idx) => {
                const isStart = idx === 0;
                const isTarget = step.word.toLowerCase() === targetWord.toLowerCase();
                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition ${
                      isTarget ? "bg-zinc-200 text-black border-transparent font-semibold" : "bg-zinc-900/30 border-zinc-800/30 text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`font-mono text-xs ${isTarget ? "text-zinc-600" : "text-zinc-500"}`}>{idx + 1}</span>
                      <span className="capitalize font-medium">{step.word}</span>
                    </div>
                    <span className={`text-xs ${isTarget ? "text-zinc-700 font-semibold" : "text-zinc-400"} ${isStart ? "" : "font-mono"}`}>
                      {isStart ? "Start" : `${step.relatednessToPrevious}%`}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Bottom pinned block: feedback + input, or the result card (shrink-0) */}
            <div className="shrink-0 space-y-2 pt-2 border-t border-zinc-900/80">
              {feedback && (
                <div
                  className={`px-3 py-2 rounded-xl text-sm border flex items-center justify-between gap-3 ${
                    feedback.type === "success"
                      ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-300"
                      : feedback.type === "warning"
                      ? "bg-amber-950/30 border-amber-900/40 text-amber-300"
                      : "bg-rose-950/30 border-rose-900/40 text-rose-300"
                  }`}
                >
                  <span className="truncate">{feedback.message}</span>
                  {feedback.score !== undefined && <span className="font-mono font-semibold shrink-0">{feedback.score}%</span>}
                </div>
              )}

              {isGameOver ? (
                <div className="p-4 sm:p-5 bg-zinc-900/80 border border-zinc-800/40 rounded-xl text-center space-y-3 max-h-[55dvh] overflow-y-auto">
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-white">{gameOverTitle}</p>
                    {finalScore && !gaveUp ? (
                      <>
                        <p className="text-4xl font-bold font-mono tracking-tight text-white">{finalScore.totalScore.toLocaleString()}</p>
                        <p className="text-sm text-zinc-300">
                          Rank {finalScore.rank} · {finalScore.title}
                        </p>
                        <p className="text-sm text-zinc-400">
                          {history.length - 1} {history.length - 1 === 1 ? "step" : "steps"} · {failedAttempts} {failedAttempts === 1 ? "miss" : "misses"}
                        </p>
                      </>
                    ) : gaveUp ? (
                      <p className="text-sm text-zinc-400">No score this time.</p>
                    ) : (
                      <p className="text-sm text-zinc-400">They reached the target first.</p>
                    )}
                  </div>

                  {finalScore && !gaveUp && (
                    <div>
                      <button onClick={() => setShowScoreDetails((v) => !v)} className="text-sm text-zinc-400 hover:text-white underline underline-offset-2">
                        {showScoreDetails ? "Hide score details" : "How was this scored?"}
                      </button>
                      {showScoreDetails && (
                        <div className="grid grid-cols-2 gap-1.5 text-sm mt-2 text-left">
                          <div className="bg-zinc-950 rounded-lg p-2"><div className="text-xs text-zinc-400">Difficulty</div><div className="font-mono text-white">+{finalScore.difficultyBonus.toLocaleString()}</div></div>
                          <div className="bg-zinc-950 rounded-lg p-2"><div className="text-xs text-zinc-400">Steps</div><div className="font-mono text-white">+{finalScore.stepEfficiency.toLocaleString()}</div></div>
                          <div className="bg-zinc-950 rounded-lg p-2"><div className="text-xs text-zinc-400">Link strength ({finalScore.averageSimilarity}%)</div><div className="font-mono text-white">+{finalScore.linkQuality.toLocaleString()}</div></div>
                          <div className="bg-zinc-950 rounded-lg p-2"><div className="text-xs text-zinc-400">Misses</div><div className="font-mono text-zinc-300">−{finalScore.missPenalty.toLocaleString()}</div></div>
                        </div>
                      )}
                    </div>
                  )}

                  {gaveUp && bestPath && (
                    <p className="text-sm text-zinc-300 break-words text-left bg-zinc-950 rounded-lg p-2.5">
                      <span className="text-zinc-400">Today&apos;s best path: </span>
                      {bestPath.join(" → ")}
                    </p>
                  )}

                  {gameType === "peer" && opponent?.finalHistory && (
                    <div className="text-sm text-left space-y-1 bg-zinc-950 rounded-lg p-2.5">
                      <p className="text-zinc-300 break-words">
                        <span className="text-white font-semibold">You: </span>
                        {history.map((s) => s.word).join(" → ")}
                      </p>
                      <p className="text-zinc-400 break-words">
                        <span className="text-zinc-200 font-semibold">{opponent.name}: </span>
                        {opponent.finalHistory.join(" → ")}
                      </p>
                    </div>
                  )}

                  {gameType === "daily" && (
                    <div className="bg-zinc-950 rounded-lg p-2.5 space-y-2">
                      {dailyRanked ? (
                        <DailyLeaderboard compact refreshKey={`${history.length}-${gaveUp}`} />
                      ) : (
                        <p className="text-sm text-zinc-400 text-left">
                          This run isn&apos;t ranked.{" "}
                          {authEnabled && (
                            <button onClick={signInWithGoogle} className="text-white underline underline-offset-2">
                              Sign in
                            </button>
                          )}{" "}
                          to get one ranked try a day, a streak, and a spot on the leaderboard.
                        </p>
                      )}
                      <p className="text-xs text-zinc-500">
                        <Countdown prefix="Next puzzle in" />
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {finalScore && !gaveUp && (
                      <button onClick={shareResult} className="flex-1 py-2.5 bg-white text-black font-semibold rounded-xl text-sm hover:bg-zinc-200 transition-colors">
                        {copied ? "Copied!" : "Share"}
                      </button>
                    )}
                    {gameType === "peer" ? (
                      <button
                        onClick={requestRematch}
                        disabled={rematchState === "starting"}
                        className={`flex-1 py-2.5 font-semibold rounded-xl text-sm transition-colors ${
                          rematchState === "idle" && !(finalScore && !gaveUp) ? "bg-white text-black hover:bg-zinc-200" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700"
                        }`}
                      >
                        {rematchState === "idle" ? "Rematch" : rematchState === "requested" ? "Waiting for opponent…" : "Starting…"}
                      </button>
                    ) : gameType === "daily" ? (
                      <button onClick={() => setView("leaderboard")} className="flex-1 py-2.5 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 font-semibold rounded-xl text-sm transition-colors border border-zinc-700">
                        Leaderboard
                      </button>
                    ) : (
                      <button
                        onClick={() => initGame("solo")}
                        className={`flex-1 py-2.5 font-semibold rounded-xl text-sm transition-colors ${
                          finalScore && !gaveUp ? "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700" : "bg-white text-black hover:bg-zinc-200"
                        }`}
                      >
                        New puzzle
                      </button>
                    )}
                  </div>
                  <button onClick={goHome} className="text-sm text-zinc-400 hover:text-white transition">
                    Back to menu
                  </button>
                </div>
              ) : (
                <form onSubmit={handleStepSubmit}>
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder={`A word related to "${currentWord}"`}
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
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="flex-1 min-w-0 px-3.5 py-3 bg-zinc-900/60 border border-zinc-800/50 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 font-medium text-base transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={!canSubmit || loading}
                      onMouseDown={(e) => e.preventDefault()}
                      className="py-3 px-5 bg-zinc-100 hover:bg-white active:bg-zinc-300 text-black font-semibold rounded-xl text-sm transition-colors disabled:opacity-30 shrink-0"
                    >
                      {loading ? "…" : "Go"}
                    </button>
                  </div>
                  {candidateLower && isDuplicate && <p className="text-xs text-amber-400 mt-1.5">Already in your path.</p>}
                </form>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
