export type RiskLevel = "low" | "medium" | "high";

export type ThemeMode = "dark" | "extra-dark";

export type DropMode = "manual" | "auto";

export interface MultiplierMap {
  [rows: string]: Record<RiskLevel, number[]>;
}

export interface DropRequest {
  id: string;
  roundId: string;
  roundSize: number;
  roundStake: number;
  risk: RiskLevel;
  wager: number;
  rows: number;
  nonce: number;
  clientSeed: string;
  serverSeedHash: string;
  createdAt: number;
  turbo: boolean;
  targetSlot?: number;
}

export interface DropResult {
  id: string;
  roundId: string;
  roundSize: number;
  roundStake: number;
  risk: RiskLevel;
  wager: number;
  rows: number;
  multiplier: number;
  payout: number;
  slotIndex: number;
}

export interface RoundResult {
  id: string;
  ballCount: number;
  completed: number;
  stake: number;
  payout: number;
  profit: number;
  rows: number;
  risks: RiskLevel[];
  highestMultiplier: number;
  createdAt: number;
}

export interface RiskStats {
  bets: number;
  wins: number;
  wagered: number;
  paid: number;
  biggestWin: number;
  highestMultiplier: number;
}

export interface GameStats extends RiskStats {
  currentStreak: number;
  totalDrops: number;
  byRisk: Record<RiskLevel, RiskStats>;
}

export interface SettingsState {
  muted: boolean;
  volume: number;
  rows: number;
  turbo: boolean;
  theme: ThemeMode;
}

export interface BoardParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}
