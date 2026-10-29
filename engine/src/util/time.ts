export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function ms(iso: string): number {
  return new Date(iso).getTime();
}

export function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms: ${label}`)), timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Virtual clock per synthetic customer. Real time flows normally; scenarios can
 * advance the clock by days to exercise lookback windows without waiting.
 */
export class VirtualClock {
  offsetMs = 0;

  now(): number {
    return Date.now() + this.offsetMs;
  }

  nowIso(): string {
    return toIso(this.now());
  }

  advance(durationMs: number): void {
    this.offsetMs += durationMs;
  }
}
