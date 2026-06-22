import { motion } from "framer-motion";
import { formatMultiplier, getMultipliers, riskMeta, riskOrder } from "../config/game";
import { useGameStore } from "../store/gameStore";

export function MultiplierSlots() {
  const rows = useGameStore((state) => state.settings.rows);
  const activeRisks = useGameStore((state) => state.activeRisks);
  const last = useGameStore((state) => state.recentResults[0]);

  return (
    <div className="mx-auto grid w-full max-w-[780px] gap-1 px-3">
      {riskOrder.map((risk) => {
        const multipliers = getMultipliers(rows, risk);
        const active = activeRisks.includes(risk);

        return (
          <div
            key={risk}
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${multipliers.length}, minmax(0, 1fr))`,
              opacity: active ? 1 : 0.34
            }}
          >
            {multipliers.map((multiplier, index) => {
              const hit = last?.risk === risk && last.slotIndex === index;
              return (
                <motion.div
                  key={`${risk}-${index}`}
                  className="multiplier-cell"
                  animate={{
                    scale: hit ? [1, 1.16, 1] : 1,
                    boxShadow: hit ? [`0 0 0 ${riskMeta[risk].glow}`, `0 0 28px ${riskMeta[risk].glow}`, `0 0 10px ${riskMeta[risk].glow}`] : `0 0 8px ${riskMeta[risk].glow}`
                  }}
                  transition={{ duration: 0.42 }}
                  style={{
                    background: `linear-gradient(180deg, ${riskMeta[risk].color}, rgba(11,15,20,0.62))`,
                    borderColor: hit ? "#FFFFFF" : `${riskMeta[risk].color}66`
                  }}
                >
                  {formatMultiplier(multiplier)}
                </motion.div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
