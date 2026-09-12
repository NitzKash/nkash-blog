/**
 * Sanitise a post-login `?next=` destination.
 *
 * Anything that is not a single-slash-prefixed relative path is discarded, so
 * the login flow cannot be turned into an open redirect to an attacker's site.
 * `//evil.com` and `/\evil.com` are both rejected — browsers treat them as
 * protocol-relative URLs.
 */
export function safeRedirect(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.includes('\n') || value.includes('\r')) return fallback;
  return value;
}
