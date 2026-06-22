import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { formatMoney, riskMeta, riskOrder } from "../config/game";
import { useGameStore } from "../store/gameStore";

interface StatsPanelProps {
  open: boolean;
  onClose: () => void;
}

function statPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

export function StatsPanel({ open, onClose }: StatsPanelProps) {
  const stats = useGameStore((state) => state.stats);
  const rtp = stats.wagered > 0 ? (stats.paid / stats.wagered) * 100 : 0;
  const winRate = stats.bets > 0 ? (stats.wins / stats.bets) * 100 : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section className="modal-card max-w-3xl" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-white">Statistics</h2>
                <p className="text-sm text-casino-muted">Tracked globally and by risk profile.</p>
              </div>
              <button className="icon-button" type="button" onClick={onClose} aria-label="Close statistics">
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Total Bets" value={String(stats.bets)} />
              <Stat label="Total Wins" value={String(stats.wins)} />
              <Stat label="Biggest Win" value={formatMoney(stats.biggestWin)} />
              <Stat label="RTP" value={statPercent(rtp)} />
              <Stat label="Win Rate" value={statPercent(winRate)} />
              <Stat label="Streak" value={String(stats.currentStreak)} />
              <Stat label="Highest Multiplier" value={`${stats.highestMultiplier || 0}x`} />
              <Stat label="Total Drops" value={String(stats.totalDrops)} />
              <Stat label="Paid Out" value={formatMoney(stats.paid)} />
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {riskOrder.map((risk) => {
                const item = stats.byRisk[risk];
                return (
                  <div key={risk} className="rounded-2xl border border-casino-border bg-white/[0.035] p-4">
                    <h3 className="mb-3 font-black uppercase" style={{ color: riskMeta[risk].color }}>
                      {riskMeta[risk].label}
                    </h3>
                    <div className="grid gap-2 text-sm text-casino-muted">
                      <p>Bets: <strong className="text-white">{item.bets}</strong></p>
                      <p>Wins: <strong className="text-white">{item.wins}</strong></p>
                      <p>Wagered: <strong className="text-white">{formatMoney(item.wagered)}</strong></p>
                      <p>Paid: <strong className="text-white">{formatMoney(item.paid)}</strong></p>
                      <p>Best: <strong className="text-white">{item.highestMultiplier || 0}x</strong></p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.section>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-casino-border bg-white/[0.035] p-4">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-casino-muted">{label}</p>
      <strong className="mt-1 block text-lg font-black text-white">{value}</strong>
    </div>
  );
}
