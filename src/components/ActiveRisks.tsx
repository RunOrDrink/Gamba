import { motion } from "framer-motion";
import { riskMeta, riskOrder } from "../config/game";
import { useGameStore } from "../store/gameStore";

export function ActiveRisks() {
  const activeRisks = useGameStore((state) => state.activeRisks);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="text-xs font-black uppercase tracking-[0.22em] text-casino-muted">Active risks</span>
      {riskOrder
        .filter((risk) => activeRisks.includes(risk))
        .map((risk) => (
          <motion.span
            key={risk}
            className="rounded-full border px-3 py-1 text-xs font-black uppercase"
            style={{
              borderColor: riskMeta[risk].color,
              color: riskMeta[risk].color,
              boxShadow: `0 0 22px ${riskMeta[risk].glow}`
            }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {riskMeta[risk].shortLabel}
          </motion.span>
        ))}
    </div>
  );
}
