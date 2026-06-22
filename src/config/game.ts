import multipliers from "./multipliers.json";
import slotChances from "./slot-chances.json";
import type { MultiplierMap, RiskLevel } from "../types";

export const STARTING_BALANCE = 29551.43;
export const MIN_ROWS = 14;
export const MAX_ROWS = 14;
export const DEFAULT_ROWS = 14;
export const MAX_MULTI_BALLS = 100;

export const multiplierTable = multipliers as MultiplierMap;
export const slotChanceTable = slotChances as MultiplierMap;

export const targetRtp: Record<RiskLevel, number> = {
  low: 60,
  medium: 40,
  high: 20
};

export const houseFeePercent: Record<RiskLevel, number> = {
  low: 100 - targetRtp.low,
  medium: 100 - targetRtp.medium,
  high: 100 - targetRtp.high
};

export const riskMeta: Record<
  RiskLevel,
  {
    label: string;
    shortLabel: string;
    color: string;
    glow: string;
    rtp: number;
  }
> = {
  low: {
    label: "Low Risk",
    shortLabel: "Green",
    color: "#22C55E",
    glow: "rgba(34, 197, 94, 0.45)",
    rtp: targetRtp.low
  },
  medium: {
    label: "Medium Risk",
    shortLabel: "Yellow",
    color: "#F59E0B",
    glow: "rgba(245, 158, 11, 0.45)",
    rtp: targetRtp.medium
  },
  high: {
    label: "High Risk",
    shortLabel: "Red",
    color: "#EF4444",
    glow: "rgba(239, 68, 68, 0.48)",
    rtp: targetRtp.high
  }
};

export const riskOrder: RiskLevel[] = ["low", "medium", "high"];

export function clampRows(_rows: number) {
  return DEFAULT_ROWS;
}

export function getMultipliers(rows: number, risk: RiskLevel) {
  const key = String(clampRows(rows));
  return multiplierTable[key]?.[risk] ?? multiplierTable[String(DEFAULT_ROWS)][risk];
}

export function getSlotChances(rows: number, risk: RiskLevel) {
  const key = String(clampRows(rows));
  return slotChanceTable[key]?.[risk] ?? slotChanceTable[String(DEFAULT_ROWS)][risk];
}

export function chooseWeightedSlot(rows: number, risk: RiskLevel, unit: number) {
  const chances = getSlotChances(rows, risk);
  const total = chances.reduce((sum, chance) => sum + chance, 0);
  let cursor = Math.min(0.999999999999, Math.max(0, unit)) * total;

  for (let index = 0; index < chances.length; index += 1) {
    cursor -= chances[index];
    if (cursor <= 0) return index;
  }

  return chances.length - 1;
}

export function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatMultiplier(value: number) {
  return Number.isInteger(value)
    ? `${value}x`
    : `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
}

