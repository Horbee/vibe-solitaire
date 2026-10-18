import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createSoundEngine } from "../../src/audio/index";

function memStorage(): Pick<Storage, "getItem" | "setItem"> & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

/** Minimal fake AudioContext recording every scheduled voice. */
function fakeAudioContext(initialState: "running" | "suspended" = "running") {
  const started: { kind: "noise" | "osc"; at: number }[] = [];
  let currentTime = 10;
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  });
  const connect = () => undefined;
  const ctx = {
    state: initialState,
    sampleRate: 48000,
    destination: {},
    get currentTime() {
      return currentTime;
    },
    resume: () => {
      ctx.state = "running";
      return Promise.resolve();
    },
    createGain: () => ({ gain: param(), connect }),
    createBiquadFilter: () => ({ type: "lowpass", frequency: param(), connect }),
    createBufferSource: () => ({
      buffer: null as unknown,
      loop: false,
      connect,
      start: (at: number) => void started.push({ kind: "noise", at }),
      stop: () => undefined,
    }),
    createOscillator: () => ({
      type: "sine",
      frequency: param(),
      connect,
      start: (at: number) => void started.push({ kind: "osc", at }),
      stop: () => undefined,
    }),
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
  };
  return {
    ctx: ctx as unknown as AudioContext,
    started,
    set currentTime(v: number) {
      currentTime = v;
    },
  };
}

let storage: ReturnType<typeof memStorage>;
let audio: ReturnType<typeof fakeAudioContext>;
let wall: number;

function makeEngine(state: "running" | "suspended" = "running") {
  audio = fakeAudioContext(state);
  return createSoundEngine({
    storage,
    createContext: () => audio.ctx,
    now: () => wall,
  });
}

beforeEach(() => {
  storage = memStorage();
  wall = 1000;
});

describe("createSoundEngine", () => {
  it("starts unmuted with empty storage", () => {
    expect(makeEngine().muted).toBe(false);
  });

  it("persists the mute setting and reloads it", () => {
    makeEngine().setMuted(true);
    expect(storage.data.get("solitaire.audio.v1")).toBe('{"muted":true}');
    const reloaded = makeEngine();
    expect(reloaded.muted).toBe(true);
  });

  it("survives corrupt stored data", () => {
    storage.setItem("solitaire.audio.v1", "{not json");
    expect(makeEngine().muted).toBe(false);
  });

  it("schedules voices on the audio clock with the given delay", () => {
    const engine = makeEngine();
    engine.play("pickup", 150);
    expect(audio.started).toEqual([{ kind: "noise", at: 10.15 }]);
  });

  it("drops cues while the context is still suspended (autoplay lock)", () => {
    const engine = makeEngine("suspended");
    engine.play("pickup");
    expect(audio.started).toEqual([]);
    engine.resume();
    wall += 100; // past the throttle window after unlocking
    engine.play("pickup", 40);
    expect(audio.started).toEqual([{ kind: "noise", at: 10.04 }]);
  });

  it("does nothing while muted", () => {
    const engine = makeEngine();
    engine.setMuted(true);
    engine.play("pickup");
    expect(audio.started).toEqual([]);
  });

  it("throttles rapid repeats of the same cue", () => {
    const engine = makeEngine();
    engine.play("pickup");
    wall += 10; // inside the pickup throttle window
    engine.play("pickup");
    expect(audio.started).toHaveLength(1);
    wall += 100; // past the window
    engine.play("pickup");
    expect(audio.started).toHaveLength(2);
  });

  it("plays a multi-note fanfare for the win cue", () => {
    const engine = makeEngine();
    engine.play("win");
    expect(audio.started.filter((s) => s.kind === "osc").length).toBeGreaterThan(1);
  });
});
