import { readEnv } from './lib/env';

/**
 * The access list, read from the environment.
 *
 * It lived in this file as a literal until the repo went public. Identity —
 * GitHub logins and email addresses — is exactly the kind of thing that should
 * not be in a public git history, where it is permanent and searchable even
 * after a later commit removes it. So the values now come from `.dev.vars`
 * locally and Cloudflare secrets in production, and this file only knows how
 * to parse them.
 *
 * Format is a comma-separated list of GitHub logins and/or email addresses:
 *
 *   OWNERS="my-login,me@example.com"
 *   CIRCLE="a-friend,someone@example.com"
 *
 * Matching is case-insensitive, and email matching only ever trusts an address
 * the identity provider reported as verified.
 *
 * The tradeoff against the old source-file approach: granting access is now a
 * secret update and a redeploy rather than a commit, so grants are no longer
 * self-documenting in git history. Revocation got faster in exchange — it no
 * longer waits for a build.
 */

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Full access to everything, including `private` posts. */
export function owners(): string[] {
  return parseList(readEnv('OWNERS'));
}

/** Access to `public` and `circle` posts. Not `private`. */
export function circle(): string[] {
  return parseList(readEnv('CIRCLE'));
}
