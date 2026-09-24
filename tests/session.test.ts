import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSession,
  readSession,
  sessionCookie,
  clearedSessionCookie,
  sessionCookieName,
  SESSION_COOKIE,
} from '../src/lib/auth/session';

const SECRET = 'test-secret-not-used-anywhere-real';
const OTHER_SECRET = 'a-different-secret-entirely';

const viewer = {
  sub: 'github:12345',
  login: 'the-owner',
  email: 'owner@example.com',
  name: 'The Owner',
};

afterEach(() => vi.useRealTimers());

describe('session round trip', () => {
  it('recovers the viewer it signed', async () => {
    const token = await createSession(viewer, SECRET);
    expect(await readSession(token, SECRET)).toMatchObject(viewer);
  });

  it('survives non-ASCII in the payload', async () => {
    const token = await createSession({ ...viewer, name: '日本語 · Ελληνικά · emoji 🔐' }, SECRET);
    expect((await readSession(token, SECRET))?.name).toBe('日本語 · Ελληνικά · emoji 🔐');
  });
});

describe('session rejection', () => {
  it('rejects a missing token', async () => {
    expect(await readSession(undefined, SECRET)).toBeNull();
    expect(await readSession('', SECRET)).toBeNull();
  });

  it('rejects a token with no signature', async () => {
    expect(await readSession('eyJzdWIiOiJnaXRodWI6MSJ9', SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSession(viewer, OTHER_SECRET);
    expect(await readSession(token, SECRET)).toBeNull();
  });

  // The important one: the payload is readable, so it must not be trusted
  // unless the signature still checks out after tampering.
  it('rejects a token whose payload was edited', async () => {
    const token = await createSession({ sub: 'github:999', login: 'rando' }, SECRET);
    const [, signature] = token.split('.');

    const forged = btoa(JSON.stringify({ ...viewer, exp: 2 ** 31, iat: 0 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(await readSession(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects a token whose signature was edited', async () => {
    const token = await createSession(viewer, SECRET);
    const [body, signature] = token.split('.');
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(await readSession(`${body}.${flipped}`, SECRET)).toBeNull();
  });

  it('rejects garbage without throwing', async () => {
    for (const junk of ['....', 'a.b', '!!.??', '.'.repeat(500), 'null.null']) {
      expect(await readSession(junk, SECRET)).toBeNull();
    }
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = await createSession(viewer, SECRET);

    vi.setSystemTime(new Date('2026-01-09T00:00:00Z')); // 8 days later, TTL is 7
    expect(await readSession(token, SECRET)).toBeNull();
  });

  it('accepts a token still inside its window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = await createSession(viewer, SECRET);

    vi.setSystemTime(new Date('2026-01-06T00:00:00Z')); // 5 days later
    expect(await readSession(token, SECRET)).toMatchObject({ sub: viewer.sub });
  });
});

describe('cookie attributes', () => {
  const prod = new URL('https://blogs.nkash.dev/posts/x');
  const cookie = sessionCookie('token-value', prod);

  it('uses the __Host- prefix, which forces Secure + Path=/ + no Domain', () => {
    expect(SESSION_COOKIE).toBe('__Host-session');
    expect(sessionCookieName(prod)).toBe('__Host-session');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Secure');
    expect(cookie).not.toContain('Domain=');
  });

  it('is not readable from JavaScript and does not ride cross-site requests', () => {
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  // Safari refuses Secure cookies over http://localhost, which silently breaks
  // sign-in in local development. curl enforces nothing, so this has to be
  // asserted rather than observed.
  it('drops Secure and the __Host- prefix on loopback http', () => {
    for (const origin of ['http://localhost:4321', 'http://127.0.0.1:4321']) {
      const url = new URL(`${origin}/`);
      expect(sessionCookieName(url)).toBe('session');
      const dev = sessionCookie('token-value', url);
      expect(dev).not.toContain('Secure');
      expect(dev).toContain('HttpOnly');
      expect(dev).toContain('SameSite=Lax');
    }
  });

  // The relaxed branch must be unreachable anywhere that is not loopback http.
  it('keeps Secure everywhere else, including https on localhost', () => {
    for (const origin of [
      'https://localhost:4321',
      'https://blogs.nkash.dev',
      'http://blogs.nkash.dev',
      'http://192.168.1.10:4321',
      'http://localhost.evil.example.com',
    ]) {
      const url = new URL(`${origin}/`);
      expect(sessionCookieName(url), origin).toBe('__Host-session');
      expect(sessionCookie('t', url), origin).toContain('Secure');
    }
  });

  it('clears under the same name it set', () => {
    const dev = new URL('http://localhost:4321/');
    expect(clearedSessionCookie(dev).startsWith('session=')).toBe(true);
    expect(clearedSessionCookie(prod).startsWith('__Host-session=')).toBe(true);
    expect(clearedSessionCookie(prod)).toContain('Max-Age=0');
  });
});
