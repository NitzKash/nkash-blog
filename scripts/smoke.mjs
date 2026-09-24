/**
 * End-to-end check of the access tiers against a running dev server.
 *
 *   npm run dev        # in one terminal
 *   npm run smoke
 *
 * The suite is hermetic: it creates one throwaway post per tier through the
 * real save endpoint, asserts against those, and deletes them at the end. It
 * never references real content — partly so it keeps working when posts are
 * added or removed, and partly because asserting on a private post's title
 * would mean committing that title to a public repository.
 *
 * Verifies that gated content never appears in an anonymous response, that
 * private posts are indistinguishable from missing ones, that the feeds never
 * carry a gated slug, that the right people do get in, and that forged cookies
 * do not.
 */

import { mint, ownerIdentity } from './mint-session.mjs';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4321';

/**
 * The server drops the `__Host-` prefix on loopback http, because Safari
 * refuses Secure cookies there. Deriving the name the same way means these
 * scripts send what a browser would actually send.
 */
const COOKIE_NAME = /^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(BASE)
  ? 'session'
  : '__Host-session';

const RUN = Math.random().toString(36).slice(2, 8);
const FIXTURES = {
  public: { slug: `smoke-${RUN}-public`, title: `Smoke public ${RUN}`, visibility: 'public' },
  circle: { slug: `smoke-${RUN}-circle`, title: `Smoke circle ${RUN}`, visibility: 'circle' },
  private: { slug: `smoke-${RUN}-private`, title: `Smoke private ${RUN}`, visibility: 'private' },
};
const MARKER = `## Body marker ${RUN}`;

const OWNER = ownerIdentity();
const STRANGER = { sub: 'test:stranger', login: 'not-on-any-list', email: 'stranger@example.com' };

let failures = 0;

function check(name, condition, detail = '') {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail && !condition ? `\n          ${detail}` : ''}`);
}

async function get(path, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {},
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

/**
 * A "this page does not contain X" assertion is worthless if the page is an
 * error, so every negative check is gated on the page having actually
 * rendered. Without this, a 500 makes the whole suite look green.
 */
const rendered = (r) =>
  r.status === 200 && r.body.includes('</html>') && !r.body.includes('Internal Server Error');

const ownerCookie = mint(OWNER);

async function save(fields) {
  const response = await fetch(`${BASE}/admin/save`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: `${COOKIE_NAME}=${ownerCookie}`,
      Origin: BASE,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  });
  return response.status;
}

async function setUp() {
  for (const f of Object.values(FIXTURES)) {
    const status = await save({
      slug: f.slug,
      title: f.title,
      visibility: f.visibility,
      pubDate: '2026-01-01',
      body: `${MARKER}\n\nThrowaway fixture for the smoke suite.`,
    });
    if (status !== 303) {
      console.error(`\nCould not create fixture ${f.slug} (status ${status}).`);
      console.error('Is the dev server running, and is OWNERS set in .dev.vars?\n');
      process.exit(1);
    }
  }
}

async function tearDown() {
  for (const f of Object.values(FIXTURES)) {
    await save({ originalSlug: f.slug, action: 'delete' });
  }
}

console.log(`\nSmoke test against ${BASE}  (run ${RUN})\n`);
await setUp();

try {
  // -------------------------------------------------------------------------
  console.log('Anonymous visitor:');

  const home = await get('/');
  check('/ returns 200', home.status === 200, `got ${home.status}`);
  check('/ lists the public post', home.body.includes(FIXTURES.public.title));
  check(
    '/ does not leak the circle post',
    rendered(home) && !home.body.includes(FIXTURES.circle.title),
  );
  check(
    '/ does not leak the private post',
    rendered(home) && !home.body.includes(FIXTURES.private.title),
  );
  check(
    '/ is edge-cacheable for anonymous readers',
    (home.headers.get('cache-control') ?? '').includes('s-maxage'),
    `cache-control: ${home.headers.get('cache-control')}`,
  );

  const publicPost = await get(`/posts/${FIXTURES.public.slug}`);
  check('public post returns 200', publicPost.status === 200, `got ${publicPost.status}`);
  check('public post renders its body', publicPost.body.includes('Body marker'));

  const circlePost = await get(`/posts/${FIXTURES.circle.slug}`);
  check('circle post returns 401 to a stranger', circlePost.status === 401, `got ${circlePost.status}`);
  check(
    'circle post body contains no content',
    circlePost.status === 401 && !circlePost.body.includes('Body marker'),
  );
  check(
    'circle post is not cacheable',
    (circlePost.headers.get('cache-control') ?? '').includes('no-store'),
    `cache-control: ${circlePost.headers.get('cache-control')}`,
  );

  const privatePost = await get(`/posts/${FIXTURES.private.slug}`);

  // The control slug is the same length as the real one, because the 404 page
  // echoes the requested path back. Comparing against a different-length path
  // would flag that echo as a leak when it isn't.
  const control = `${FIXTURES.private.slug.slice(0, -1)}X`;
  const missing = await get(`/posts/${control}`);
  const normalise = (body, slug) => body.replaceAll(slug, 'SLUG');

  check('private post returns 404', privatePost.status === 404, `got ${privatePost.status}`);
  check(
    'private post is indistinguishable from a missing one',
    privatePost.status === 404 &&
      privatePost.status === missing.status &&
      normalise(privatePost.body, FIXTURES.private.slug) === normalise(missing.body, control),
    `private=${privatePost.status}/${privatePost.body.length}b  control=${missing.status}/${missing.body.length}b`,
  );

  // -------------------------------------------------------------------------
  console.log('\nFeeds:');

  const sitemap = await get('/sitemap.xml');
  check('sitemap returns 200', sitemap.status === 200, `got ${sitemap.status}`);
  check('sitemap includes the public post', sitemap.body.includes(FIXTURES.public.slug));
  check(
    'sitemap excludes the circle post',
    sitemap.status === 200 && !sitemap.body.includes(FIXTURES.circle.slug),
  );
  check(
    'sitemap excludes the private post',
    sitemap.status === 200 && !sitemap.body.includes(FIXTURES.private.slug),
  );

  const rss = await get('/rss.xml');
  check('rss returns 200', rss.status === 200, `got ${rss.status}`);
  check('rss includes the public post', rss.body.includes(FIXTURES.public.title));
  check('rss excludes the circle post', rss.status === 200 && !rss.body.includes(FIXTURES.circle.slug));
  check(
    'rss excludes the private post',
    rss.status === 200 && !rss.body.includes(FIXTURES.private.slug),
  );

  // -------------------------------------------------------------------------
  console.log('\nOpen redirect:');

  const openRedirect = await get('/auth/logout?next=//evil.example.com');
  check(
    'logout refuses a protocol-relative next',
    openRedirect.headers.get('location') === '/',
    `location: ${openRedirect.headers.get('location')}`,
  );

  // -------------------------------------------------------------------------
  console.log('\nSigned in as an owner:');

  const ownerCircle = await get(`/posts/${FIXTURES.circle.slug}`, ownerCookie);
  check('owner can read the circle post', ownerCircle.status === 200, `got ${ownerCircle.status}`);
  check('owner sees the circle post body', ownerCircle.body.includes('Body marker'));

  const ownerPrivate = await get(`/posts/${FIXTURES.private.slug}`, ownerCookie);
  check('owner can read the private post', ownerPrivate.status === 200, `got ${ownerPrivate.status}`);
  check('owner sees the private post body', ownerPrivate.body.includes('Body marker'));

  const ownerIndex = await get('/', ownerCookie);
  check('owner index lists the private post', ownerIndex.body.includes(FIXTURES.private.title));
  check(
    'owner index is never edge-cached',
    (ownerIndex.headers.get('cache-control') ?? '').includes('no-store'),
    `cache-control: ${ownerIndex.headers.get('cache-control')}`,
  );

  // -------------------------------------------------------------------------
  console.log('\nOwner-only routes:');

  for (const path of ['/admin/posts', '/admin/members', '/admin/editor']) {
    check(`${path} is 404 to a stranger`, (await get(path)).status === 404);
  }
  check('/admin/posts is 200 to the owner', (await get('/admin/posts', ownerCookie)).status === 200);

  // -------------------------------------------------------------------------
  console.log('\nSigned in, but on no list:');

  const strangerCookie = mint(STRANGER);

  check(
    'gets 403 on a circle post',
    (await get(`/posts/${FIXTURES.circle.slug}`, strangerCookie)).status === 403,
  );
  check(
    'still gets 404 on a private post',
    (await get(`/posts/${FIXTURES.private.slug}`, strangerCookie)).status === 404,
  );
  check(
    'index shows them only public posts',
    !(await get('/', strangerCookie)).body.includes(FIXTURES.private.title),
  );
  check(
    'cannot reach the editor',
    (await get('/admin/editor', strangerCookie)).status === 404,
  );

  // -------------------------------------------------------------------------
  console.log('\nForged cookies:');

  // A valid signature paired with a payload claiming to be the owner. This is
  // the attack the HMAC exists to stop.
  const tampered = (() => {
    const [, signature] = ownerCookie.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...OWNER, sub: 'test:stranger', exp: 2 ** 31, iat: 0 }),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `${forged}.${signature}`;
  })();

  const privatePath = `/posts/${FIXTURES.private.slug}`;

  check(
    'a swapped payload on a valid signature is rejected',
    (await get(privatePath, tampered)).status === 404,
  );
  check(
    'an unsigned cookie is rejected',
    (await get(privatePath, 'eyJzdWIiOiJnaXRodWI6MSJ9')).status === 404,
  );
  check(
    'a cookie signed with the wrong secret is rejected',
    (await get(privatePath, mint(OWNER, 'wrong-secret'))).status === 404,
  );
  check('garbage in the cookie degrades to anonymous', (await get('/', '....')).status === 200);
} finally {
  await tearDown();
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
