import type { APIRoute } from 'astro';
import { clearedSessionCookie } from '../../lib/auth/session';
import { safeRedirect } from '../../lib/redirect';

export const prerender = false;

const signOut = (next: string, url: URL): Response =>
  new Response(null, {
    status: 302,
    headers: {
      Location: next,
      // The cookie has to be cleared under the same name and attributes it was
      // set with, or the browser keeps the old one and sign-out does nothing.
      'Set-Cookie': clearedSessionCookie(url),
      'Cache-Control': 'private, no-store',
    },
  });

/**
 * GET is supported because the header link is a plain anchor. That is a
 * deliberate, contained CSRF surface: the worst a forged request can do is
 * sign someone out. POST is here for anything that wants to do it properly.
 */
export const GET: APIRoute = ({ url }) => signOut(safeRedirect(url.searchParams.get('next')), url);
export const POST: APIRoute = ({ url }) => signOut(safeRedirect(url.searchParams.get('next')), url);
