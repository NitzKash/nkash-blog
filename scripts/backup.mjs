/**
 * Pulls a full SQL dump of the database to ./backups.
 *
 *   npm run db:backup          # production
 *   npm run db:backup:local    # the local dev database
 *
 * D1's Time Travel already covers accidental deletes and bad migrations for 30
 * days, and it is always on. This exists for the things Time Travel does not
 * cover: an account problem, a free-tier change, or wanting the data somewhere
 * that is not Cloudflare. Thirty days of provider-side history is not the same
 * as a copy you hold.
 *
 * Dumps contain every post body, including private ones — `backups/` is
 * gitignored for that reason and should stay that way.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const remote = !process.argv.includes('--local');
const dir = join(process.cwd(), 'backups');
mkdirSync(dir, { recursive: true });

// Sortable, filename-safe, and unambiguous about which database it came from.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = join(dir, `nkash-blog-${remote ? 'prod' : 'local'}-${stamp}.sql`);

console.log(`Exporting ${remote ? 'PRODUCTION' : 'local'} database…`);

execFileSync(
  'npx',
  [
    'wrangler',
    'd1',
    'export',
    'nkash-blog',
    remote ? '--remote' : '--local',
    '--output',
    file,
  ],
  { stdio: 'inherit' },
);

const { size } = statSync(file);
console.log(`\n  ${file}`);
console.log(`  ${(size / 1024).toFixed(1)} KB\n`);

if (size < 512) {
  console.warn('  That looks suspiciously small. Check the dump before trusting it.\n');
  process.exit(1);
}
