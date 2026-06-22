import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatMoney, formatMultiplier, riskMeta } from "./config/game";
import { useGameStore } from "./store/gameStore";
import { BottomControls } from "./components/BottomControls";
import { PlinkoBoard } from "./components/PlinkoBoard";
import { SettingsModal } from "./components/SettingsModal";
import { StatsPanel } from "./components/StatsPanel";
import { TopBar } from "./components/TopBar";

function RecentResults() {
  const rounds = useGameStore((state) => state.recentRounds);

  return (
    <aside className="glass-panel hidden w-[260px] shrink-0 rounded-[18px] p-4 2xl:block">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">Recent</h2>
        <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-black text-casino-muted">{rounds.length}</span>
      </div>
      <div className="grid gap-2">
        {rounds.length === 0 && <p className="text-sm text-casino-muted">No rounds yet.</p>}
        {rounds.map((round) => (
          <motion.div
            key={round.id}
            className="rounded-2xl border border-casino-border bg-white/[0.035] p-3"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between gap-3">
              <strong className={round.profit >= 0 ? "text-neon-green" : "text-neon-red"}>
                {round.profit >= 0 ? "+" : ""}
                {formatMoney(round.profit)}
              </strong>
              <span className="text-casino-muted">{formatMoney(round.payout)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {round.risks.map((risk) => (
                <span key={risk} className="text-[0.62rem] font-black uppercase" style={{ color: riskMeta[risk].color }}>
                  {riskMeta[risk].shortLabel}
                </span>
              ))}
            </div>
            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-casino-muted">
              {round.ballCount} balls - Stake {formatMoney(round.stake)}
            </p>
            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-casino-muted">
              Best {formatMultiplier(round.highestMultiplier)}
            </p>
          </motion.div>
        ))}
      </div>
    </aside>
  );
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const queueDrops = useGameStore((state) => state.queueDrops);
  const theme = useGameStore((state) => state.settings.theme);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        queueDrops();
      }
      if (event.key.toLowerCase() === "s") setSettingsOpen(true);
      if (event.key.toLowerCase() === "t") useGameStore.getState().setTurbo(!useGameStore.getState().settings.turbo);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [queueDrops]);

  return (
    <div className={`min-h-screen overflow-hidden ${theme === "extra-dark" ? "theme-extra-dark" : ""}`}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(6,182,212,0.12),transparent_34%)]" />
      <main className="relative z-10 flex h-screen min-h-[760px] flex-col gap-4 p-4">
        <TopBar onSettings={() => setSettingsOpen(true)} onStats={() => setStatsOpen(true)} />
        <div className="flex min-h-0 flex-1 gap-4">
          <section className="flex min-w-0 flex-1 flex-col gap-4">
            <PlinkoBoard />
            <BottomControls />
          </section>
          <RecentResults />
        </div>
      </main>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <StatsPanel open={statsOpen} onClose={() => setStatsOpen(false)} />
    </div>
  );
}
