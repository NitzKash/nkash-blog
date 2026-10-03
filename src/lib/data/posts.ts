import { db } from './bindings';
import { toPost, type Post, type PostRow } from './types';
import type { Audience } from '../visibility';

/**
 * Post storage.
 *
 * Callers pass the viewer's audience so the query can narrow in SQL. That is
 * an optimisation and a second lock, never the authorisation decision —
 * `canView()` in lib/visibility.ts remains the only thing that decides, and
 * every caller still runs results through `visibleTo()`. Narrowing here means
 * an anonymous request never reads a private row at all, which matters because
 * D1 bills rows *examined*.
 */

/** Listing queries omit `body` and `html`: two large columns nobody renders. */
const LIST_COLUMNS = `p.slug, p.title, p.description, p.visibility, p.draft, p.pub_date,
  p.updated_date, p.tags, p.allow, '' AS body, '' AS html, p.reading_minutes, p.author_id,
  m.username AS author_username, m.login AS author_login`;

/** Resolves the byline. Joined live so a changed handle renames past posts. */
const FROM = `FROM posts p LEFT JOIN members m ON m.id = p.author_id`;

/**
 * Narrows in SQL to what this viewer could possibly see.
 *
 * `?1` is the viewer's subject. Matching it lets an author reach their own
 * posts at any tier, which is what makes `private` mean "only me" rather than
 * "only the owner". This is still an optimisation and a second lock — canView
 * remains the decision, and every caller runs results through visibleTo.
 */
/**
 * Returns the WHERE clause and whether it references the viewer parameter.
 *
 * The anonymous branch does not, so binding one unconditionally is a
 * "Wrong number of parameter bindings" error at runtime. The flag travels with
 * the clause rather than being inferred at the call site, so the two cannot
 * drift apart.
 */
function audienceFilter(audience: Audience): { where: string; needsViewer: boolean } {
  const own = 'p.author_id = ?1';
  const published = 'p.draft = 0';

  switch (audience) {
    case 'owner':
      // Everything public and circle, their own posts, and the unattributed
      // ones that predate authorship. Not other people's private posts.
      return {
        where: `(${own} OR p.author_id IS NULL
                 OR (p.visibility IN ('public', 'circle') AND ${published}))`,
        needsViewer: true,
      };
    case 'circle':
      return {
        where: `(${own} OR (p.visibility IN ('public', 'circle') AND ${published}))`,
        needsViewer: true,
      };
    default:
      // No `own` clause on purpose. Anonymous covers both a stranger and a
      // removed or blocked member, and a removed member's private posts are
      // archived — including from the person who wrote them. Matching on
      // author here would hand them straight back.
      return { where: `(p.visibility = 'public' AND ${published})`, needsViewer: false };
  }
}

export async function list(audience: Audience, viewerId = ''): Promise<Post[]> {
  const { where, needsViewer } = audienceFilter(audience);

  const statement = db().prepare(
    `SELECT ${LIST_COLUMNS} ${FROM} WHERE ${where} ORDER BY p.pub_date DESC`,
  );

  const { results } = await (needsViewer ? statement.bind(viewerId) : statement).all<PostRow>();

  return (results ?? []).map(toPost);
}

export async function get(slug: string): Promise<Post | null> {
  const row = await db()
    .prepare(
      `SELECT p.*, m.username AS author_username, m.login AS author_login ${FROM}
       WHERE p.slug = ?1`,
    )
    .bind(slug)
    .first<PostRow>();

  return row ? toPost(row) : null;
}

/** Everything one author wrote, for their own post list. */
export async function listByAuthor(authorId: string): Promise<Post[]> {
  const { results } = await db()
    .prepare(`SELECT ${LIST_COLUMNS} ${FROM} WHERE p.author_id = ?1 ORDER BY p.pub_date DESC`)
    .bind(authorId)
    .all<PostRow>();

  return (results ?? []).map(toPost);
}

/**
 * Public, non-draft posts, for the sitemap and the feed.
 *
 * Separate from `list()` on purpose: these outputs are fetched by crawlers and
 * cached by everything in between, so there is no viewer in scope that could
 * widen them by accident.
 */
export async function listPublic(): Promise<Post[]> {
  const { results } = await db()
    .prepare(
      `SELECT ${LIST_COLUMNS} ${FROM}
       WHERE p.visibility = 'public' AND p.draft = 0
       ORDER BY p.pub_date DESC`,
    )
    .all<PostRow>();

  return (results ?? []).map(toPost);
}

export interface PostInput {
  slug: string;
  authorId: string;
  title: string;
  description?: string;
  visibility: string;
  draft?: boolean;
  pubDate: Date;
  updatedDate?: Date;
  tags?: string[];
  allow?: string[];
  body: string;
  html: string;
  readingMinutes: number;
}

/** Insert or replace. Used by the publish script, never by a request path. */
export async function upsert(input: PostInput): Promise<void> {
  const now = new Date().toISOString();

  await db()
    .prepare(
      `INSERT INTO posts (
         slug, title, description, visibility, draft, pub_date, updated_date,
         tags, allow, body, html, reading_minutes, created_at, updated_at, author_id
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14)
       ON CONFLICT (slug) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         visibility = excluded.visibility,
         draft = excluded.draft,
         pub_date = excluded.pub_date,
         updated_date = excluded.updated_date,
         tags = excluded.tags,
         allow = excluded.allow,
         body = excluded.body,
         html = excluded.html,
         reading_minutes = excluded.reading_minutes,
         updated_at = excluded.updated_at`,
      // author_id is deliberately absent from the UPDATE: editing a post must
      // never silently reassign who wrote it.
    )
    .bind(
      input.slug,
      input.title,
      input.description ?? '',
      input.visibility,
      input.draft ? 1 : 0,
      input.pubDate.toISOString(),
      input.updatedDate?.toISOString() ?? null,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.allow ?? []),
      input.body,
      input.html,
      input.readingMinutes,
      now,
      input.authorId,
    )
    .run();
}

export async function remove(slug: string): Promise<void> {
  await db().prepare('DELETE FROM posts WHERE slug = ?1').bind(slug).run();
}
