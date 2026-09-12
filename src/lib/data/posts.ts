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
const LIST_COLUMNS = `slug, title, description, visibility, draft, pub_date, updated_date,
  tags, allow, '' AS body, '' AS html, reading_minutes`;

function audienceFilter(audience: Audience): string {
  switch (audience) {
    case 'owner':
      return '1 = 1';
    case 'circle':
      return "visibility IN ('public', 'circle') AND draft = 0";
    default:
      return "visibility = 'public' AND draft = 0";
  }
}

export async function list(audience: Audience): Promise<Post[]> {
  const { results } = await db()
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM posts
       WHERE ${audienceFilter(audience)}
       ORDER BY pub_date DESC`,
    )
    .all<PostRow>();

  return (results ?? []).map(toPost);
}

export async function get(slug: string): Promise<Post | null> {
  const row = await db()
    .prepare('SELECT * FROM posts WHERE slug = ?1')
    .bind(slug)
    .first<PostRow>();

  return row ? toPost(row) : null;
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
      `SELECT ${LIST_COLUMNS} FROM posts
       WHERE visibility = 'public' AND draft = 0
       ORDER BY pub_date DESC`,
    )
    .all<PostRow>();

  return (results ?? []).map(toPost);
}

export interface PostInput {
  slug: string;
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
         tags, allow, body, html, reading_minutes, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
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
    )
    .run();
}

export async function remove(slug: string): Promise<void> {
  await db().prepare('DELETE FROM posts WHERE slug = ?1').bind(slug).run();
}
