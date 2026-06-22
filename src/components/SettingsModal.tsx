import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useGameStore } from "../store/gameStore";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const settings = useGameStore((state) => state.settings);
  const setMuted = useGameStore((state) => state.setMuted);
  const setVolume = useGameStore((state) => state.setVolume);
  const setTurbo = useGameStore((state) => state.setTurbo);
  const newSeeds = useGameStore((state) => state.newSeeds);
  const clientSeed = useGameStore((state) => state.clientSeed);
  const serverSeedHash = useGameStore((state) => state.serverSeedHash);
  const nonce = useGameStore((state) => state.nonce);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section className="modal-card" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-white">Settings</h2>
                <p className="text-sm text-casino-muted">Audio, physics speed, and fair seeds.</p>
              </div>
              <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-5">
              <label className="settings-row">
                <span>Volume</span>
                <input type="range" min={0} max={1} step={0.01} value={settings.volume} onChange={(event) => setVolume(Number(event.target.value))} />
                <strong>{Math.round(settings.volume * 100)}%</strong>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button className={`control-button h-11 ${settings.muted ? "border-neon-red text-neon-red" : ""}`} type="button" onClick={() => setMuted(!settings.muted)}>
                  {settings.muted ? "Muted" : "Sound On"}
                </button>
                <button className={`control-button h-11 ${settings.turbo ? "border-neon-orange text-neon-orange" : ""}`} type="button" onClick={() => setTurbo(!settings.turbo)}>
                  {settings.turbo ? "Turbo On" : "Turbo Off"}
                </button>
              </div>

              <div className="rounded-2xl border border-casino-border bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h3 className="font-black text-white">Provably Fair Seeds</h3>
                  <button className="control-button h-9 text-xs" type="button" onClick={newSeeds}>
                    Rotate
                  </button>
                </div>
                <div className="grid gap-2 text-xs text-casino-muted">
                  <p><strong className="text-white">Client:</strong> {clientSeed}</p>
                  <p><strong className="text-white">Server hash:</strong> {serverSeedHash}</p>
                  <p><strong className="text-white">Nonce:</strong> {nonce}</p>
                </div>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
