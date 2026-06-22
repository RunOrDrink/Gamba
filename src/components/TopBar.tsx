import { BarChart3, Moon, Settings, Volume2, VolumeX } from "lucide-react";
import { motion } from "framer-motion";
import { formatMoney } from "../config/game";
import { useGameStore } from "../store/gameStore";

interface TopBarProps {
  onSettings: () => void;
  onStats: () => void;
}

export function TopBar({ onSettings, onStats }: TopBarProps) {
  const balance = useGameStore((state) => state.balance);
  const muted = useGameStore((state) => state.settings.muted);
  const setMuted = useGameStore((state) => state.setMuted);
  const toggleTheme = useGameStore((state) => state.toggleTheme);

  return (
    <header className="glass-panel flex h-[66px] items-center justify-between gap-4 px-5">
      <div className="flex items-center gap-3">
        <motion.div
          className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-neon-green via-neon-cyan to-neon-blue shadow-glowGreen"
          whileHover={{ scale: 1.04 }}
        >
          <span className="text-lg font-black text-white">P</span>
        </motion.div>
        <div>
          <h1 className="text-lg font-black tracking-tight text-white">Plinko</h1>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-casino-muted">Gamba Casino</p>
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 lg:block" />

      <div className="flex items-center gap-2">
        <div className="rounded-2xl border border-casino-border bg-casino-card/80 px-4 py-2 text-right shadow-glass">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-casino-muted">Balance</p>
          <strong className="text-sm font-black text-white">{formatMoney(balance)} GAMBA</strong>
        </div>
        <button className="icon-button" type="button" onClick={() => setMuted(!muted)} aria-label="Toggle sound">
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <button className="icon-button" type="button" onClick={toggleTheme} aria-label="Toggle theme">
          <Moon size={18} />
        </button>
        <button className="icon-button" type="button" onClick={onStats} aria-label="Open statistics">
          <BarChart3 size={18} />
        </button>
        <button className="icon-button" type="button" onClick={onSettings} aria-label="Open settings">
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
