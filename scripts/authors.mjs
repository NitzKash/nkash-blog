/**
 * End-to-end check of multi-author posting, against a running dev server.
 *
 *   npm run dev
 *   npm run authors
 *
 * Exercises the parts the unit tests cannot: the SQL narrowing in posts.ts,
 * the route guards, and whether a byline actually reaches the page. Creates
 * two throwaway contributors and their posts, and removes everything at the
 * end.
 */

import { execFileSync } from 'node:child_process';
import { mint, ownerIdentity } from './mint-session.mjs';

const BASE = 'http://localhost:4321';
const COOKIE = /^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(BASE) ? 'session' : '__Host-session';
const RUN = Math.random().toString(36).slice(2, 7);

const sql = (statement) =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'nkash-blog', '--local', '--command', statement], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

function sqlRows(statement) {
  const out = sql(statement);
  const start = out.indexOf('[');
  return start === -1 ? [] : (JSON.parse(out.slice(start))[0]?.results ?? []);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n          ${detail}` : ''}`);
};

const ALICE = `github:alice-${RUN}`;
const BOB = `github:bob-${RUN}`;

const owner = mint(ownerIdentity());
const alice = mint({ sub: ALICE, login: `alice-${RUN}` });
const bob = mint({ sub: BOB, login: `bob-${RUN}` });

async function get(path, cookie) {
  const r = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: cookie ? { Cookie: `${COOKIE}=${cookie}` } : {},
  });
  return { status: r.status, body: await r.text() };
}

async function save(fields, cookie) {
  const r = await fetch(`${BASE}/admin/save`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: `${COOKIE}=${cookie}`,
      Origin: BASE,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  });
  return r.status;
}

console.log(`\nMulti-author checks  (run ${RUN})\n`);

for (const [id, login] of [[ALICE, `alice-${RUN}`], [BOB, `bob-${RUN}`]]) {
  sql(`INSERT OR REPLACE INTO members (id, provider, login, username, status, requested_at, last_seen_at)
       VALUES ('${id}', 'github', '${login}', '${login}', 'approved', datetime('now'), datetime('now'))`);
}

const slugs = {
  alicePublic: `a-pub-${RUN}`,
  alicePrivate: `a-priv-${RUN}`,
  aliceCircle: `a-circ-${RUN}`,
  bobPrivate: `b-priv-${RUN}`,
};

try {
  // -------------------------------------------------------------------------
  console.log('Contributors can write:');

  check('an approved contributor reaches the editor', (await get('/admin/editor', alice)).status === 200);
  check('a pending member cannot', (await get('/admin/editor', mint({ sub: `github:nobody-${RUN}` }))).status === 404);
  check('an anonymous visitor cannot', (await get('/admin/editor')).status === 404);

  check('alice creates a public post', (await save({
    slug: slugs.alicePublic, title: `Alice public ${RUN}`, visibility: 'public',
    pubDate: '2026-01-01', body: 'Alice wrote this.',
  }, alice)) === 303);

  for (const [slug, visibility, cookie, who] of [
    [slugs.alicePrivate, 'private', alice, 'alice'],
    [slugs.aliceCircle, 'circle', alice, 'alice'],
    [slugs.bobPrivate, 'private', bob, 'bob'],
  ]) {
    await save({ slug, title: `${who} ${visibility} ${RUN}`, visibility, pubDate: '2026-01-01',
                 body: `${who} wrote this.` }, cookie);
  }

  check('authorship is recorded',
    sqlRows(`SELECT author_id FROM posts WHERE slug = '${slugs.alicePublic}'`)[0]?.author_id === ALICE);

  // -------------------------------------------------------------------------
  console.log('\nPrivate means the author alone:');

  check('alice reads her own private post', (await get(`/posts/${slugs.alicePrivate}`, alice)).status === 200);
  check('bob cannot read it', (await get(`/posts/${slugs.alicePrivate}`, bob)).status === 404);
  // The property the whole change turns on.
  check('THE OWNER cannot read it either', (await get(`/posts/${slugs.alicePrivate}`, owner)).status === 404);
  check('anonymous cannot read it', (await get(`/posts/${slugs.alicePrivate}`)).status === 404);
  check('bob reads his own', (await get(`/posts/${slugs.bobPrivate}`, bob)).status === 200);

  // -------------------------------------------------------------------------
  console.log('\nListings respect it:');

  const aliceIndex = await get('/posts', alice);
  check('alice sees her own private post listed', aliceIndex.body.includes(`alice private ${RUN}`));
  check('alice does not see bob\'s', !aliceIndex.body.includes(`bob private ${RUN}`));

  const ownerIndex = await get('/posts', owner);
  check('the owner sees neither contributor private post',
    !ownerIndex.body.includes(`alice private ${RUN}`) && !ownerIndex.body.includes(`bob private ${RUN}`));
  check('the owner still sees contributor circle posts', ownerIndex.body.includes(`alice circle ${RUN}`));

  const anonIndex = await get('/posts');
  check('anonymous sees only the public one',
    anonIndex.body.includes(`Alice public ${RUN}`) && !anonIndex.body.includes(`alice circle ${RUN}`));

  // -------------------------------------------------------------------------
  console.log('\nBylines:');

  check('a byline appears on the index', anonIndex.body.includes(`by alice-${RUN}`));
  check('a byline appears on the post', (await get(`/posts/${slugs.alicePublic}`)).body.includes(`by alice-${RUN}`));

  // -------------------------------------------------------------------------
  console.log('\nEditing is narrower than reading:');

  check('alice can open her own post', (await get(`/admin/editor?slug=${slugs.alicePublic}`, alice)).status === 200);
  check('bob cannot open it', (await get(`/admin/editor?slug=${slugs.alicePublic}`, bob)).status === 404);
  check('the OWNER cannot open it', (await get(`/admin/editor?slug=${slugs.alicePublic}`, owner)).status === 404);

  check('bob cannot save over it',
    (await save({ originalSlug: slugs.alicePublic, slug: slugs.alicePublic, title: 'hijacked',
                  visibility: 'public', pubDate: '2026-01-01', body: 'nope' }, bob)) === 404);
  check('the owner cannot save over it',
    (await save({ originalSlug: slugs.alicePublic, slug: slugs.alicePublic, title: 'hijacked',
                  visibility: 'public', pubDate: '2026-01-01', body: 'nope' }, owner)) === 404);
  check('the post is untouched',
    sqlRows(`SELECT title FROM posts WHERE slug = '${slugs.alicePublic}'`)[0]?.title === `Alice public ${RUN}`);

  // An edit must never silently reassign the byline.
  await save({ originalSlug: slugs.alicePublic, slug: slugs.alicePublic, title: `Alice edited ${RUN}`,
               visibility: 'public', pubDate: '2026-01-01', body: 'edited' }, alice);
  check('editing preserves authorship',
    sqlRows(`SELECT author_id FROM posts WHERE slug = '${slugs.alicePublic}'`)[0]?.author_id === ALICE);

  // -------------------------------------------------------------------------
  console.log('\nModeration:');

  check('the owner CAN delete a contributor post',
    (await save({ originalSlug: slugs.aliceCircle, action: 'delete' }, owner)) === 303);
  check('it is gone', sqlRows(`SELECT slug FROM posts WHERE slug = '${slugs.aliceCircle}'`).length === 0);
  check('bob cannot delete alice\'s',
    (await save({ originalSlug: slugs.alicePublic, action: 'delete' }, bob)) === 404);
  check('it survives', sqlRows(`SELECT slug FROM posts WHERE slug = '${slugs.alicePublic}'`).length === 1);

  // -------------------------------------------------------------------------
  console.log('\nFeeds never carry a gated post:');

  const rss = await get('/rss.xml');
  check('rss has the public post', rss.body.includes(`Alice edited ${RUN}`));
  check('rss has no private post', !rss.body.includes(`private ${RUN}`));
  const sitemap = await get('/sitemap.xml');
  check('sitemap has no private slug',
    !sitemap.body.includes(slugs.alicePrivate) && !sitemap.body.includes(slugs.bobPrivate));

  // -------------------------------------------------------------------------
  console.log('\nRemoving someone archives their private work:');

  // Demote alice to pending — the same resolution a removed or blocked member
  // gets. Her public post stays up; her private work goes dark, including to
  // her.
  sql(`UPDATE members SET status = 'pending' WHERE id = '${ALICE}'`);

  check('she can no longer read her own private post',
    (await get(`/posts/${slugs.alicePrivate}`, alice)).status === 404);
  check('it is gone from her listing',
    !(await get('/posts', alice)).body.includes(`alice private ${RUN}`));
  check('she can no longer open the editor at all',
    (await get('/admin/editor', alice)).status === 404);
  check('she can no longer edit her own post',
    (await get(`/admin/editor?slug=${slugs.alicePublic}`, alice)).status === 404);
  check('she cannot save over it either',
    (await save({ originalSlug: slugs.alicePublic, slug: slugs.alicePublic, title: 'after removal',
                  visibility: 'public', pubDate: '2026-01-01', body: 'nope' }, alice)) === 404);

  // Published work stays published — taking it down would be rewriting the
  // site's history rather than revoking one person's access.
  check('her public post is still readable by everyone',
    (await get(`/posts/${slugs.alicePublic}`)).status === 200);
  check('and still carries her byline',
    (await get(`/posts/${slugs.alicePublic}`)).body.includes(`by alice-${RUN}`));
  check('and is still in the feed',
    (await get('/rss.xml')).body.includes(`Alice edited ${RUN}`));

  // Restoring her restores the access, so this is reversible.
  sql(`UPDATE members SET status = 'approved' WHERE id = '${ALICE}'`);
  check('re-approving her restores access to her private post',
    (await get(`/posts/${slugs.alicePrivate}`, alice)).status === 200);
} finally {
  for (const slug of Object.values(slugs)) sql(`DELETE FROM posts WHERE slug = '${slug}'`);
  sql(`DELETE FROM members WHERE id IN ('${ALICE}', '${BOB}')`);
  console.log('\ncleaned up');
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
