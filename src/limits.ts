// Per-IP rate limits (spec section 18): a fixed window per (bucket, client) in Postgres, so every server instance
// shares the count. The key stores a hash of the IP, never the IP itself.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";

export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`too many requests; try again in ${Math.ceil(retryAfterSec / 60)} min`);
  }
}

/** The caller's IP as the platform reports it (Vercel and most proxies set x-forwarded-for; the first entry is the client). */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";

/** Counts one hit in the current window and returns the count, starting a new window when the old one has passed. */
export async function hit(key: string, windowSec: number) {
  const { rows } = await db().execute<{ count: number; window_start: Date }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
    returning count, window_start`);
  return { count: Number(rows[0].count), windowStart: new Date(rows[0].window_start) };
}

/** Throws RateLimitError (a 429 from `handle`) once a client makes more than `max` calls to `bucket` in the window. */
export async function rateLimit(req: Request, bucket: string, max: number, windowSec = 3600) {
  const who = createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 32);
  const { count, windowStart } = await hit(`${bucket}:${who}`, windowSec);
  if (count > max) throw new RateLimitError(Math.max(1, windowSec - (Date.now() - windowStart.getTime()) / 1000));
}
