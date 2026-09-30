import "server-only";

// Collects per-phase durations and emits them as a Server-Timing header (visible in browser devtools)
export function createTimer() {
  const entries: string[] = [];
  const start = performance.now();

  return {
    async time<T>(name: string, work: PromiseLike<T> | (() => PromiseLike<T>)): Promise<T> {
      const t = performance.now();
      try {
        return await (typeof work === "function" ? work() : work);
      } finally {
        entries.push(`${name};dur=${(performance.now() - t).toFixed(0)}`);
      }
    },
    header(): string {
      return [...entries, `total;dur=${(performance.now() - start).toFixed(0)}`].join(", ");
    },
  };
}
