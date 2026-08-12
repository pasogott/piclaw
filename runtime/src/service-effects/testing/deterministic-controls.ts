import type { EffectClock, EffectIdSource } from "../contracts/common.js";

export class ManualEffectClock implements EffectClock {
  #nowMs: number;

  constructor(initial: Date | string = "2000-01-01T00:00:00.000Z") {
    const nowMs = new Date(initial).getTime();
    if (!Number.isFinite(nowMs)) throw new TypeError("Manual clock requires a valid initial instant.");
    this.#nowMs = nowMs;
  }

  now(): Date {
    return new Date(this.#nowMs);
  }

  advance(milliseconds: number): Date {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new TypeError("Manual clock advances by a non-negative safe integer.");
    }
    this.#nowMs += milliseconds;
    return this.now();
  }
}

export class SequenceEffectIdSource implements EffectIdSource {
  #next = 1;

  constructor(
    private readonly prefix = "effect",
    private readonly width = 4,
  ) {
    if (!prefix) throw new TypeError("ID prefix must be non-empty.");
    if (!Number.isSafeInteger(width) || width < 1) throw new TypeError("ID width must be positive.");
  }

  nextId(): string {
    const id = `${this.prefix}-${String(this.#next).padStart(this.width, "0")}`;
    this.#next += 1;
    return id;
  }
}

export class ControlledBarrier {
  #released = false;
  #waiters: Array<() => void> = [];

  get released(): boolean {
    return this.#released;
  }

  wait(): Promise<void> {
    if (this.#released) return Promise.resolve();
    return new Promise<void>((resolve) => this.#waiters.push(resolve));
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    for (const resolve of this.#waiters.splice(0)) resolve();
  }
}

export type EffectReleasePoint = "before_effect" | "after_effect" | "after_acknowledgement";

/** Independently release effect and acknowledgement boundaries without timers. */
export class EffectInterleavingController {
  readonly #barriers = new Map<EffectReleasePoint, ControlledBarrier>([
    ["before_effect", new ControlledBarrier()],
    ["after_effect", new ControlledBarrier()],
    ["after_acknowledgement", new ControlledBarrier()],
  ]);

  waitAt(point: EffectReleasePoint): Promise<void> {
    return this.#barriers.get(point)!.wait();
  }

  release(point: EffectReleasePoint): void {
    this.#barriers.get(point)!.release();
  }

  isReleased(point: EffectReleasePoint): boolean {
    return this.#barriers.get(point)!.released;
  }
}

export class DelayedCompletion<T> {
  #settled = false;
  #ignoredLateResults = 0;
  #resolve!: (value: T | PromiseLike<T>) => void;
  #reject!: (reason?: unknown) => void;
  readonly promise: Promise<T>;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  get settled(): boolean {
    return this.#settled;
  }

  get ignoredLateResults(): number {
    return this.#ignoredLateResults;
  }

  resolve(value: T): void {
    this.assertPending();
    this.#settled = true;
    this.#resolve(value);
  }

  /** Complete only for the current symbolic owner/version; retain no ignored payload. */
  resolveIfCurrent(
    expectedOwnerVersion: string,
    currentOwnerVersion: string,
    value: T,
  ): "resolved" | "late_ignored" {
    if (expectedOwnerVersion !== currentOwnerVersion) {
      this.#ignoredLateResults += 1;
      return "late_ignored";
    }
    this.resolve(value);
    return "resolved";
  }

  reject(reason: unknown): void {
    this.assertPending();
    this.#settled = true;
    this.#reject(reason);
  }

  private assertPending(): void {
    if (this.#settled) throw new Error("Delayed completion is already settled.");
  }
}

export interface CrashRestoreHarness<TSnapshot> {
  snapshot(): TSnapshot;
  restore(snapshot: TSnapshot): void;
}

export function crashAndRestore<TSnapshot>(harness: CrashRestoreHarness<TSnapshot>): TSnapshot {
  const snapshot = structuredClone(harness.snapshot());
  harness.restore(structuredClone(snapshot));
  return snapshot;
}
