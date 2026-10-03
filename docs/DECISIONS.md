# Decisions

Why things are the way they are. Written because the reasoning is the part that
is expensive to reconstruct, and because this repo's history was started clean
before it went public — so the arguments live here rather than in `git log`.

---

## Hosting: Cloudflare Workers, not a server

Three access tiers need an auth check somewhere, and static hosting cannot do
that at all. The options were a server (real money, real ops), a managed auth
service (a subscription and a dependency), or a Worker.

Free tier: 100k Worker requests/day, unlimited static asset requests, 5 GB in
D1, 10 GB in R2 with no egress charges. Total recurring cost is the domain,
about ₹1,030/yr.

**The constraint that shapes everything: 10ms of CPU per request.** It is why
markdown is rendered at save time rather than per view, and why anything
computationally interesting has to run somewhere else and be linked to.

## One Worker, not a frontend and a backend

The original sketch (`docs/architecture/`) has them as two boxes. Logically
that holds and the code enforces it. Physically they are one Worker: two would
cost two invocations per page view against a 100k/day budget and add a network
hop inside the request, for nothing. An Astro SSR app already *is* a backend.

The separation is a module boundary instead. `lib/data/` is the only code that
names a binding or writes SQL. Moving off Cloudflare means rewriting that
directory and nothing above it.

## Not Django

Workers run V8 isolates — no process, no threads, no filesystem, no WSGI.
Django needs all four. Running it would mean a VM, which means ops, a monthly
bill, and reaching the database over the public internet instead of a binding
with no network hop. The language followed from the hosting decision, not the
other way round.

## Authorisation

**`canView()` in `lib/visibility.ts` is the only place that decides anything.**
Every route that can surface content calls it. It is synchronous and pure,
which is what makes it cheap to test exhaustively — 18 tests.

It **fails closed**. The frontmatter schema defaults `visibility` to private,
the D1 column defaults to private with a `CHECK` constraint, the row parser
maps anything unrecognised to private, and `canView` returns false for any
value it does not know. Four locks on the same door, because the failure mode
is silent disclosure and nobody gets an alert for it.

**Audience is a parameter, not derived.** Resolving it needs a database query
now, and making `canView` async would have made the one function most worth
testing much harder to test. Middleware resolves it once per request.

**Per-post `allow:` widens `circle` only.** It deliberately cannot open a
`private` post — "private" has to mean exactly one thing, or a stray line in
frontmatter becomes a disclosure. A unit test caught this being wrong.

## What each tier tells a stranger

| Tier | Signed out | Signed in, not approved | Approved | Owner |
|---|---|---|---|---|
| `public` | reads it | reads it | reads it | reads it |
| `circle` | `401` + prompt | `403` | reads it | reads it |
| `private` | `404` | `404` | `404` | reads it |

`circle` admits the post exists: those links are meant to be shared, and a 404
would confuse someone who was sent one. `private` returns a response identical
to a slug that was never written, so owner-only drafts are not probeable. The
smoke suite asserts that by normalising the slug out of both bodies and
comparing.

## Sessions

Stateless: a JSON payload and an HMAC-SHA256 signature in an `HttpOnly`,
`Secure`, `SameSite=Lax`, `__Host-`-prefixed cookie. No session store, so
nothing to run or expire on a schedule.

The `__Host-` prefix binds the cookie to one hostname with no `Domain`
attribute, so a future app on a sibling subdomain cannot read it. That costs
single sign-on across subdomains, deliberately: an experiment on
`demo.nkash.dev` should not share a session with the thing holding private
posts.

**Authorisation is re-read on every request, never baked into the token.** That
is what makes approving or revoking someone take effect immediately instead of
whenever their cookie happens to expire.

## Sign-in providers

GitHub and Google, sharing **one callback URL**. Which provider is in flight
travels in the OAuth `state`, not the path, so adding a third needs no new
redirect URI registered anywhere.

A provider is enabled by having credentials — there is no separate toggle to
forget. Its button appears only when both keys are set, and its URL returns 404
otherwise, so an unconfigured provider is indistinguishable from a route that
does not exist.

Only **verified** email addresses are trusted. The access list matches on
email, so accepting an unverified address would make it forgeable.

## The approval queue

Signing in is not being let in. A first sign-in records a `pending` row, which
grants exactly what a stranger gets — the only difference is the message. The
owner approves by hand at `/admin/members`.

Two sources, in order: the `OWNERS`/`CIRCLE` environment variables first and
with no query, then the `members` table. That ordering is why a database error
degrades to anonymous rather than failing the request — **a broken store must
deny rather than promote, but it must not lock the owner out either.** Both
halves are tested.

`blocked` is kept as a row rather than deleted, so a repeat sign-in does not
quietly reappear in the approval queue.

## Standing

Writing something does not entitle you to it forever. A removed or blocked
member resolves to the anonymous audience, and `canView` requires standing —
circle or owner — before authorship grants anything. So their private posts and
drafts go dark, **including to the person who wrote them**, and they can no
longer reach the editor.

Their public and circle posts stay up, byline intact. Those were published to
an audience, and pulling them would be rewriting the site's history rather than
revoking one person's access.

It is reversible: re-approving someone restores everything, because nothing is
deleted — only unreachable.

## Storage

**Rendered HTML is stored, not produced per request.** Markdown parsing yields
byte-identical output every time; doing it per view spends the 10ms budget for
nothing. The source is stored alongside for bulk re-rendering.

**Every query path has a covering index.** D1 bills rows *examined*, not rows
returned — an unindexed filter over 5,000 rows costs 5,000 reads to return one
post.

**The R2 bucket has no public URL.** Objects are served through the Worker so
the same `canView()` that gates a post gates its images. A public bucket URL
would be an unauthenticated side door around the entire tier system.

**A rename inserts at the new slug before deleting the old one.** The reverse
order loses the post if the insert fails.

## Caching

Public responses carry `s-maxage=3600` so Cloudflare's edge serves them without
waking the Worker — a busy day of public reading costs roughly one invocation
per edge location per hour, not one per reader. Gated responses are `no-store`
with `Vary: Cookie`, so a cached anonymous response can never reach a signed-in
reader or the reverse.

## What is not in this repo

Posts, identity, and secrets.

Posts live in D1 because committing them would put private writing in a public
repository, where the site's access control does not apply. `OWNERS` and
`CIRCLE` are environment variables for the same reason — a login or an email in
a public git history is permanent and searchable even after a later commit
removes it.

Only `*.vars.example` files are committed. The `.gitignore` rule is
deny-by-default (`*.vars`) rather than a list of known filenames, because the
list version already failed once: it covered `.dev.vars` and silently let a
`.prod.vars` holding production OAuth credentials get staged.

## Testing

The auth layer is hand-rolled, which makes it the liability worth testing —
58 unit tests plus 34 end-to-end checks.

`scripts/mint-session.mjs` reimplements the signing scheme rather than
importing `lib/auth/session.ts`. That independence is the point: a test that
imports the code it is testing still passes if both sides drift together.

Negative assertions are gated on the page having actually rendered. Without
that, a 500 makes "this page does not contain the private post" pass, and the
whole suite looks green while nothing works.
