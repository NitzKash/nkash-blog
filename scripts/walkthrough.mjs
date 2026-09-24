/**
 * Walks a new reader through the whole journey against a running dev server,
 * printing what they actually see at each step.
 *
 *   npm run dev
 *   node scripts/walkthrough.mjs
 *
 * Creates a throwaway member and a throwaway circle post, and removes both at
 * the end.
 */

import { execFileSync } from 'node:child_process';
import { mint, ownerIdentity } from './mint-session.mjs';

const BASE = 'http://localhost:4321';

/**
 * The server drops the `__Host-` prefix on loopback http, because Safari
 * refuses Secure cookies there. Deriving the name the same way means these
 * scripts send what a browser would actually send.
 */
const COOKIE_NAME = /^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(BASE)
  ? 'session'
  : '__Host-session';
const RUN = Math.random().toString(36).slice(2, 6);
const FRIEND_SUB = `github:demo-${RUN}`;
const POST = `walkthrough-${RUN}`;
// A public post of its own, so the script never references real content —
// asserting on a real post's text would put that text in a public repo.
const PUBLIC_POST = `walkthrough-public-${RUN}`;
const PUBLIC_TITLE = `Walkthrough public ${RUN}`;

const owner = mint(ownerIdentity());
const friend = mint({ sub: FRIEND_SUB, login: `friend-${RUN}`, email: `friend-${RUN}@example.com` });

const sql = (statement) =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'nkash-blog', '--local', '--command', statement], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

async function get(path, cookie) {
  const r = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {},
  });
  return { status: r.status, body: await r.text(), location: r.headers.get('location') };
}

async function post(path, fields, cookie) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: `${COOKIE_NAME}=${cookie}`,
      Origin: BASE,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  });
  return r.status;
}

/** Pulls the human-readable message out of a rendered page. */
function message(body) {
  const patterns = [
    /Waiting on nkash to approve you/,
    /you're in the queue/i,
    /wasn't approved/,
    /This one's not public/,
    /Sign in and I'll check/,
    /Pick a handle/,
  ];
  return patterns.filter((p) => p.test(body)).map((p) => p.source.replace(/\\/g, '')).join(' · ');
}

const step = (n, text) => console.log(`\n${'─'.repeat(66)}\n${n}. ${text}\n`);
const line = (label, value) => console.log(`   ${label.padEnd(34)} ${value}`);

console.log('\nA friend arrives at the site\n');

// One post per tier to exercise, both throwaway.
await post('/admin/save', {
  slug: PUBLIC_POST,
  title: PUBLIC_TITLE,
  visibility: 'public',
  pubDate: '2026-01-01',
  body: 'Anyone can read this.',
}, owner);

await post('/admin/save', {
  slug: POST,
  title: `Walkthrough post ${RUN}`,
  visibility: 'circle',
  pubDate: '2026-01-01',
  body: 'Something only the circle can read.',
}, owner);

try {
  step(1, 'They arrive, not signed in');
  const home = await get('/');
  line('GET /', home.status);
  line('sees the public post', home.body.includes(PUBLIC_TITLE) ? 'yes' : 'no');
  line('sees the circle post', new RegExp(`Walkthrough post ${RUN}`).test(home.body) ? 'YES — BUG' : 'no');

  step(2, 'You send them a link to a circle post');
  const gated = await get(`/posts/${POST}`);
  line('GET /posts/<circle post>', gated.status);
  line('message shown', message(gated.body) || '(none)');
  line('post body leaked', /only the circle can read/.test(gated.body) ? 'YES — BUG' : 'no');

  step(3, 'They click sign in and authorise with GitHub');
  console.log('   (simulated — the real flow redirects to GitHub and back)\n');
  sql(
    `INSERT INTO members (id, provider, login, email, name, status, requested_at, last_seen_at)
     VALUES ('${FRIEND_SUB}', 'github', 'friend-${RUN}', 'friend-${RUN}@example.com',
             'A Friend', 'pending', datetime('now'), datetime('now'))`,
  );
  line('member row created with status', 'pending');
  const welcome = await get('/welcome', friend);
  line('they land on /welcome', welcome.status);
  line('prompt', message(welcome.body) || '(none)');
  line('anonymity hint shown', /rather be anonymous/.test(welcome.body) ? 'yes' : 'no');

  step(4, 'They pick a handle');
  const claimed = await post('/welcome/claim', { username: `quiet-wafer-${RUN}`, next: '/' }, friend);
  line('POST /welcome/claim', claimed === 303 ? '303 (accepted)' : claimed);

  step(5, 'Back on the site, still awaiting approval');
  const pending = await get('/', friend);
  line('GET /', pending.status);
  line('message shown', message(pending.body) || '(none)');
  const stillGated = await get(`/posts/${POST}`, friend);
  line('GET /posts/<circle post>', stillGated.status);
  line('post body leaked', /only the circle can read/.test(stillGated.body) ? 'YES — BUG' : 'no');

  step(6, 'You open /admin/members');
  const queue = await get('/admin/members', owner);
  line('GET /admin/members', queue.status);
  line('their handle listed', new RegExp(`quiet-wafer-${RUN}`).test(queue.body) ? 'yes' : 'no');
  line('their real login visible to you', new RegExp(`friend-${RUN}`).test(queue.body) ? 'yes' : 'no');

  step(7, 'You click approve');
  const decided = await post('/admin/decide', { id: FRIEND_SUB, action: 'approve' }, owner);
  line('POST /admin/decide', decided === 303 ? '303 (approved)' : decided);

  step(8, 'They reload — no new sign-in needed');
  const after = await get(`/posts/${POST}`, friend);
  line('GET /posts/<circle post>', after.status);
  line('can now read it', /only the circle can read/.test(after.body) ? 'yes' : 'no');
  const home2 = await get('/', friend);
  line('circle post now on their index', new RegExp(`Walkthrough post ${RUN}`).test(home2.body) ? 'yes' : 'no');
  line('waiting message gone', message(home2.body) === '' ? 'yes' : `no — ${message(home2.body)}`);

  step(9, 'Private posts stay yours');
  await post('/admin/save', {
    slug: `${POST}-private`,
    title: `Walkthrough private ${RUN}`,
    visibility: 'private',
    pubDate: '2026-01-01',
    body: 'Owner only.',
  }, owner);
  const priv = await get(`/posts/${POST}-private`, friend);
  line('GET /posts/<private post>', `${priv.status} (indistinguishable from missing)`);
  await post('/admin/save', { originalSlug: `${POST}-private`, action: 'delete' }, owner);
} finally {
  await post('/admin/save', { originalSlug: POST, action: 'delete' }, owner);
  await post('/admin/save', { originalSlug: PUBLIC_POST, action: 'delete' }, owner);
  sql(`DELETE FROM members WHERE id = '${FRIEND_SUB}'`);
  console.log(`\n${'─'.repeat(66)}\ncleaned up\n`);
}
