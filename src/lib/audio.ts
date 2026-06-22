import type { RiskLevel } from "../types";

type SoundName = "drop" | "peg" | "win" | "bigWin";

const tones: Record<SoundName, { frequency: number; duration: number; type: OscillatorType }> = {
  drop: { frequency: 190, duration: 0.08, type: "sine" },
  peg: { frequency: 680, duration: 0.035, type: "triangle" },
  win: { frequency: 520, duration: 0.18, type: "sine" },
  bigWin: { frequency: 780, duration: 0.34, type: "sawtooth" }
};

const riskFrequencies: Record<RiskLevel, number> = {
  low: 520,
  medium: 610,
  high: 720
};

export class CasinoAudio {
  private context?: AudioContext;
  private lastPeg = 0;

  private getContext() {
    if (!this.context) {
      this.context = new AudioContext();
    }
    return this.context;
  }

  play(sound: SoundName, volume: number, muted: boolean, risk?: RiskLevel) {
    if (muted || volume <= 0) return;

    const now = performance.now();
    if (sound === "peg" && now - this.lastPeg < 24) return;
    if (sound === "peg") this.lastPeg = now;

    const context = this.getContext();
    const tone = tones[sound];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequency = risk ? riskFrequencies[risk] : tone.frequency;

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.62), context.currentTime + tone.duration);

    gain.gain.setValueAtTime(volume * 0.18, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + tone.duration);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + tone.duration);
  }
}

export const casinoAudio = new CasinoAudio();
