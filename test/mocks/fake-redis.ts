/**
 * In-memory stand-in for the subset of `@upstash/redis` used by `/api/v1`
 * stores. Values round-trip through JSON like the real REST client, and
 * `failing` simulates an unreachable Redis.
 */
export class FakeRedis {
  failing = false;
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();

  private guard() {
    if (this.failing) throw new Error("redis unavailable");
  }

  private live(key: string) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async set(key: string, value: unknown, options?: { nx?: boolean; ex?: number }) {
    this.guard();
    if (options?.nx && this.live(key)) return null;
    this.store.set(key, {
      value: JSON.stringify(value),
      expiresAt: options?.ex ? Date.now() + options.ex * 1000 : null,
    });
    return "OK";
  }

  async get<T>(key: string): Promise<T | null> {
    this.guard();
    const entry = this.live(key);
    return entry ? (JSON.parse(entry.value) as T) : null;
  }

  async del(key: string) {
    this.guard();
    return this.store.delete(key) ? 1 : 0;
  }

  pipeline() {
    const ops: Array<() => unknown> = [];
    const chain = {
      incr: (key: string) => {
        ops.push(() => {
          const entry = this.live(key);
          const next = (entry ? Number(entry.value) : 0) + 1;
          this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
          return next;
        });
        return chain;
      },
      pexpire: (key: string, milliseconds: number) => {
        ops.push(() => {
          const entry = this.live(key);
          if (!entry) return 0;
          entry.expiresAt = Date.now() + milliseconds;
          return 1;
        });
        return chain;
      },
      exec: async () => {
        this.guard();
        return ops.map((op) => op());
      },
    };
    return chain;
  }
}
