# blogs.nkash.dev

A personal site with three content tiers — **public**, **circle**, **private** — running as a
single Cloudflare Worker for ₹0/month plus the domain.

Static hosting can't gate content and managed auth wants a subscription, so the interesting
part is doing tiered access on free infrastructure without a database.

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
    ├─ middleware.ts ......... reads the signed cookie → Astro.locals.viewer
    │
    ├─ canView(item, viewer) . the one authorisation decision in the codebase
    │
    └─ render or refuse
```

**Authentication** is a stateless session: a JSON payload plus an HMAC-SHA256 signature in an
`HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`-prefixed cookie. No session store, so nothing
to run or back up.

**Authorisation** is re-evaluated from `src/access.config.ts` on every request rather than
baked into the token. Removing someone from the list locks them out at the next deploy even
though their cookie is still cryptographically valid. Rotating `SESSION_SECRET` invalidates
every session at once, immediately.

**The access list is a source file**, not a table. Granting access is a commit — attributable,
reviewable, revertable, free. The cost is that revocation waits ~60s for a deploy. If that
ever stops being an acceptable trade, move the two arrays into Cloudflare KV and read them in
`audienceOf()`; nothing else changes.

### What each tier does to a stranger

| Tier | Signed out | Signed in, not listed | Listed | Owner |
|---|---|---|---|---|
| `public` | reads it | reads it | reads it | reads it |
| `circle` | `401` + sign-in prompt | `403` | reads it | reads it |
| `private` | `404` | `404` | `404` | reads it |

`circle` admits the post exists, because circle links are meant to be shared and a 404 would
just confuse someone who was sent one. `private` returns a response byte-identical to a slug
that was never written, so owner-only drafts aren't probeable. Neither tier appears in the
index, the archive, `sitemap.xml` or `rss.xml`.

`draft: true` forces owner-only regardless of the declared visibility, so you can write a post
as `visibility: public` from the first commit without it going live when you push.

---

## Running it

```bash
npm install
cp .dev.vars.example .dev.vars     # then fill it in, see below
npm run dev                        # http://localhost:4321
```

```bash
npm test        # 29 unit tests over the auth core
npm run smoke   # end-to-end tier checks against a running dev server
npm run build   # production build
```

### Secrets

Generate a session secret:

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
```

### Sign-in providers

Two are supported, GitHub and Google. **A provider appears on the sign-in page only if both of
its keys are set**, so you can run with one, both, or neither — with neither, public posts still
work and the gated tiers are simply unreachable. An unconfigured provider's URL returns 404
rather than an error, so it is indistinguishable from a route that does not exist.

Both providers share one callback URL, because which provider is in flight travels in the
OAuth `state`, not the path. Adding a third provider needs no new redirect URI anywhere.

| | Callback URL |
|---|---|
| local | `http://localhost:4321/auth/callback` |
| production | `https://blogs.nkash.dev/auth/callback` |

- **GitHub** — <https://github.com/settings/developers> → New OAuth App. Scope is `user:email`
  only; no repository access. Leave *Allow wildcard matching* off: it would send tokens to every
  subdomain, which is exactly the isolation the `__Host-` cookie prefix exists to preserve.
- **Google** — <https://console.cloud.google.com/apis/credentials> → Create credentials → OAuth
  client ID → Web application. Scopes are `openid email profile`; no Gmail or Drive access.

Both are asked only for a **verified** email address, and an unverified one is discarded rather
than trusted — the access list matches on email, so accepting an unverified address would make
it forgeable.

Locally these go in `.dev.vars` (gitignored). In production they're Cloudflare secrets:

```bash
npx wrangler secret put SESSION_SECRET        # a DIFFERENT one from dev
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

---

## Writing

Markdown or MDX in `src/content/posts/`. The filename is the URL slug.

```yaml
---
title: 'Batching on the wafer line'
description: 'Throughput against p99, and why the obvious tradeoff is backwards.'
pubDate: 2026-09-20
visibility: public          # public | circle | private — defaults to private
allow: []                   # extra people for a `circle` post; cannot open a `private` one
tags: ['throughput']
draft: false
---
```

`visibility` defaults to **private**. A typo in the frontmatter fails the build via the Zod
schema; anything that somehow gets past it is refused by `canView()`. The system fails closed
in both places, on purpose.

Granting someone access — add their GitHub login or verified email to `src/access.config.ts`,
commit, push. Cloudflare redeploys in about a minute.

---

## Deploying

```bash
npx wrangler deploy
```

`wrangler.jsonc` declares `blogs.nkash.dev` as a custom domain, so the first deploy provisions
the DNS record and the TLS certificate automatically — the zone is already in the same
Cloudflare account. Or connect the repo in the dashboard (Workers & Pages → Create → Connect
to Git) for push-to-deploy, and set the three secrets in the project's settings.

Subdomains are free and unlimited once the zone exists, so project demos live at
`demo.nkash.dev` and friends.

One consequence of the `__Host-` cookie prefix: the session is bound to `blogs.nkash.dev`
exactly and cannot be read by a sibling subdomain. That's the intended isolation — a
compromised demo on `demo.nkash.dev` can't touch it — but it does mean signing in once won't
carry across to other subdomains. Sharing a session would require dropping the prefix and
setting `Domain=.nkash.dev`, which trades that isolation away; don't, unless you have a
reason.

### Free-tier limits worth knowing

- **100,000 Worker requests/day.** Static assets don't count, and public pages carry
  `s-maxage=3600` so the edge serves them without invoking the Worker. It fails closed at the
  cap rather than billing you.
- **10ms CPU per request.** Fine for auth and rendering, useless for anything compute-heavy —
  demos that need real work run off-platform and are linked from `/projects`.
- **500 builds/month.**

---

## Layout

```
src/
├── access.config.ts        who is an owner, who is in the circle
├── content.config.ts       frontmatter schema; visibility defaults to private
├── middleware.ts           resolves the viewer once per request
├── env.d.ts
├── lib/
│   ├── visibility.ts       canView() — the only authorisation decision
│   ├── cache.ts            public s-maxage vs private no-store
│   ├── env.ts              the Cloudflare seam; rewrite this to move hosts
│   ├── redirect.ts         open-redirect guard for ?next=
│   └── auth/
│       ├── session.ts      HMAC sign/verify, cookie attributes
│       └── github.ts       OAuth, verified-email-only
├── pages/
│   ├── posts/[...slug].astro   the gate
│   ├── sitemap.xml.ts          public tier only, never reads the session
│   └── rss.xml.ts              same
tests/                      auth core
scripts/smoke.mjs           end-to-end tier checks
```

Authentication and authorisation are deliberately separate: `middleware.ts` decides *who you
are*, `visibility.ts` decides *what you may read*. One place to audit for each.

## Licence

MIT for the engine. Post content is not licensed for reuse.
