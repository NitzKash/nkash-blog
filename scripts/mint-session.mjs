/**
 * Mints a valid session cookie for local testing, using an independent
 * implementation of the signing scheme rather than importing src/lib/auth.
 *
 * That independence is the point: if this script and the app agree, the cookie
 * format is genuinely what the app documents, not merely self-consistent. A
 * test that imports the code it is testing would pass even if both sides
 * drifted together.
 *
 *   node scripts/mint-session.mjs [login] [email]
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TTL_SECONDS = 60 * 60 * 24 * 7;

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

function readSecret() {
  const match = read('../.dev.vars').match(/^SESSION_SECRET\s*=\s*"?([^"\n\r]+)"?/m);
  if (!match) throw new Error('SESSION_SECRET not found in .dev.vars');
  return match[1];
}

/**
 * Derived from the OWNERS entry in .dev.vars rather than hardcoded, so the
 * test fixtures carry no identity of their own and stay correct if the list
 * is edited.
 */
export function ownerIdentity() {
  const match = read('../.dev.vars').match(/^OWNERS\s*=\s*"?([^"\n\r]*)"?/m);
  const entries = (match?.[1] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error('OWNERS is empty in .dev.vars — the smoke test needs an owner to sign in as');
  }

  return {
    sub: 'test:owner',
    login: entries.find((e) => !e.includes('@')),
    email: entries.find((e) => e.includes('@')),
  };
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function mint(viewer, secret = readSecret()) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...viewer, iat: now, exp: now + TTL_SECONDS };

  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${signature}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const owner = ownerIdentity();
  const [, , login = owner.login, email = owner.email] = process.argv;
  console.log(mint({ sub: 'test:owner', login, email, name: login }));
}
