import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Matter from "matter-js";
import { chooseWeightedSlot, riskMeta } from "../config/game";
import { casinoAudio } from "../lib/audio";
import { PlinkoPhysics, type VisualBall } from "../lib/physics";
import { seedToSignedOffset, seedToUnitInterval } from "../lib/provablyFair";
import { useGameStore } from "../store/gameStore";
import type { RiskLevel } from "../types";
import { ActiveRisks } from "./ActiveRisks";
import { MultiplierSlots } from "./MultiplierSlots";

interface DrawState {
  width: number;
  height: number;
  theme: "dark" | "extra-dark";
}

function draw(engine: PlinkoPhysics, ctx: CanvasRenderingContext2D, state: DrawState) {
  const { width, height, theme } = state;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, theme === "extra-dark" ? "#05070A" : "#0B0F14");
  bg.addColorStop(0.48, "#101926");
  bg.addColorStop(1, theme === "extra-dark" ? "#030507" : "#0B0F14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, height * 0.42, 20, width / 2, height * 0.42, height * 0.72);
  glow.addColorStop(0, "rgba(6,182,212,0.2)");
  glow.addColorStop(0.45, "rgba(34,197,94,0.07)");
  glow.addColorStop(1, "rgba(6,182,212,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  engine.pegs.forEach((peg) => {
    const radius = (peg as Matter.Body & { circleRadius: number }).circleRadius;
    const pulse = engine.pulses.find((candidate) => Math.hypot(candidate.x - peg.position.x, candidate.y - peg.position.y) < radius * 1.5);
    const pegGlow = ctx.createRadialGradient(peg.position.x, peg.position.y, 1, peg.position.x, peg.position.y, radius * (pulse ? 8 : 4.8));
    pegGlow.addColorStop(0, pulse ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.22)");
    pegGlow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = pegGlow;
    ctx.beginPath();
    ctx.arc(peg.position.x, peg.position.y, radius * (pulse ? 8 : 4.8), 0, Math.PI * 2);
    ctx.fill();

    const pegFill = ctx.createRadialGradient(peg.position.x - radius * 0.3, peg.position.y - radius * 0.35, 1, peg.position.x, peg.position.y, radius);
    pegFill.addColorStop(0, "#FFFFFF");
    pegFill.addColorStop(0.75, "#CBD5E1");
    pegFill.addColorStop(1, "#64748B");
    ctx.fillStyle = pegFill;
    ctx.beginPath();
    ctx.arc(peg.position.x, peg.position.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.save();
  ctx.strokeStyle = "rgba(148,163,184,0.42)";
  ctx.lineWidth = 2;
  if (engine.dividers.length > 1) {
    const first = engine.dividers[0];
    const last = engine.dividers[engine.dividers.length - 1];
    ctx.beginPath();
    ctx.moveTo(first.position.x, first.bounds.min.y);
    ctx.lineTo(last.position.x, last.bounds.min.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(first.position.x, first.bounds.max.y);
    ctx.lineTo(last.position.x, last.bounds.max.y);
    ctx.stroke();
  }
  engine.dividers.forEach((divider) => {
    ctx.beginPath();
    ctx.moveTo(divider.position.x, divider.bounds.min.y);
    ctx.lineTo(divider.position.x, divider.bounds.max.y);
    ctx.stroke();
  });
  ctx.restore();

  engine.particles.forEach((particle) => {
    ctx.globalAlpha = particle.life;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 2.2 * particle.life, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  engine.balls.forEach((ball) => {
    if (ball.settled) return;
    const radius = (ball.body as Matter.Body & { circleRadius: number }).circleRadius;

    ball.trail.forEach((point, index) => {
      const alpha = index / Math.max(1, ball.trail.length);
      ctx.fillStyle = `${ball.color}${Math.round(alpha * 28).toString(16).padStart(2, "0")}`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * alpha * 0.6, 0, Math.PI * 2);
      ctx.fill();
    });

    const { x, y } = ball.body.position;

    ctx.fillStyle = ball.color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.88)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  });
}

export function PlinkoBoard() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PlinkoPhysics | null>(null);
  const lastSpawnRef = useRef(0);
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null);
  const settings = useGameStore((state) => state.settings);
  const consumeDrop = useGameStore((state) => state.consumeDrop);
  const settleDrop = useGameStore((state) => state.settleDrop);
  const settingsRef = useRef(settings);
  const settleDropRef = useRef(settleDrop);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    settleDropRef.current = settleDrop;
  }, [settleDrop]);

  useEffect(() => {
    engineRef.current = new PlinkoPhysics({
      onPegHit: (_x: number, _y: number, risk: RiskLevel) => {
        const audioSettings = settingsRef.current;
        casinoAudio.play("peg", audioSettings.volume, audioSettings.muted, risk);
      },
      onSettle: (result) => {
        const audioSettings = settingsRef.current;
        settleDropRef.current(result);
        casinoAudio.play(result.multiplier >= 10 ? "bigWin" : "win", audioSettings.volume, audioSettings.muted, result.risk);
      }
    });

    return () => {
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    let resizeTimer = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const nextSize = { width: rect.width, height: rect.height };
        if (!engine.hasActiveBalls()) {
          engine.rebuild(nextSize, settings.rows);
          pendingResizeRef.current = null;
        } else {
          pendingResizeRef.current = nextSize;
        }
      }, 80);
    };

    const rect = canvas.getBoundingClientRect();
    engine.rebuild({ width: rect.width, height: rect.height }, settings.rows);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      window.clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [settings.rows]);

  useEffect(() => {
    let raf = 0;
    let disposed = false;

    const tick = (now: number) => {
      if (disposed) return;
      const canvas = canvasRef.current;
      const engine = engineRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx && engine) {
        const liveSettings = settingsRef.current;
        const queuedCount = useGameStore.getState().queuedDrops.length;
        const spawnGap = liveSettings.turbo ? 65 : 115;
        if (queuedCount > 0 && now - lastSpawnRef.current > spawnGap) {
          const drop = consumeDrop();
          if (drop) {
            lastSpawnRef.current = now;
            void Promise.all([
              seedToSignedOffset(drop.clientSeed, drop.serverSeedHash, drop.nonce),
              seedToUnitInterval(drop.clientSeed, drop.serverSeedHash, drop.nonce + 100_000)
            ]).then(([offset, outcomeUnit]) => {
              if (disposed || !engineRef.current) return;
              engineRef.current.drop(
                {
                  ...drop,
                  targetSlot: chooseWeightedSlot(drop.rows, drop.risk, outcomeUnit)
                },
                offset
              );
              const audioSettings = settingsRef.current;
              casinoAudio.play("drop", audioSettings.volume, audioSettings.muted, drop.risk);
            });
          }
        }

        engine.update(now, liveSettings.turbo);
        if (!engine.hasActiveBalls() && pendingResizeRef.current) {
          engine.rebuild(pendingResizeRef.current, liveSettings.rows);
          pendingResizeRef.current = null;
        }
        draw(engine, ctx, {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          theme: liveSettings.theme
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [consumeDrop]);

  return (
    <motion.section
      className="glass-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px]"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
    >
      <div className="pointer-events-none relative z-10 flex justify-center px-3 pt-4">
        <ActiveRisks />
      </div>
      <canvas ref={canvasRef} className="h-full min-h-[430px] w-full flex-1" />
      <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10">
        <MultiplierSlots />
      </div>
    </motion.section>
  );
}
