import { db } from './bindings';
import { toProject, type Project, type ProjectRow } from './types';
import type { Audience } from '../visibility';

/** Same narrowing rationale as posts.ts: an optimisation, never the decision. */
function audienceFilter(audience: Audience): string {
  switch (audience) {
    case 'owner':
      return '1 = 1';
    case 'circle':
      return "visibility IN ('public', 'circle')";
    default:
      return "visibility = 'public'";
  }
}

export async function list(audience: Audience): Promise<Project[]> {
  const { results } = await db()
    .prepare(
      `SELECT * FROM projects
       WHERE ${audienceFilter(audience)}
       ORDER BY sort_order, title`,
    )
    .all<ProjectRow>();

  return (results ?? []).map(toProject);
}

export interface ProjectInput {
  slug: string;
  title: string;
  description?: string;
  status: string;
  demo?: string;
  repo?: string;
  stack?: string[];
  visibility: string;
  allow?: string[];
  order?: number;
}

export async function upsert(input: ProjectInput): Promise<void> {
  const now = new Date().toISOString();

  await db()
    .prepare(
      `INSERT INTO projects (
         slug, title, description, status, demo_url, repo_url, stack,
         visibility, allow, sort_order, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
       ON CONFLICT (slug) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         status = excluded.status,
         demo_url = excluded.demo_url,
         repo_url = excluded.repo_url,
         stack = excluded.stack,
         visibility = excluded.visibility,
         allow = excluded.allow,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.slug,
      input.title,
      input.description ?? '',
      input.status,
      input.demo ?? null,
      input.repo ?? null,
      JSON.stringify(input.stack ?? []),
      input.visibility,
      JSON.stringify(input.allow ?? []),
      input.order ?? 0,
      now,
    )
    .run();
}

export async function remove(slug: string): Promise<void> {
  await db().prepare('DELETE FROM projects WHERE slug = ?1').bind(slug).run();
}
