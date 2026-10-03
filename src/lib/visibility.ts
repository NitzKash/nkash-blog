import type { Visibility } from '../content.config';
import { owners, circle } from '../access.config';

export interface Viewer {
  /** Stable provider id, e.g. `github:12345`. */
  sub: string;
  /** GitHub login, if the viewer signed in with GitHub. */
  login?: string;
  /** Verified email address only. Never an unverified one. */
  email?: string;
  name?: string;
  avatar?: string;
}

export type Audience = 'anonymous' | 'circle' | 'owner';

const norm = (s: string) => s.trim().toLowerCase();

export function matchesList(list: readonly string[], viewer: Viewer): boolean {
  const identities = new Set<string>();
  if (viewer.login) identities.add(norm(viewer.login));
  if (viewer.email) identities.add(norm(viewer.email));
  if (identities.size === 0) return false;
  return list.some((entry) => identities.has(norm(entry)));
}

/**
 * Audience from the environment lists alone.
 *
 * This is the bootstrap path and stays synchronous and dependency-free: an
 * owner can get in even if the database is empty, unreachable, or wrong.
 * Approved members are resolved on top of this by `resolveAudience()` in
 * lib/membership.ts, which needs a query and therefore cannot live here.
 */
export function audienceFromLists(viewer: Viewer | null): Audience {
  if (!viewer) return 'anonymous';
  if (matchesList(owners(), viewer)) return 'owner';
  if (matchesList(circle(), viewer)) return 'circle';
  // Signed in, but on no list. Treated exactly like a stranger until approved.
  return 'anonymous';
}

interface Gated {
  visibility: Visibility;
  allow?: readonly string[];
  draft?: boolean;
  /**
   * Provider subject of whoever wrote it. `null` or absent means the site
   * owner — posts written before authorship existed, and the reason there is
   * no real id baked into a migration in a public repository.
   */
  authorId?: string | null;
}

/** Did this viewer write it? */
export function isAuthor(item: Gated, viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return item.authorId ? item.authorId === viewer.sub : false;
}

/**
 * Is this viewer still entitled to the access authorship grants?
 *
 * Writing something does not entitle you to it forever. When someone is
 * removed from the circle or blocked they resolve to the anonymous audience,
 * and their private posts go with them: archived, readable by nobody,
 * including the person who wrote them.
 *
 * Their public and circle posts stay up — those were published to an audience
 * and taking them down would be editing the site's history rather than
 * revoking an individual's access.
 */
function hasStanding(audience: Audience): boolean {
  return audience === 'circle' || audience === 'owner';
}

/** An unattributed post belongs to the site owner. */
function isOwnerAuthored(item: Gated): boolean {
  return item.authorId == null;
}

/**
 * The single authorisation decision for the whole site. Every route that can
 * surface content calls this; nothing else is allowed to reason about tiers.
 *
 * `audience` is passed in rather than derived, because deriving it now needs a
 * database lookup. Middleware resolves it once per request and hands it to
 * every page through `Astro.locals`. Keeping this function synchronous and
 * pure is what makes it cheap to test exhaustively.
 *
 * Fails closed: an unrecognised visibility value returns false.
 */
export function canView(item: Gated, audience: Audience, viewer: Viewer | null): boolean {
  // Your own post is yours to read at any tier — for as long as you are still
  // a member. Lose standing and your private work is archived, not inherited.
  if (isAuthor(item, viewer) && hasStanding(audience)) return true;

  // An unattributed post is the site owner's, and they keep the access they
  // had before authorship existed.
  const ownerOwnsIt = isOwnerAuthored(item) && audience === 'owner';

  // Drafts are author-only. Being an owner does not open someone else's.
  if (item.draft) return ownerOwnsIt;

  if (item.visibility === 'public') return true;

  if (item.visibility === 'circle') {
    if (audience === 'circle' || audience === 'owner') return true;
    // Per-post grants widen `circle` only. They deliberately cannot open a
    // `private` post: "private" has to mean exactly one thing, or a stray
    // `allow:` line becomes a silent disclosure.
    return Boolean(viewer && item.allow?.length && matchesList(item.allow, viewer));
  }

  // `private` means the author alone — handled above. The owner reaches their
  // own unattributed posts here and nobody else's. Anything the schema failed
  // to catch lands here too, and is refused.
  if (item.visibility === 'private') return ownerOwnsIt;

  return false;
}

/**
 * May this viewer change the post?
 *
 * Narrower than reading, deliberately: an owner can read a contributor's
 * `circle` post but must not be able to rewrite it under their name. Deleting
 * is separate — see `canDelete`, which an owner does get, because moderating
 * your own site means being able to take something down.
 */
export function canEdit(item: Gated, audience: Audience, viewer: Viewer | null): boolean {
  if (isAuthor(item, viewer) && hasStanding(audience)) return true;
  return isOwnerAuthored(item) && audience === 'owner';
}

/** Authors remove their own; owners can take anything down. */
export function canDelete(item: Gated, audience: Audience, viewer: Viewer | null): boolean {
  return audience === 'owner' || canEdit(item, audience, viewer);
}

/**
 * May this viewer comment on this item?
 *
 * The rule is deliberately derived from `canView` rather than written
 * separately: you may comment on exactly what you may read. That means a
 * pending member can join the conversation on a public post while still being
 * unable to see anything gated, and it means there is no second authorisation
 * surface that can drift out of step with the first.
 *
 * Two additional conditions, both of which `canView` has no reason to know
 * about:
 *
 *   - Signed in. A comment needs an identity to attach to, so anonymous
 *     readers are out even on a fully public post.
 *   - Not blocked. Blocking resolves someone to the anonymous audience, which
 *     would otherwise still let them comment on public posts — and a block
 *     that does not stop commenting is not a block.
 */
export function canComment(
  item: Gated,
  audience: Audience,
  viewer: Viewer | null,
  memberStatus?: 'pending' | 'approved' | 'blocked',
): boolean {
  if (!viewer) return false;
  if (memberStatus === 'blocked') return false;
  return canView(item, audience, viewer);
}

/** Filter a collection down to what this viewer is allowed to see. */
export function visibleTo<T extends { data: Gated }>(
  items: T[],
  audience: Audience,
  viewer: Viewer | null,
): T[] {
  return items.filter((item) => canView(item.data, audience, viewer));
}
