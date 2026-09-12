import { db } from './bindings';
import type { Viewer } from '../visibility';

export type MemberStatus = 'pending' | 'approved' | 'blocked';

export interface Member {
  id: string;
  provider: string;
  login?: string;
  email?: string;
  name?: string;
  avatar?: string;
  status: MemberStatus;
  requestedAt: Date;
  lastSeenAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
  note?: string;
}

interface MemberRow {
  id: string;
  provider: string;
  login: string | null;
  email: string | null;
  name: string | null;
  avatar: string | null;
  status: string;
  requested_at: string;
  last_seen_at: string;
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
}

/** Unrecognised status becomes 'pending', which grants nothing. */
function toStatus(value: string): MemberStatus {
  return (['pending', 'approved', 'blocked'].includes(value) ? value : 'pending') as MemberStatus;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    provider: row.provider,
    login: row.login ?? undefined,
    email: row.email ?? undefined,
    name: row.name ?? undefined,
    avatar: row.avatar ?? undefined,
    status: toStatus(row.status),
    requestedAt: new Date(row.requested_at),
    lastSeenAt: new Date(row.last_seen_at),
    decidedAt: row.decided_at ? new Date(row.decided_at) : undefined,
    decidedBy: row.decided_by ?? undefined,
    note: row.note ?? undefined,
  };
}

export async function get(id: string): Promise<Member | null> {
  const row = await db().prepare('SELECT * FROM members WHERE id = ?1').bind(id).first<MemberRow>();
  return row ? toMember(row) : null;
}

/**
 * Called on every successful sign-in.
 *
 * Refreshes the profile fields and the last-seen timestamp, but **never**
 * touches `status`. A second sign-in must not reset an approval, and must not
 * quietly move a blocked person back into the pending queue.
 */
export async function record(viewer: Viewer): Promise<void> {
  const now = new Date().toISOString();
  const provider = viewer.sub.split(':')[0] ?? 'unknown';

  await db()
    .prepare(
      `INSERT INTO members (
         id, provider, login, email, name, avatar, status, requested_at, last_seen_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?7)
       ON CONFLICT (id) DO UPDATE SET
         login = excluded.login,
         email = excluded.email,
         name = excluded.name,
         avatar = excluded.avatar,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      viewer.sub,
      provider,
      viewer.login ?? null,
      viewer.email ?? null,
      viewer.name ?? null,
      viewer.avatar ?? null,
      now,
    )
    .run();
}

export async function list(status?: MemberStatus): Promise<Member[]> {
  const query = status
    ? db()
        .prepare('SELECT * FROM members WHERE status = ?1 ORDER BY requested_at')
        .bind(status)
    : db().prepare('SELECT * FROM members ORDER BY status, requested_at');

  const { results } = await query.all<MemberRow>();
  return (results ?? []).map(toMember);
}

export async function counts(): Promise<Record<MemberStatus, number>> {
  const { results } = await db()
    .prepare('SELECT status, COUNT(*) AS n FROM members GROUP BY status')
    .all<{ status: string; n: number }>();

  const out: Record<MemberStatus, number> = { pending: 0, approved: 0, blocked: 0 };
  for (const row of results ?? []) out[toStatus(row.status)] = row.n;
  return out;
}

export async function decide(
  id: string,
  status: MemberStatus,
  decidedBy: string,
  note?: string,
): Promise<void> {
  await db()
    .prepare(
      `UPDATE members
         SET status = ?2, decided_at = ?3, decided_by = ?4, note = COALESCE(?5, note)
       WHERE id = ?1`,
    )
    .bind(id, status, new Date().toISOString(), decidedBy, note ?? null)
    .run();
}
