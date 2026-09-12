import type { APIRoute } from 'astro';
import { readEnv } from '../../lib/env';
import { getProvider } from '../../lib/auth/providers';
import { credentialKeys, encodeState, newNonce, stateCookie } from '../../lib/auth/oauth';
import { safeRedirect } from '../../lib/redirect';

export const prerender = false;

/**
 * Starts the OAuth flow for `/auth/github`, `/auth/google`, and any provider
 * added later. All of them come back to the single `/auth/callback` route —
 * which provider is in flight travels in the signed `state`, not the path, so
 * a new provider never needs a new redirect URI registered.
 */
export const GET: APIRoute = ({ url, params }) => {
  const provider = getProvider(params.provider ?? '');
  if (!provider) return new Response(null, { status: 404 });

  const keys = credentialKeys(provider.id);
  const clientId = readEnv(keys.id);

  // A provider with no credentials is not a route at all. The sign-in page
  // already hides its button; this makes the URL itself a 404 rather than a
  // 500, so an unconfigured provider is indistinguishable from a nonexistent
  // one and there is nothing to probe.
  if (!clientId || !readEnv(keys.secret)) return new Response(null, { status: 404 });

  const redirectUri = new URL('/auth/callback', url.origin).toString();

  const state = encodeState(
    provider.id,
    newNonce(),
    safeRedirect(url.searchParams.get('next')),
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: provider.authorizeUrl(clientId, redirectUri, state),
      'Set-Cookie': stateCookie(state),
      'Cache-Control': 'private, no-store',
    },
  });
};
