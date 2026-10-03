import type { Visibility } from '../../content.config';

/**
 * The shape returned by the repositories.
 *
 * It deliberately mirrors an Astro content-collection entry — `id` plus a
 * `data` object — so that `visibleTo()`, `canView()` and the listing
 * components work against either source without knowing which one they got.
 */
export interface Post {
  id: string;
  data: {
    title: string;
    description: string;
    pubDate: Date;
    updatedDate?: Date;
    visibility: Visibility;
    allow: string[];
    tags: string[];
    draft: boolean;
    /** Provider subject of the author. Null means the site owner. */
    authorId: string | null;
  };
  /** Rendered at publish time. Empty on listing queries, which do not select it. */
  html: string;
  /** Markdown source, for the editor and for bulk re-rendering. Empty on listings. */
  body: string;
  readingMinutes: number;
  /** Byline for display. Absent for the site owner's unattributed posts. */
  author?: string;
}

export interface Project {
  id: string;
  data: {
    title: string;
    description: string;
    status: 'live' | 'building' | 'archived';
    demo?: string;
    repo?: string;
    stack: string[];
    visibility: Visibility;
    allow: string[];
    order: number;
  };
}

/** Raw D1 row shapes, before parsing. */
export interface PostRow {
  slug: string;
  title: string;
  description: string;
  visibility: string;
  draft: number;
  pub_date: string;
  updated_date: string | null;
  tags: string;
  allow: string;
  body: string;
  html: string;
  reading_minutes: number;
  author_id?: string | null;
  author_username?: string | null;
  author_login?: string | null;
}

export interface ProjectRow {
  slug: string;
  title: string;
  description: string;
  status: string;
  demo_url: string | null;
  repo_url: string | null;
  stack: string;
  visibility: string;
  allow: string;
  sort_order: number;
}

const VISIBILITIES = ['public', 'circle', 'private'];

/**
 * Anything unrecognised becomes `private`, matching the frontmatter schema's
 * default. A row written by hand with a typo in `visibility` must not become
 * readable — the CHECK constraint should prevent it, but this is the second
 * lock on the same door.
 */
export function toVisibility(value: string): Visibility {
  return (VISIBILITIES.includes(value) ? value : 'private') as Visibility;
}

/** Tolerates malformed JSON by returning an empty list rather than throwing. */
export function toStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function toPost(row: PostRow): Post {
  return {
    id: row.slug,
    data: {
      title: row.title,
      description: row.description,
      pubDate: new Date(row.pub_date),
      updatedDate: row.updated_date ? new Date(row.updated_date) : undefined,
      visibility: toVisibility(row.visibility),
      allow: toStringArray(row.allow),
      tags: toStringArray(row.tags),
      draft: row.draft === 1,
      authorId: row.author_id ?? null,
    },
    html: row.html ?? '',
    body: row.body ?? '',
    readingMinutes: row.reading_minutes || 1,
    // Handle first, provider login as fallback. Undefined for an unattributed
    // post, which is the site owner's and needs no byline.
    author: row.author_id ? (row.author_username ?? row.author_login ?? 'someone') : undefined,
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.slug,
    data: {
      title: row.title,
      description: row.description,
      status: (['live', 'building', 'archived'].includes(row.status)
        ? row.status
        : 'building') as Project['data']['status'],
      demo: row.demo_url ?? undefined,
      repo: row.repo_url ?? undefined,
      stack: toStringArray(row.stack),
      visibility: toVisibility(row.visibility),
      allow: toStringArray(row.allow),
      order: row.sort_order,
    },
  };
}
