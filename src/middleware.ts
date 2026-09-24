import { defineMiddleware } from 'astro:middleware';
import { readSession, sessionCookieName } from './lib/auth/session';
import { readEnv } from './lib/env';
import { resolveMembership } from './lib/membership';
import { securityHeaders } from './lib/cache';

/**
 * Resolves the viewer once per request and hands it to every page through
 * `Astro.locals`. Pages never parse the cookie themselves.
 *
 * This middleware authenticates; it does not authorise. Deciding what a viewer
 * may see is `canView()` in `lib/visibility.ts`, called by the routes that
 * actually surface content. Keeping those separate means there is exactly one
 * place to audit for "who is this" and exactly one for "what may they read".
 *
 * Membership is resolved here, per request, rather than being baked into the
 * session cookie. That is what makes approving or revoking someone take effect
 * immediately instead of whenever their cookie happens to expire.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const secret = readEnv('SESSION_SECRET');

  const viewer = secret
    ? await readSession(context.cookies.get(sessionCookieName(context.url))?.value, secret)
    : null;

  const membership = await resolveMembership(viewer);

  context.locals.viewer = viewer;
  context.locals.audience = membership.audience;
  context.locals.memberStatus = membership.status;
  context.locals.username = membership.username;
  context.locals.needsUsername = membership.needsUsername;

  const response = await next();

  for (const [header, value] of Object.entries(securityHeaders())) {
    if (!response.headers.has(header)) response.headers.set(header, value);
  }

  return response;
});
