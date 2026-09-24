# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Section order is fixed** — `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` —
and sections with nothing in them are omitted rather than left empty. Entries describe what
changed for someone *using* the site, not which files moved; anything that needs the reasoning
rather than the outcome belongs in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## [Unreleased]

Nothing yet.

---

## [1.0.0] — 2026-09-25

First release. A personal blog with three access tiers running as a single Cloudflare Worker,
for the cost of the domain alone.

### Added

- **Three content tiers** — `public`, `circle` and `private`, set per post. Public is the open
  internet; circle is approved readers; private is owners only.
- **Sign-in with GitHub or Google**, sharing a single OAuth callback. Only verified email
  addresses are trusted.
- **An approval queue.** Signing in records a pending member who sees exactly what a stranger
  sees; the owner approves by hand at `/admin/members`. Blocked members are kept as rows so a
  repeat sign-in does not silently rejoin the queue.
- **Chosen handles**, so a reader need not carry a GitHub login or work email around the site.
  Offered with generated suggestions on first sign-in; never required.
- **An owner-only editor** at `/admin/editor` — markdown, tab-indent, ⌘S to save, with
  visibility as three radio buttons. Creating defaults to private; updating keeps the post's
  current tier.
- **Comments**, for approved members and owners, with up and down votes showing totals only.
  Voting the same way twice retracts it. Owners can hide a comment without deleting it.
- **D1 and R2 data layer** — posts, members, comments and votes in SQLite at the edge, behind
  a repository seam that is the only code aware of a Cloudflare binding.
- **RSS feed and sitemap**, built from the public tier alone and never consulting the session.
- `npm run db:backup` for full SQL dumps, alongside D1's own 30-day point-in-time recovery.
- `npm run smoke` (55 end-to-end checks) and `npm run walkthrough`, which prints a new reader's
  journey step by step. Both create their own throwaway posts and clean up after themselves.

### Changed

- **Posts moved from markdown files to D1.** Committing them would have put private writing in
  a repository the site's access control does not reach.
- **The access list moved from a source file to environment variables**, for the same reason —
  a login in a public git history is permanent and searchable even after removal.
- **Markdown renders at save time rather than per request.** The free plan allows 10ms of CPU
  per request and parsing produces byte-identical output every time.
- **Sign-in moved from the footer to the masthead**, where a reader looks for it.
- **Post pages cache for 5 minutes instead of an hour**, because an hour-old cache now means
  an hour-old comment thread. Listings still cache for an hour.

### Removed

- The `@astrojs/sitemap` integration, replaced by a hand-written endpoint that cannot enumerate
  a gated slug.
- Astro's `posts` content collection, superseded by D1.

### Fixed

- **Sign-in was impossible in Safari on `localhost`.** The session and OAuth state cookies were
  `__Host-` prefixed, which requires `Secure`, and Safari refuses `Secure` cookies over plain
  http on loopback. Both were silently dropped and every attempt failed with "request expired
  or did not match". Chrome and Firefox allow it, which is why it surfaced in only one browser,
  and `curl` enforces no cookie attributes at all, which is why the end-to-end suite stayed
  green throughout.
- **A per-post `allow:` grant could open a `private` post.** Grants were evaluated before the
  tier check, contradicting what the schema promised. They now widen `circle` only.

### Security

- **`canView()` is the single authorisation decision**, and it fails closed in four independent
  places: the D1 column defaults to `private` under a `CHECK` constraint, the row parser maps
  anything unrecognised to `private`, the save handler falls back to `private`, and `canView`
  itself refuses any value it does not know.
- **Private posts return a response byte-identical to a slug that was never written**, so
  owner-only drafts cannot be probed. Circle posts return `401` with a sign-in prompt, since
  those links are meant to be shared.
- **`/admin/*` and the comment endpoints return `404`, not `403`** — a `403` confirms a route
  exists.
- **Comments are the only untrusted HTML on the site and never touch the post renderer.**
  `lib/comment-markdown.ts` escapes every character before applying any formatting, so no
  moment exists at which attacker-supplied markup is in the string being built. Links carry
  `nofollow ugc noopener`; images, headings, raw HTML and arbitrary link text are unsupported.
- **Authorisation is resolved per request, never stored in the session cookie**, so approving
  or revoking a member takes effect on their next page load rather than at cookie expiry.
- Sessions are HMAC-SHA256 signed in `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookies.
  Forged, unsigned, expired and wrong-secret cookies are all refused, and all are tested.
- Gated responses are `no-store` with `Vary: Cookie`, so a shared cache can never hand one
  response to the wrong reader.
- `?next=` destinations are validated against open redirects, including protocol-relative and
  backslash forms.
- Every SQL statement is parameterised.

---

<!--
  TEMPLATE — copy this block under ## [Unreleased] when starting a new version.
  Delete any section you have nothing for; do not leave empty headings.

## [X.Y.Z] — YYYY-MM-DD

### Added
- New capability, described by what it does for a reader.

### Changed
- Existing behaviour that now works differently. Say what changed *to*.

### Deprecated
- Still present, going away. Name the release it goes away in if you know.

### Removed
- Gone. Note what replaced it, if anything.

### Fixed
- The bug, the symptom someone would have noticed, and why it was not caught.

### Security
- Hardening, or a vulnerability closed. Describe the exposure, not just the patch.

  Which number to bump:
    MAJOR  a reader or an integration has to change something
    MINOR  new capability, nothing existing breaks
    PATCH  fixes and internal work only
-->

[Unreleased]: https://github.com/NitzKash/nkash-blog/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/NitzKash/nkash-blog/releases/tag/v1.0.0
