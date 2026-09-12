import { env } from 'cloudflare:workers';

/**
 * The only place in the codebase that names a Cloudflare binding.
 *
 * Everything above this reaches storage through the repositories in this
 * directory; nothing above `lib/data/` has ever seen a `D1Database` or an
 * `R2Bucket`. That is the module boundary standing in for the two boxes in
 * docs/architecture — see the note there on why they are one Worker.
 */

interface Bindings {
  DB?: D1Database;
  MEDIA?: R2Bucket;
}

const bindings = () => env as unknown as Bindings;

/**
 * Throws rather than returning undefined. A missing binding is a deployment
 * mistake, not a runtime condition worth branching on everywhere — better a
 * loud 500 with an actionable message than every query silently returning
 * nothing, which on a site like this would look exactly like "no posts yet".
 */
export function db(): D1Database {
  const binding = bindings().DB;
  if (!binding) {
    throw new Error(
      'D1 binding `DB` is missing. Add it to wrangler.jsonc and run `npm run db:migrate`.',
    );
  }
  return binding;
}

export function media(): R2Bucket {
  const binding = bindings().MEDIA;
  if (!binding) {
    throw new Error('R2 binding `MEDIA` is missing. Add it to wrangler.jsonc.');
  }
  return binding;
}

/** True when storage is wired up. Used by health checks, not by request paths. */
export function storageConfigured(): boolean {
  return Boolean(bindings().DB && bindings().MEDIA);
}
