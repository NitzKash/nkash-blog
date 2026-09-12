import type { Viewer } from '../visibility';

/**
 * Provider-agnostic OAuth plumbing.
 *
 * Both providers share a single callback URL (`/auth/callback`). Which one is
 * in flight is carried in the `state` parameter rather than in the path, so
 * adding a provider never requires registering a new redirect URI with the
 * ones already configured.
 */

export const PROVIDERS = ['github', 'google'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface Provider {
  id: ProviderId;
  label: string;
  authorizeUrl(clientId: string, redirectUri: string, state: string): string;
  exchange(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<Viewer>;
}

export const OAUTH_STATE_COOKIE = '__Host-oauth-state';

export function stateCookie(value: string): string {
  return `${OAUTH_STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearedStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time comparison, so verifying the state nonce does not leak it a
 * character at a time through response timing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `provider|nonce|next` — `next` is a path and may itself contain `|`. */
export function encodeState(provider: ProviderId, nonce: string, next: string): string {
  return `${provider}|${nonce}|${next}`;
}

export function decodeState(
  state: string | undefined,
): { provider: ProviderId; nonce: string; next: string } | null {
  if (!state) return null;
  const first = state.indexOf('|');
  if (first === -1) return null;
  const second = state.indexOf('|', first + 1);
  if (second === -1) return null;

  const provider = state.slice(0, first);
  if (!(PROVIDERS as readonly string[]).includes(provider)) return null;

  return {
    provider: provider as ProviderId,
    nonce: state.slice(first + 1, second),
    next: state.slice(second + 1),
  };
}

/** Env var names follow a fixed convention so routes stay provider-agnostic. */
export function credentialKeys(provider: ProviderId) {
  const prefix = provider.toUpperCase();
  return { id: `${prefix}_CLIENT_ID` as const, secret: `${prefix}_CLIENT_SECRET` as const };
}
