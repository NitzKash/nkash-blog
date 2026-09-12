/**
 * One-time import of markdown files into D1.
 *
 *   node scripts/import-markdown.mjs <dir>            # local database
 *   node scripts/import-markdown.mjs <dir> --remote   # production
 *
 * Reads frontmatter + body, renders the HTML the same way the editor does, and
 * emits SQL for `wrangler d1 execute`. Existing slugs are updated in place.
 *
 * This exists for the migration off content collections and for bulk-loading
 * drafts written outside the browser. Day-to-day writing goes through
 * /admin/editor.
 */

import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { marked } from 'marked';

const [, , dir, ...flags] = process.argv;
if (!dir) {
  console.error('usage: node scripts/import-markdown.mjs <dir> [--remote]');
  process.exit(1);
}

const remote = flags.includes('--remote');

/** Minimal frontmatter reader — enough for the fields this schema has. */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;

    let value = kv[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      value = value.replace(/^['"]|['"]$/g, '');
    }
    data[kv[1]] = value;
  }
  return { data, body: match[2] };
}

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

const files = readdirSync(dir).filter((f) => ['.md', '.mdx'].includes(extname(f)));
if (files.length === 0) {
  console.error(`No markdown files in ${dir}`);
  process.exit(1);
}

const statements = [];

for (const file of files) {
  const raw = readFileSync(join(dir, file), 'utf8');
  const { data, body } = parseFrontmatter(raw);

  const slug = basename(file, extname(file));
  const html = await marked.parse(body);
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 220));
  const now = new Date().toISOString();

  // Default to private, exactly as the schema does. An import must not be the
  // thing that accidentally publishes something.
  const visibility = ['public', 'circle', 'private'].includes(data.visibility)
    ? data.visibility
    : 'private';

  const pubDate = data.pubDate ? new Date(data.pubDate).toISOString() : now;

  statements.push(
    `INSERT INTO posts (slug, title, description, visibility, draft, pub_date, updated_date,
       tags, allow, body, html, reading_minutes, created_at, updated_at)
     VALUES (${sqlString(slug)}, ${sqlString(data.title ?? slug)}, ${sqlString(data.description ?? '')},
       ${sqlString(visibility)}, ${data.draft === 'true' ? 1 : 0}, ${sqlString(pubDate)}, NULL,
       ${sqlString(JSON.stringify(Array.isArray(data.tags) ? data.tags : []))},
       ${sqlString(JSON.stringify(Array.isArray(data.allow) ? data.allow : []))},
       ${sqlString(body)}, ${sqlString(html)}, ${minutes}, ${sqlString(now)}, ${sqlString(now)})
     ON CONFLICT (slug) DO UPDATE SET
       title = excluded.title, description = excluded.description,
       visibility = excluded.visibility, draft = excluded.draft,
       pub_date = excluded.pub_date, tags = excluded.tags, allow = excluded.allow,
       body = excluded.body, html = excluded.html,
       reading_minutes = excluded.reading_minutes, updated_at = excluded.updated_at;`,
  );

  console.log(`  ${slug.padEnd(32)} ${visibility}`);
}

const sqlFile = join(mkdtempSync(join(tmpdir(), 'nkash-import-')), 'import.sql');
writeFileSync(sqlFile, statements.join('\n'));

execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'nkash-blog', remote ? '--remote' : '--local', '--file', sqlFile],
  { stdio: 'inherit' },
);

console.log(`\nImported ${files.length} post(s) into the ${remote ? 'remote' : 'local'} database.`);
