# blogs.nkash.dev

A personal site with three content tiers — **public**, **circle**, **private** — running as a
single Cloudflare Worker for ₹0/month plus the domain.

Static hosting can't gate content and managed auth wants a subscription, so the interesting
part is doing tiered access on free infrastructure without a server.

---

## How it works

```
  reader
    │
    ▼
  Cloudflare edge ──── cached public HTML ────────────────► served, no Worker invoked
    │
    ▼ (cache miss, or a gated URL)
  Worker
    │
    ├─ middleware.ts ......... resolves the viewer from a signed cookie
    ├─ membership.ts ......... env lists first, then the members table
    ├─ canView(item, …) ...... the one authorisation decision in the codebase
    └─ lib/data/ ............. the only code that touches D1 or R2
```

**Authentication** is a stateless session: a JSON payload plus an HMAC-SHA256 signature in an
`HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`-prefixed cookie. No session store.

**Authorisation** is resolved per request, never baked into the token. Approving or revoking
someone takes effect on their next page load rather than at cookie expiry.

**`canView()` fails closed** in four separate places: the D1 column defaults to `private` with a
`CHECK` constraint, the row parser maps anything unrecognised to `private`, the save handler
falls back to `private`, and `canView` itself returns false for any value it doesn't know. The
failure mode is silent disclosure, and nobody gets an alert for that.

### What each tier does

| Tier | Signed out | Signed in, not approved | Approved | Owner |
|---|---|---|---|---|
| `public` | reads it | reads it | reads it | reads it |
| `circle` | `401` + sign-in prompt | `403` | reads it | reads it |
| `private` | `404` | `404` | `404` | reads it |

`circle` admits the post exists, because those links are meant to be shared and a 404 would
confuse someone who was sent one. `private` returns a response byte-identical to a slug that was
never written, so owner-only drafts aren't probeable. Neither appears in the index, the archive,
`sitemap.xml` or `rss.xml`.

`draft: true` forces owner-only regardless of the declared tier.

### Members

Signing in is not being let in. A first sign-in records a `pending` row, which grants exactly
what a stranger gets — the only difference is the message. The owner approves by hand at
`/admin/members`.

New members are offered a **handle**, so they don't have to carry a GitHub login or a work email
around the site. The provider identity stays visible only to an owner deciding whether to
approve them.

### Comments

Approved members and owners can comment and vote; everyone who can read a post can read its
thread. Comments inherit the post's visibility rather than carrying their own, so there is one
authorisation decision rather than two that can drift apart.

Votes show a total and never who voted — but a per-member row exists underneath, because
without one a single person could vote repeatedly. Voting the same way twice retracts it.

Comments are the only untrusted HTML on the site and deliberately never touch the renderer used
for post bodies, which allows raw HTML on the reasoning that the author is the operator.
`lib/comment-markdown.ts` escapes every character *before* applying any formatting, so no point
exists at which attacker-supplied markup is in the string being built. Bold, italic, code and
bare links are supported; images, headings, raw HTML and arbitrary link text are not.

---

## Running it

```bash
npm install
cp .dev.vars.example .dev.vars     # then fill it in, see below
npm run db:migrate                 # local D1
npm run dev                        # http://localhost:4321
```

```bash
npm test              # 108 unit tests over the auth core and the comment renderer
npm run smoke         # 55 end-to-end checks across tiers, comments and votes
npm run walkthrough   # prints a new reader's whole journey, step by step
npm run check         # types
```

`npm run smoke` and `npm run walkthrough` need the dev server running. Both create their own
throwaway posts and delete them afterwards — they never touch real content.

### Environment

Everything lives in `.dev.vars` locally (gitignored) and Cloudflare secrets in production. See
`.dev.vars.example` for the full list.

| | |
|---|---|
| `SESSION_SECRET` | signs session cookies · `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"` |
| `OWNERS` | comma-separated logins/emails with full access |
| `CIRCLE` | optional bootstrap list; the approval queue is the normal path |
| `GITHUB_CLIENT_ID` / `_SECRET` | from <https://github.com/settings/developers> |
| `GOOGLE_CLIENT_ID` / `_SECRET` | optional, from <https://console.cloud.google.com/apis/credentials> |

**A provider appears only when both its keys are set.** With neither, public posts still work
and the gated tiers are simply unreachable. An unconfigured provider's URL returns 404 rather
than an error, so it's indistinguishable from a route that doesn't exist.

Both providers share **one callback URL** — which provider is in flight travels in the OAuth
`state`, not the path, so adding a third needs no new redirect URI anywhere:

```
local:      http://localhost:4321/auth/callback
production: https://blogs.nkash.dev/auth/callback
```

Only **verified** email addresses are trusted. The access list matches on email, so accepting an
unverified one would make it forgeable.

---

## Writing

Posts live in **D1**, not in this repository. Committing them would put private writing
somewhere the site's access control doesn't reach.

Sign in as an owner and the nav gains `write` and `members`. `/admin/editor` is a plain markdown
textarea — tab indents, ⌘S saves — with visibility as three radio buttons. **Creating defaults to
private; updating keeps whatever the post already is.**

Markdown is rendered once at save time, not per request: the free plan allows 10ms of CPU per
request, and parsing produces byte-identical output every time. The source is stored alongside
for bulk re-rendering.

`scripts/import-markdown.mjs <dir>` bulk-loads markdown files for drafts written outside the
browser.

---

## Deploying

```bash
npx wrangler login
npx wrangler d1 create nkash-blog            # paste the id into wrangler.jsonc
npx wrangler d1 migrations apply nkash-blog --remote

npx wrangler secret put SESSION_SECRET        # a different one from dev
npx wrangler secret put OWNERS
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID      # optional
npx wrangler secret put GOOGLE_CLIENT_SECRET  # optional

npm run deploy
```

R2 is **not** part of this: its binding is commented out in `wrangler.jsonc` because enabling
R2 needs a one-time dashboard activation that asks for a payment method, and nothing in the
request path touches it until image upload exists. Uncomment and create the bucket then.

`wrangler.jsonc` declares `blogs.nkash.dev` as a custom domain, so the first deploy provisions
the DNS record and the certificate automatically when the zone is in the same account.

The `__Host-` cookie prefix binds the session to `blogs.nkash.dev` exactly. A future app on a
sibling subdomain can't read it — that's the intended isolation, and it means sign-in doesn't
carry across subdomains.

### Backups

```bash
npm run db:backup        # production → backups/ (gitignored; dumps contain private posts)
```

D1's Time Travel already covers accidental deletes for 30 days and is always on. This is for
what it doesn't cover: an account problem, a free-tier change, or wanting the data somewhere
that isn't Cloudflare.

### Free-tier limits worth knowing

- **100,000 Worker requests/day.** Static assets don't count, and public pages carry
  `s-maxage=3600` so the edge serves them without invoking the Worker.
- **10ms CPU per request.** Fine for auth and rendering, useless for anything compute-heavy —
  demos that need real work run off-platform and are linked from `/projects`.
- **D1: 5 GB, 5M row reads/day, 100k writes/day.** Row reads count rows *examined*, not
  returned, which is why every query path has a covering index.
- **R2: 10 GB, no egress charges** — not enabled yet, see above.

---

## Layout

```
src/
├── access.config.ts        parses OWNERS / CIRCLE from the environment
├── content.config.ts       projects only; posts live in D1
├── middleware.ts           resolves the viewer once per request
├── lib/
│   ├── visibility.ts       canView() — the only authorisation decision
│   ├── membership.ts       env lists, then the members table
│   ├── markdown.ts         render, slugify, excerpt, reading time
│   ├── username.ts         handle validation and suggestions
│   ├── cache.ts            public s-maxage vs private no-store
│   ├── env.ts              the Cloudflare seam; rewrite this to move hosts
│   ├── redirect.ts         open-redirect guard for ?next=
│   ├── auth/               sessions, OAuth, providers
│   └── data/               D1 and R2 — the only code that names a binding
├── pages/
│   ├── posts/[...slug].astro   the gate
│   ├── admin/                  editor, post list, approval queue
│   ├── welcome.astro           handle picker
│   ├── sitemap.xml.ts          public tier only, never reads the session
│   └── rss.xml.ts              same
migrations/                 D1 schema
tests/                      auth core, markdown, handles
scripts/                    smoke, walkthrough, backup, import
docs/                       DECISIONS.md and the original architecture sketch
```

Authentication and authorisation are deliberately separate: `middleware.ts` decides *who you
are*, `visibility.ts` decides *what you may read*. One place to audit for each.

`docs/DECISIONS.md` has the reasoning behind the choices above.
[`CHANGELOG.md`](CHANGELOG.md) records what changed in each release.

## Licence

MIT for the engine. Post content is not licensed for reuse.
