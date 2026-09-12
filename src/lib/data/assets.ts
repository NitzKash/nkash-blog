import { db, media } from './bindings';

/**
 * Object storage for images and attachments.
 *
 * R2 holds the bytes; D1 holds a row per object. Keeping an index in SQL means
 * listing a post's images is one indexed `SELECT` rather than an R2 `LIST`,
 * and it gives each object a visibility that can be checked before the bytes
 * are ever fetched.
 *
 * The bucket is never public. Objects are served through the Worker so the
 * same `canView()` decision that gates a post also gates its images — a public
 * bucket URL would be an unauthenticated side door around the whole tier
 * system.
 */

export interface AssetRow {
  key: string;
  post_slug: string | null;
  content_type: string;
  size_bytes: number;
  visibility: string;
  created_at: string;
}

export async function head(key: string): Promise<AssetRow | null> {
  return db().prepare('SELECT * FROM assets WHERE key = ?1').bind(key).first<AssetRow>();
}

export async function body(key: string): Promise<R2ObjectBody | null> {
  return media().get(key);
}

export async function listForPost(slug: string): Promise<AssetRow[]> {
  const { results } = await db()
    .prepare('SELECT * FROM assets WHERE post_slug = ?1 ORDER BY created_at')
    .bind(slug)
    .all<AssetRow>();
  return results ?? [];
}

export interface AssetInput {
  key: string;
  postSlug?: string;
  contentType: string;
  bytes: ArrayBuffer | Uint8Array;
  visibility: string;
}

/**
 * Writes the object, then the index row.
 *
 * That order matters: a crash between the two leaves an orphaned object, which
 * is invisible and costs a few kilobytes. The reverse order would leave a row
 * pointing at nothing, which is a broken image on a live page.
 */
export async function put(input: AssetInput): Promise<void> {
  await media().put(input.key, input.bytes, {
    httpMetadata: { contentType: input.contentType },
  });

  await db()
    .prepare(
      `INSERT INTO assets (key, post_slug, content_type, size_bytes, visibility, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (key) DO UPDATE SET
         post_slug = excluded.post_slug,
         content_type = excluded.content_type,
         size_bytes = excluded.size_bytes,
         visibility = excluded.visibility`,
    )
    .bind(
      input.key,
      input.postSlug ?? null,
      input.contentType,
      input.bytes.byteLength,
      input.visibility,
      new Date().toISOString(),
    )
    .run();
}

/** Removes the index row first, so nothing can reference a deleted object. */
export async function remove(key: string): Promise<void> {
  await db().prepare('DELETE FROM assets WHERE key = ?1').bind(key).run();
  await media().delete(key);
}
