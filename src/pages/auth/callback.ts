import type { APIRoute } from 'astro';
import { requireEnv } from '../../lib/env';
import { getProvider } from '../../lib/auth/providers';
import {
  clearedStateCookie,
  credentialKeys,
  decodeState,
  stateCookieName,
  timingSafeEqual,
} from '../../lib/auth/oauth';
import { createSession, sessionCookie } from '../../lib/auth/session';
import { recordSignIn } from '../../lib/membership';
import { safeRedirect } from '../../lib/redirect';

export const prerender = false;

function failure(message: string, url: URL): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/login?error=${encodeURIComponent(message)}`,
      'Set-Cookie': clearedStateCookie(url),
      'Cache-Control': 'private, no-store',
    },
  });
}

/** One callback for every provider; the state cookie says which one. */
export const GET: APIRoute = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const storedState = cookies.get(stateCookieName(url))?.value;

  if (url.searchParams.get('error')) return failure('The sign-in request was declined.', url);
  if (!code || !returnedState) return failure('Malformed callback.', url);

  // Compare the whole state string, not just the nonce, so neither the
  // provider nor the destination can be swapped after the fact.
  if (!storedState || !timingSafeEqual(returnedState, storedState)) {
    return failure('Sign-in request expired or did not match. Try again.', url);
  }

  const state = decodeState(storedState);
  if (!state) return failure('Malformed sign-in state.', url);

  const provider = getProvider(state.provider);
  if (!provider) return failure('Unknown sign-in provider.', url);

  const keys = credentialKeys(provider.id);

  let viewer;
  try {
    viewer = await provider.exchange(
      code,
      requireEnv(keys.id),
      requireEnv(keys.secret),
      new URL('/auth/callback', url.origin).toString(),
    );
  } catch (error) {
    console.error(`${provider.id} OAuth exchange failed`, error);
    return failure(`Could not complete sign-in with ${provider.label}.`, url);
  }

  // Note: everyone who authenticates gets a session, including people on no
  // list at all. Authorisation happens per-request in canView(), so a session
  // by itself grants nothing beyond what an anonymous visitor already sees.
  //
  // Recording the sign-in is what puts them in the approval queue. It never
  // changes an existing status, so signing in again neither resets an approval
  // nor moves a blocked person back into the queue.
  const { needsUsername } = await recordSignIn(viewer);

  const token = await createSession(viewer, requireEnv('SESSION_SECRET'));

  // A first-time visitor is offered a handle before being dropped wherever
  // they were headed. It is skippable — the destination rides along in `next`.
  const destination = needsUsername
    ? `/welcome?next=${encodeURIComponent(safeRedirect(state.next))}`
    : safeRedirect(state.next);

  const headers = new Headers({
    Location: destination,
    'Cache-Control': 'private, no-store',
  });
  headers.append('Set-Cookie', sessionCookie(token, url));
  headers.append('Set-Cookie', clearedStateCookie(url));

  return new Response(null, { status: 302, headers });
};
