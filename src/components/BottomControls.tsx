import { Play, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { MAX_MULTI_BALLS, formatMoney, riskMeta, riskOrder } from "../config/game";
import { useGameStore } from "../store/gameStore";

export function BottomControls() {
  const balance = useGameStore((state) => state.balance);
  const wager = useGameStore((state) => state.wager);
  const ballCount = useGameStore((state) => state.ballCount);
  const activeRisks = useGameStore((state) => state.activeRisks);
  const turbo = useGameStore((state) => state.settings.turbo);
  const setWager = useGameStore((state) => state.setWager);
  const setBallCount = useGameStore((state) => state.setBallCount);
  const toggleRisk = useGameStore((state) => state.toggleRisk);
  const setTurbo = useGameStore((state) => state.setTurbo);
  const queueDrops = useGameStore((state) => state.queueDrops);
  const resetDemo = useGameStore((state) => state.resetDemo);

  const maxPerDrop = Math.floor((balance / ballCount) * 100) / 100;
  const canDrop = balance > 0 && activeRisks.length > 0;

  return (
    <section className="glass-panel grid gap-4 rounded-[18px] p-4 xl:grid-cols-[1.1fr_0.9fr_auto_1.4fr_auto] xl:items-center">
      <div className="control-card">
        <label htmlFor="wager" className="control-label">
          Bet amount
        </label>
        <div className="grid grid-cols-[40px_minmax(0,1fr)_40px_56px_64px] gap-2">
          <button className="control-button" type="button" onClick={() => setWager(Math.max(0.01, wager - 0.1))}>
            -
          </button>
          <input
            id="wager"
            className="control-input"
            type="number"
            min={0.01}
            step={0.01}
            value={wager}
            onChange={(event) => setWager(Number(event.target.value))}
          />
          <button className="control-button" type="button" onClick={() => setWager(wager + 0.1)}>
            +
          </button>
          <button className="control-button text-xs" type="button" onClick={() => setWager(Math.max(0.01, wager / 2))}>
            Half
          </button>
          <button className="control-button text-xs" type="button" onClick={() => setWager(Math.min(maxPerDrop, wager * 2))}>
            Double
          </button>
        </div>
        <p className="mt-2 text-xs font-semibold text-casino-muted">Max per drop: {formatMoney(maxPerDrop)} GAMBA</p>
      </div>

      <div className="control-card">
        <label htmlFor="drops" className="control-label">
          Ball count
        </label>
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2">
          <button className="control-button" type="button" onClick={() => setBallCount(ballCount - 1)}>
            -
          </button>
          <input
            id="drops"
            className="control-input"
            type="number"
            min={1}
            max={MAX_MULTI_BALLS}
            step={1}
            value={ballCount}
            onChange={(event) => setBallCount(Number(event.target.value))}
          />
          <button className="control-button" type="button" onClick={() => setBallCount(ballCount + 1)}>
            +
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        <button
          className={`control-button h-12 ${turbo ? "border-neon-orange text-neon-orange shadow-[0_0_24px_rgba(251,146,60,0.25)]" : ""}`}
          type="button"
          onClick={() => setTurbo(!turbo)}
        >
          <Zap size={18} />
          Turbo
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {riskOrder.map((risk) => {
          const active = activeRisks.includes(risk);
          return (
            <motion.button
              key={risk}
              type="button"
              className="risk-toggle"
              onClick={() => toggleRisk(risk)}
              whileTap={{ scale: 0.96 }}
              animate={{
                y: active ? -3 : 0,
                opacity: active ? 1 : 0.42,
                boxShadow: active ? `0 0 32px ${riskMeta[risk].glow}` : "0 0 0 rgba(0,0,0,0)"
              }}
              style={{
                borderColor: active ? riskMeta[risk].color : "#253041",
                background: active
                  ? `linear-gradient(180deg, ${riskMeta[risk].color}, rgba(23,31,43,0.78))`
                  : "rgba(255,255,255,0.045)"
              }}
            >
              <span>{riskMeta[risk].shortLabel}</span>
              <small>{riskMeta[risk].rtp}% RTP</small>
            </motion.button>
          );
        })}
      </div>

      <div className="grid gap-2">
        <motion.button
          className="drop-button"
          type="button"
          disabled={!canDrop}
          onClick={queueDrops}
          whileHover={canDrop ? { scale: 1.02 } : undefined}
          whileTap={canDrop ? { scale: 0.97 } : undefined}
        >
          <Play size={19} fill="currentColor" />
          Drop {ballCount > 1 ? ballCount : ""}
        </motion.button>
        <button className="control-button h-10 text-xs" type="button" onClick={resetDemo}>
          Reset demo
        </button>
      </div>
    </section>
  );
}
