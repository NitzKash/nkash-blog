import { env as workerEnv } from 'cloudflare:workers';

/**
 * Every secret lookup in the app goes through here.
 *
 * `cloudflare:workers` is the supported way to reach bindings as of Astro v6 —
 * `Astro.locals.runtime.env` was removed and now throws. In `astro dev` the
 * adapter's platform proxy populates the same object from `.dev.vars`, so this
 * behaves identically in both places.
 *
 * This is also the seam: if the site ever moves off Cloudflare, this file is
 * the thing that gets rewritten and nothing else needs to know.
 */

export interface AppEnv {
  SESSION_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

function lookup(key: string): string | undefined {
  // `wrangler types` generates a closed `Env` interface with no index
  // signature, so this widens through `unknown` deliberately — secrets are set
  // with `wrangler secret put` and never appear in wrangler.jsonc, which means
  // they cannot be in the generated type.
  const fromWorker = (workerEnv as unknown as Record<string, unknown> | undefined)?.[key];
  if (typeof fromWorker === 'string' && fromWorker.length > 0) return fromWorker;

  // Fallback for `astro build` and any non-Worker context, where the binding
  // object exists but is empty.
  const fromVite = (import.meta.env as Record<string, unknown>)[key];
  if (typeof fromVite === 'string' && fromVite.length > 0) return fromVite;

  return undefined;
}

/** Provider credential names are computed, so this accepts any string. */
export function readEnv(key: keyof AppEnv | (string & {})): string | undefined {
  return lookup(key);
}

/**
 * Throws if a required secret is missing. Called at the top of every auth
 * route, so a misconfigured deploy fails loudly on the sign-in attempt rather
 * than silently signing sessions with `undefined`.
 */
export function requireEnv(key: keyof AppEnv | (string & {})): string {
  const value = lookup(key);
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Set it in .dev.vars locally, or with \`npx wrangler secret put ${key}\` in production.`,
    );
  }
  return value;
}
