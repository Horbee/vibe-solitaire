export type EaseFn = (t: number) => number;
export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3);

interface Tween {
  key?: string;
  startAt: number;
  duration: number;
  update: (t: number) => void;
  done: boolean;
  resolve: () => void;
}

/**
 * Minimal tween engine, ticked from the render loop.
 * Tweens with the same key cancel each other (latest wins).
 */
export class Animator {
  private tweens: Tween[] = [];
  private byKey = new Map<string, Tween>();
  private ease: EaseFn = easeOutCubic;

  tick(now = performance.now()): void {
    for (const tw of this.tweens) {
      if (tw.done || now < tw.startAt) continue;
      const raw = (now - tw.startAt) / tw.duration;
      if (raw >= 1) {
        tw.update(this.ease(1));
        tw.done = true;
        tw.resolve();
        if (tw.key) this.byKey.delete(tw.key);
      } else {
        tw.update(this.ease(Math.max(0, raw)));
      }
    }
    if (this.tweens.some((t) => t.done)) {
      this.tweens = this.tweens.filter((t) => !t.done);
    }
  }

  add(opts: {
    key?: string;
    duration?: number;
    delay?: number;
    update: (t: number) => void;
  }): Promise<void> {
    const { key, duration = 240, delay = 0, update } = opts;
    if (key) this.cancel(key);
    return new Promise((resolve) => {
      const tw: Tween = {
        key,
        startAt: performance.now() + delay,
        duration,
        update,
        done: false,
        resolve,
      };
      this.tweens.push(tw);
      if (key) this.byKey.set(key, tw);
    });
  }

  cancel(key: string): void {
    const tw = this.byKey.get(key);
    if (tw && !tw.done) {
      tw.done = true;
      tw.resolve();
      this.byKey.delete(key);
    }
  }

  cancelAll(): void {
    for (const tw of this.tweens) {
      if (!tw.done) {
        tw.done = true;
        tw.resolve();
      }
    }
    this.byKey.clear();
    this.tweens = [];
  }

  get busy(): boolean {
    return this.tweens.length > 0;
  }
}
