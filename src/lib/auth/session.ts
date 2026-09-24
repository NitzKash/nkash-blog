import type { Viewer } from '../visibility';

/**
 * Stateless sessions: a JSON payload plus an HMAC-SHA256 signature, in an
 * HttpOnly cookie. No session store, so no database and nothing to expire on a
 * schedule.
 *
 * The cost of statelessness is that a session cannot be revoked individually
 * before it expires. Two mitigations: sessions are short (7 days), and
 * authorisation is re-evaluated from `access.config.ts` on every single request
 * rather than being baked into the token. So removing someone from the circle
 * list locks them out at the next deploy even though their cookie is still
 * cryptographically valid. Rotating SESSION_SECRET invalidates everything at
 * once, immediately.
 */

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Cookie naming and attributes depend on whether the request is secure.
 *
 * `__Host-` is the right prefix and it requires `Secure`. But Safari refuses
 * `Secure` cookies over `http://localhost`, which silently drops every cookie
 * in local development and makes sign-in impossible to test in that browser.
 * Chrome and Firefox allow it, which is why this hid for so long — and why
 * `curl`, which enforces nothing, kept the suite green.
 *
 * The relaxed branch is deliberately narrow: plain http **and** a loopback
 * host. It cannot fire in production, because `.dev` is in the HSTS preload
 * list and `blogs.nkash.dev` is therefore unreachable over http by
 * construction. On a loopback address there is no network for `Secure` to
 * protect against anyway.
 */
function isLoopbackHttp(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  );
}

export const SESSION_COOKIE = '__Host-session';
export const SESSION_COOKIE_DEV = 'session';

export function sessionCookieName(url: URL): string {
  return isLoopbackHttp(url) ? SESSION_COOKIE_DEV : SESSION_COOKIE;
}

interface SessionPayload extends Viewer {
  /** Issued-at and expiry, seconds since epoch. */
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The return type is pinned to an ArrayBuffer-backed view rather than the
// default ArrayBufferLike: crypto.subtle takes a BufferSource, which excludes
// SharedArrayBuffer-backed views, and allocating the buffer explicitly is what
// proves that to the compiler.
function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padding = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSession(viewer: Viewer, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { ...viewer, iat: now, exp: now + SESSION_TTL_SECONDS };

  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(signature))}`;
}

/** Returns the viewer, or null for anything malformed, unsigned or expired. */
export async function readSession(token: string | undefined, secret: string): Promise<Viewer | null> {
  if (!token) return null;

  const separator = token.indexOf('.');
  if (separator === -1) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!body || !signature) return null;

  let valid: boolean;
  try {
    // crypto.subtle.verify compares in constant time.
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      b64urlDecode(signature),
      encoder.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }

  if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload?.sub !== 'string' || payload.sub.length === 0) return null;

  return {
    sub: payload.sub,
    login: payload.login,
    email: payload.email,
    name: payload.name,
    avatar: payload.avatar,
  };
}

/**
 * In production this is `__Host-` prefixed, which browsers reject unless the
 * cookie is Secure, Path=/ and has no Domain — and which also means it cannot
 * be set by, or leak to, a sibling subdomain like demo.nkash.dev.
 */
export function sessionCookie(token: string, url: URL): string {
  const parts = [
    `${sessionCookieName(url)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (!isLoopbackHttp(url)) parts.splice(3, 0, 'Secure');
  return parts.join('; ');
}

export function clearedSessionCookie(url: URL): string {
  const secure = isLoopbackHttp(url) ? '' : ' Secure;';
  return `${sessionCookieName(url)}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}
