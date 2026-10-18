/**
 * Procedural WebAudio sound effects — synthesized from oscillators and
 * filtered noise, no asset files.
 *
 * This module sits beside `src/game/` and imports nothing from the other
 * layers: render/controller emit cues, the HUD owns the mute toggle, and
 * `main.ts` wires everything together.
 *
 * Timing: `play(cue, delayMs)` schedules voices against the AudioContext
 * clock, so cues line up with animation tweens regardless of frame jank.
 * Before the first user gesture the context is suspended (autoplay policy)
 * and cues are silently dropped; `resume()` unlocks it from a pointerdown.
 */

export type SoundCue = "deal" | "flip" | "recycle" | "pickup" | "land" | "invalid" | "win";

export interface SoundEngine {
  readonly muted: boolean;
  /** Persisted mute toggle (HUD button). */
  setMuted(muted: boolean): void;
  /** Unlock the AudioContext; call from a user gesture. Idempotent. */
  resume(): void;
  /** Schedule a cue `delayMs` milliseconds from now. */
  play(cue: SoundCue, delayMs?: number): void;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "solitaire.audio.v1";

/** Per-cue peak gains. */
const GAIN: Record<SoundCue, number> = {
  deal: 0.14,
  flip: 0.2,
  recycle: 0.08,
  pickup: 0.07,
  land: 0.26,
  invalid: 0.22,
  win: 0.2,
};

/** Minimum wall-clock gap before the same cue may sound again. Rapid
 * sequences (deal stagger, recycle ripple, solve playback, undo bursts)
 * stay percussive instead of clipping. */
const THROTTLE_MS: Record<SoundCue, number> = {
  deal: 18,
  flip: 45,
  recycle: 22,
  pickup: 45,
  land: 35,
  invalid: 90,
  win: 800,
};

/** Win fanfare: C5 E5 G5 C6 E6 arpeggio. */
const WIN_NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.51];
const WIN_NOTE_DURATION = 0.22;
const WIN_NOTE_STAGGER = 0.11;

function loadMuted(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as { muted?: unknown }).muted === true;
  } catch {
    return false;
  }
}

/** Filtered noise burst with an exponential decay — the base of every
 * whoosh/tick/thock. */
function noiseVoice(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  opts: { type: BiquadFilterType; from: number; to?: number; duration: number; gain: number },
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true; // buffer is only 0.5 s; voices can outlast it when delayed far out
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.setValueAtTime(opts.from, at);
  if (opts.to !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(opts.to, at + opts.duration);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + opts.duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(out);
  src.start(at);
  src.stop(at + opts.duration + 0.02);
}

/** Oscillator blip with an exponential decay (thumps, bonks, fanfare notes). */
function toneVoice(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  opts: { type: OscillatorType; from: number; to?: number; duration: number; gain: number },
): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, at);
  if (opts.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(opts.to, at + opts.duration);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + opts.duration);
  osc.connect(g);
  g.connect(out);
  osc.start(at);
  osc.stop(at + opts.duration + 0.02);
}

type Voice = (ctx: AudioContext, out: GainNode, at: number) => void;

const VOICES: Record<SoundCue, Voice> = {
  // Card sliding off the deck: soft lowpass sweep.
  deal: (ctx, out, at) =>
    noiseVoice(ctx, out, at, {
      type: "lowpass",
      from: 1400,
      to: 350,
      duration: 0.15,
      gain: GAIN.deal,
    }),
  // Face turn: bandpass sweep up, peaked mid-flip.
  flip: (ctx, out, at) =>
    noiseVoice(ctx, out, at, {
      type: "bandpass",
      from: 700,
      to: 2600,
      duration: 0.13,
      gain: GAIN.flip,
    }),
  // Single dry tick of the waste->stock sweep.
  recycle: (ctx, out, at) =>
    noiseVoice(ctx, out, at, { type: "highpass", from: 1800, duration: 0.04, gain: GAIN.recycle }),
  // Small tick when a drag activates.
  pickup: (ctx, out, at) =>
    noiseVoice(ctx, out, at, { type: "highpass", from: 1600, duration: 0.03, gain: GAIN.pickup }),
  // Card settling onto a pile: noise "thock" plus a low knock.
  land: (ctx, out, at) => {
    noiseVoice(ctx, out, at, { type: "bandpass", from: 900, duration: 0.06, gain: GAIN.land });
    toneVoice(ctx, out, at, {
      type: "sine",
      from: 170,
      to: 85,
      duration: 0.08,
      gain: GAIN.land * 0.8,
    });
  },
  // Rejected move: low descending bonk.
  invalid: (ctx, out, at) =>
    toneVoice(ctx, out, at, {
      type: "triangle",
      from: 130,
      to: 72,
      duration: 0.14,
      gain: GAIN.invalid,
    }),
  win: (ctx, out, at) => {
    WIN_NOTES.forEach((freq, i) =>
      toneVoice(ctx, out, at + i * WIN_NOTE_STAGGER, {
        type: "triangle",
        from: freq,
        duration: WIN_NOTE_DURATION,
        gain: GAIN.win,
      }),
    );
  },
};

const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

export function createSoundEngine(
  options: {
    storage?: StorageLike | null;
    createContext?: () => AudioContext;
    now?: () => number;
  } = {},
): SoundEngine {
  const storage =
    options.storage !== undefined
      ? options.storage
      : typeof window !== "undefined"
        ? window.localStorage
        : null;
  const createContext = options.createContext ?? (() => new AudioContext());
  const now = options.now ?? (() => performance.now());

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = loadMuted(storage);
  const lastPlayed = new Map<SoundCue, number>();

  function ensureContext(): AudioContext | null {
    if (ctx) return ctx;
    try {
      ctx = createContext();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      return ctx;
    } catch {
      ctx = null;
      master = null;
      return null;
    }
  }

  return {
    get muted() {
      return muted;
    },

    setMuted(next: boolean): void {
      muted = next;
      if (!storage) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ muted }));
      } catch {
        // Storage unavailable (private mode etc.): mute stays best-effort.
      }
    },

    resume(): void {
      const c = ensureContext();
      if (c && c.state === "suspended") void c.resume();
    },

    play(cue: SoundCue, delayMs = 0): void {
      if (muted) return;
      const t = now();
      const last = lastPlayed.get(cue);
      if (last !== undefined && t - last < THROTTLE_MS[cue]) return;
      lastPlayed.set(cue, t);

      const c = ensureContext();
      // Not unlocked by a user gesture yet: drop the cue rather than
      // queueing sounds that would burst out on resume.
      if (!c || !master || c.state !== "running") return;
      const at = c.currentTime + Math.max(0, delayMs) / 1000;
      VOICES[cue](c, master, at);
    },
  };
}
