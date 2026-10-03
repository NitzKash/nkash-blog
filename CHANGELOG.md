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

## [1.3.1] — 2026-10-04

### Fixed

- **A member removed from the circle kept access to their own private posts.** Authorship was
  checked before anything else, so losing approval revoked nothing a person had written. It now
  requires current standing: removed and blocked members lose their private posts, their drafts
  and the editor — including their own work.

  Their **public and circle posts stay up**, byline intact. Those were published to an audience,
  and pulling them would be rewriting the site's history rather than revoking one person's
  access. Nothing is deleted, so re-approving someone restores everything.

  The same gap existed in the database query, which matched on author regardless of standing and
  would have returned the rows even with the check corrected.

---

## [1.3.0] — 2026-10-03

### Added

- **Approved members can write posts.** The editor, preview and post list are no longer
  owner-only; anyone in the circle can publish at any tier.
- **Bylines** on the index, the archive and the post page, showing the author's handle. Posts by
  the site owner carry no byline — they are the default, and marking every one would be noise.

### Changed

- **`private` now means the author alone**, where it used to mean "owners only". The old
  definition broke as soon as there was more than one writer: a contributor's private post would
  have been readable by the site owner and not by the person who wrote it. The consequence is
  deliberate — **the owner no longer has site-level access to someone else's private posts**, and
  `/posts/<slug>` returns the same 404 it gives anyone. The operator can still read the row from
  the database, as on any hosted system.
- Editing is narrower than reading: an owner can read a contributor's `circle` post but cannot
  rewrite it under their name. Deleting is wider than editing, because moderating a site means
  being able to take something down even when you may not change it.
- **The homepage intro** leads with the range — fintech, high-throughput payment calculation,
  document-understanding computer vision, CRM connectors — rather than a job title. Meta and RSS
  descriptions updated to match, since those are what search results and link previews show.
- Two editor labels this release falsified: **Friends** now reads "members approved by the
  admin", and **Draft** is author-only rather than owner-only.

---

## [1.2.0] — 2026-10-03

### Added

- **A Write / Preview tab in the editor.** Preview renders on the server through the same
  pipeline that publishing uses, so what you see is what gets stored — the end-to-end suite
  asserts the two are byte-identical. A browser-side renderer would have been faster but could
  disagree with the published result, and that disagreement would only surface after saving.
- **A markdown toolbar** — bold, italic, link, inline code, heading and bullet list — acting on
  the current selection, plus **⌘B**, **⌘I** and **⌘K**. Link is selection-aware: select a URL
  and it becomes the target, select words and they become the label, with the cursor landing on
  whichever half is still empty.
- **A collapsed markdown reference** under the editor, covering the syntax the toolbar has no
  button for: headings, lists, quotes, rules, fenced code blocks with language highlighting,
  and tables.

---

## [1.1.0] — 2026-09-26

### Added

- **Six colour themes** — Auto, Midnight, Forest, Rose, Sand and Mono — chosen from swatches in
  the footer and remembered between visits. **Auto is the default and follows your system**, so
  a reader who never touches the control gets something suited to their machine rather than the
  author's preference.
- Contrast is now verified rather than eyeballed: every palette is checked against WCAG AA
  straight from the stylesheet, so a future theme cannot quietly become unreadable. Body text,
  secondary text and links must clear 4.5:1, metadata 3:1, including against raised surfaces.
- A `prefers-reduced-motion` guard covering the whole site. It overrides any theme, because
  someone who turned that on did so deliberately.

### Changed

- **Anyone signed in can comment on a post they can read.** Commenting was approved-members-only,
  which meant a reader who signed in to reply on a fully public post was told to wait for
  approval. Circle and private posts are unchanged, and blocking still prevents commenting
  everywhere.
- Body type is slightly larger and more loosely set, which was the better half of the old
  Simple mode.

### Removed

- The **Simple / Minimal** mode switch. The two differed by six tokens, which is not a choice
  worth asking anyone to make. Simple's typography became the baseline and colour themes
  replaced the control.

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

[Unreleased]: https://github.com/NitzKash/nkash-blog/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/NitzKash/nkash-blog/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/NitzKash/nkash-blog/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/NitzKash/nkash-blog/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/NitzKash/nkash-blog/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/NitzKash/nkash-blog/releases/tag/v1.0.0
