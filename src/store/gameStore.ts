import { create } from "zustand";
import { DEFAULT_ROWS, MAX_MULTI_BALLS, STARTING_BALANCE, riskOrder } from "../config/game";
import type { DropRequest, DropResult, GameStats, RiskLevel, RiskStats, RoundResult, SettingsState } from "../types";

const emptyRiskStats = (): RiskStats => ({
  bets: 0,
  wins: 0,
  wagered: 0,
  paid: 0,
  biggestWin: 0,
  highestMultiplier: 0
});

const emptyStats = (): GameStats => ({
  ...emptyRiskStats(),
  currentStreak: 0,
  totalDrops: 0,
  byRisk: {
    low: emptyRiskStats(),
    medium: emptyRiskStats(),
    high: emptyRiskStats()
  }
});

interface GameStore {
  balance: number;
  wager: number;
  ballCount: number;
  activeRisks: RiskLevel[];
  clientSeed: string;
  serverSeedHash: string;
  nonce: number;
  queuedDrops: DropRequest[];
  recentResults: DropResult[];
  recentRounds: RoundResult[];
  pendingRounds: Record<string, RoundResult>;
  stats: GameStats;
  settings: SettingsState;
  setWager: (value: number) => void;
  setBallCount: (value: number) => void;
  toggleRisk: (risk: RiskLevel) => void;
  setTurbo: (enabled: boolean) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  toggleTheme: () => void;
  newSeeds: () => void;
  queueDrops: () => void;
  consumeDrop: () => DropRequest | undefined;
  clearQueue: () => void;
  settleDrop: (result: DropResult) => void;
  resetDemo: () => void;
}

function makeSeed(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function balancedRisks(activeRisks: RiskLevel[], count: number) {
  const ordered = riskOrder.filter((risk) => activeRisks.includes(risk));
  if (ordered.length === 0) return Array.from({ length: count }, () => "medium" as RiskLevel);
  return Array.from({ length: count }, (_, index) => ordered[index % ordered.length]);
}

function boundedNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeBallCount(value: number, riskCount: number) {
  const rounded = Math.round(boundedNumber(value, riskCount > 1 ? riskCount : 1, MAX_MULTI_BALLS));
  if (riskCount <= 1) return rounded;
  const nextMultiple = Math.ceil(rounded / riskCount) * riskCount;
  if (nextMultiple <= MAX_MULTI_BALLS) return nextMultiple;
  return Math.floor(MAX_MULTI_BALLS / riskCount) * riskCount;
}

function updateRiskStats(stats: RiskStats, result: DropResult): RiskStats {
  const isWin = result.payout > result.wager;
  return {
    bets: stats.bets + 1,
    wins: stats.wins + (isWin ? 1 : 0),
    wagered: stats.wagered + result.wager,
    paid: stats.paid + result.payout,
    biggestWin: Math.max(stats.biggestWin, result.payout),
    highestMultiplier: Math.max(stats.highestMultiplier, result.multiplier)
  };
}

export const useGameStore = create<GameStore>((set, get) => ({
  balance: STARTING_BALANCE,
  wager: 0.3,
  ballCount: 1,
  activeRisks: ["medium"],
  clientSeed: makeSeed("client"),
  serverSeedHash: makeSeed("hash"),
  nonce: 0,
  queuedDrops: [],
  recentResults: [],
  recentRounds: [],
  pendingRounds: {},
  stats: emptyStats(),
  settings: {
    muted: false,
    volume: 0.55,
    rows: DEFAULT_ROWS,
    turbo: false,
    theme: "dark"
  },
  setWager: (value) => {
    set({ wager: boundedNumber(Math.floor(value * 100) / 100, 0.01, 1_000_000) });
  },
  setBallCount: (value) => {
    set((state) => {
      return { ballCount: normalizeBallCount(value, state.activeRisks.length) };
    });
  },
  toggleRisk: (risk) => {
    set((state) => {
      const exists = state.activeRisks.includes(risk);
      const next = exists
        ? state.activeRisks.filter((item) => item !== risk)
        : riskOrder.filter((item) => item === risk || state.activeRisks.includes(item));
      const activeRisks = next.length ? next : state.activeRisks;

      return {
        activeRisks,
        ballCount: normalizeBallCount(state.ballCount, activeRisks.length)
      };
    });
  },
  setTurbo: (enabled) => set((state) => ({ settings: { ...state.settings, turbo: enabled } })),
  setMuted: (muted) => set((state) => ({ settings: { ...state.settings, muted } })),
  setVolume: (volume) => set((state) => ({ settings: { ...state.settings, volume: boundedNumber(volume, 0, 1) } })),
  toggleTheme: () =>
    set((state) => ({
      settings: {
        ...state.settings,
        theme: state.settings.theme === "dark" ? "extra-dark" : "dark"
      }
    })),
  newSeeds: () =>
    set({
      clientSeed: makeSeed("client"),
      serverSeedHash: makeSeed("hash"),
      nonce: 0
    }),
  queueDrops: () => {
    const state = get();
    const ballCount = normalizeBallCount(state.ballCount, state.activeRisks.length);
    const requestedTotal = state.wager * ballCount;
    const cappedWholeCoinWager = Math.floor(state.balance / ballCount);
    const wager = requestedTotal > state.balance ? cappedWholeCoinWager : state.wager;

    if (wager <= 0) return;

    const total = Math.round(wager * ballCount * 100) / 100;
    const roundId = crypto.randomUUID();
    const createdAt = Date.now();
    const risks = balancedRisks(state.activeRisks, ballCount);
    const drops: DropRequest[] = Array.from({ length: ballCount }, (_, index) => ({
      id: crypto.randomUUID(),
      roundId,
      roundSize: ballCount,
      roundStake: total,
      risk: risks[index],
      wager,
      rows: state.settings.rows,
      nonce: state.nonce + index,
      clientSeed: state.clientSeed,
      serverSeedHash: state.serverSeedHash,
      createdAt,
      turbo: state.settings.turbo
    }));

    set({
      balance: Math.max(0, state.balance - total),
      wager,
      ballCount,
      nonce: state.nonce + ballCount,
      queuedDrops: [...state.queuedDrops, ...drops]
    });
  },
  consumeDrop: () => {
    const [drop, ...rest] = get().queuedDrops;
    if (!drop) return undefined;
    set({ queuedDrops: rest });
    return drop;
  },
  clearQueue: () => set({ queuedDrops: [] }),
  settleDrop: (result) => {
    set((state) => {
      const riskStats = updateRiskStats(state.stats.byRisk[result.risk], result);
      const allStats = updateRiskStats(state.stats, result);
      const isWin = result.payout > result.wager;
      const existingRound =
        state.pendingRounds[result.roundId] ??
        ({
          id: result.roundId,
          ballCount: result.roundSize,
          completed: 0,
          stake: result.roundStake,
          payout: 0,
          profit: -result.roundStake,
          rows: result.rows,
          risks: [],
          highestMultiplier: 0,
          createdAt: Date.now()
        } satisfies RoundResult);
      const nextRound: RoundResult = {
        ...existingRound,
        completed: existingRound.completed + 1,
        payout: Math.round((existingRound.payout + result.payout) * 100) / 100,
        risks: existingRound.risks.includes(result.risk) ? existingRound.risks : [...existingRound.risks, result.risk],
        highestMultiplier: Math.max(existingRound.highestMultiplier, result.multiplier)
      };
      nextRound.profit = Math.round((nextRound.payout - nextRound.stake) * 100) / 100;

      const pendingRounds = { ...state.pendingRounds, [result.roundId]: nextRound };
      const recentRounds = state.recentRounds;
      if (nextRound.completed >= nextRound.ballCount) {
        delete pendingRounds[result.roundId];
      }

      return {
        balance: state.balance + result.payout,
        recentResults: [result, ...state.recentResults].slice(0, 12),
        recentRounds:
          nextRound.completed >= nextRound.ballCount
            ? [nextRound, ...recentRounds].slice(0, 12)
            : recentRounds,
        pendingRounds,
        stats: {
          ...allStats,
          totalDrops: state.stats.totalDrops + 1,
          currentStreak: isWin ? Math.max(1, state.stats.currentStreak + 1) : Math.min(-1, state.stats.currentStreak - 1),
          byRisk: {
            ...state.stats.byRisk,
            [result.risk]: riskStats
          }
        }
      };
    });
  },
  resetDemo: () =>
    set({
      balance: STARTING_BALANCE,
      wager: 0.3,
      ballCount: 1,
      queuedDrops: [],
      recentResults: [],
      recentRounds: [],
      pendingRounds: {},
      stats: emptyStats()
    })
}));
