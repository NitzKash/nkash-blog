/**
 * Pulls production into a local SQLite file you can open in DBeaver.
 *
 *   npm run db:snapshot
 *
 * D1 has no wire protocol — no host, no port, no JDBC driver. It is reachable
 * only through a Worker binding, wrangler, or the dashboard console. So this
 * exports the remote database to SQL and replays it into a real .sqlite file,
 * which any SQLite client can open.
 *
 * The result is a **point-in-time copy, not a connection**. Editing it changes
 * nothing in production; re-run this to refresh. That one-way property is the
 * reason this is a reasonable thing to hand someone — there is no way to
 * accidentally write to the live database from a GUI.
 *
 * The file contains every private post body and every member email, so it
 * lands in backups/, which is gitignored.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'backups');
mkdirSync(dir, { recursive: true });

const sqlFile = join(dir, 'prod-snapshot.sql');
const dbFile = join(dir, 'prod-snapshot.sqlite');

console.log('Exporting production…');
execFileSync(
  'npx',
  ['wrangler', 'd1', 'export', 'nkash-blog', '--remote', '--output', sqlFile],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

// Rebuild from scratch: replaying a dump over an existing file would collide
// on every primary key and leave a half-merged database that looks fine.
for (const stale of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
  if (existsSync(stale)) rmSync(stale);
}

console.log('Building the SQLite file…');
execFileSync('sqlite3', [dbFile], { input: `.read '${sqlFile}'\n`, stdio: ['pipe', 'ignore', 'inherit'] });

const counts = execFileSync(
  'sqlite3',
  [
    dbFile,
    `SELECT 'posts: ' || (SELECT count(*) FROM posts)
         || '  members: ' || (SELECT count(*) FROM members)
         || '  comments: ' || (SELECT count(*) FROM comments);`,
  ],
  { encoding: 'utf8' },
).trim();

console.log(`\n  ${dbFile}`);
console.log(`  ${(statSync(dbFile).size / 1024).toFixed(1)} KB · ${counts}`);
console.log('\n  DBeaver → New Connection → SQLite → paste that path.');
console.log('  It is a snapshot. Edits do not reach production; re-run to refresh.\n');
