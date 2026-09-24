/**
 * Cache headers.
 *
 * Every page here is rendered on demand, which on the Cloudflare free plan
 * means every uncached hit spends one of 100,000 daily Worker invocations. So
 * public responses get a long shared-cache lifetime and are served from the
 * edge without waking the Worker; a burst of traffic on a public post costs
 * roughly one invocation per edge location per hour, not one per reader.
 *
 * Gated responses must never be stored by a shared cache, and must vary on the
 * session cookie so that a cached anonymous response can never be handed to a
 * signed-in reader or the reverse.
 */

export function publicCacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    Vary: 'Cookie',
  };
}

/**
 * Post pages get a shorter shared lifetime than listings, because a post now
 * carries a comment thread and an hour-old cache would mean an hour-old
 * conversation. Five minutes still means an edge location wakes the Worker at
 * most twelve times an hour for a given post, which is nothing against a
 * budget of 100,000 a day.
 */
export function publicPostCacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
    Vary: 'Cookie',
  };
}

export function privateCacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, no-cache, must-revalidate',
    Vary: 'Cookie',
  };
}

/** Headers applied to every response, cached or not. */
export function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  };
}
