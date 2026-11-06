/** Per-IP rate limits. Implementations: in memory (default) and Cloudflare's rate limiting binding. */
export interface Limiter {
  /** true if the request may go on. */
  allow(key: string): Promise<boolean>;
}

/** Fixed window counter in memory. Good for one process; resets on restart. */
export function memoryLimiter(limit: number, periodSeconds: number, now: () => number = Date.now): Limiter {
  const hits = new Map<string, { start: number; n: number }>();
  return {
    async allow(key) {
      const t = now();
      if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= periodSeconds * 1000) hits.delete(k);
      const h = hits.get(key);
      if (!h || t - h.start >= periodSeconds * 1000) {
        hits.set(key, { start: t, n: 1 });
        return true;
      }
      h.n++;
      return h.n <= limit;
    },
  };
}

/** Cloudflare Workers rate limiting binding ([[ratelimits]] in wrangler.toml). */
export interface CloudflareRateLimit {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}
export function cloudflareLimiter(binding: CloudflareRateLimit): Limiter {
  return {
    async allow(key) {
      return (await binding.limit({ key })).success;
    },
  };
}
