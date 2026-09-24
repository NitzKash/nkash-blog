import { db } from './bindings';

export interface Comment {
  id: string;
  postSlug: string;
  memberId: string;
  /** Handle if they picked one, otherwise their provider login. */
  author: string;
  authorAvatar?: string;
  body: string;
  html: string;
  hidden: boolean;
  createdAt: Date;
  /** Totals only. Who voted is never exposed beyond the viewer's own vote. */
  upvotes: number;
  downvotes: number;
  /** This viewer's own vote, so the buttons can show as pressed. */
  myVote: -1 | 0 | 1;
}

interface CommentRow {
  id: string;
  post_slug: string;
  member_id: string;
  body: string;
  html: string;
  hidden: number;
  created_at: string;
  username: string | null;
  login: string | null;
  avatar: string | null;
  upvotes: number | null;
  downvotes: number | null;
  my_vote: number | null;
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    postSlug: row.post_slug,
    memberId: row.member_id,
    // Joined live rather than snapshotted, so changing a handle renames past
    // comments too — which is what someone changing it for privacy expects.
    author: row.username ?? row.login ?? 'someone',
    authorAvatar: row.avatar ?? undefined,
    body: row.body,
    html: row.html,
    hidden: row.hidden === 1,
    createdAt: new Date(row.created_at),
    upvotes: row.upvotes ?? 0,
    downvotes: row.downvotes ?? 0,
    myVote: (row.my_vote ?? 0) as -1 | 0 | 1,
  };
}

/**
 * Tallies are aggregated in SQL rather than fetched per comment, so a thread
 * of any length costs one query. `?2` is the viewer's id — used only to read
 * back their own vote, never to expose anyone else's.
 */
const SELECT = `
  SELECT c.*, m.username, m.login, m.avatar,
         COALESCE(v.up, 0)   AS upvotes,
         COALESCE(v.down, 0) AS downvotes,
         COALESCE(mine.value, 0) AS my_vote
  FROM comments c
  LEFT JOIN members m ON m.id = c.member_id
  LEFT JOIN (
    SELECT comment_id,
           SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END)  AS up,
           SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS down
    FROM comment_votes GROUP BY comment_id
  ) v ON v.comment_id = c.id
  LEFT JOIN comment_votes mine ON mine.comment_id = c.id AND mine.member_id = ?2
`;

/**
 * A post's thread, oldest first.
 *
 * Hidden comments are returned only to an owner, so moderation can be undone
 * from the page itself rather than from the database.
 */
export async function list(
  postSlug: string,
  includeHidden = false,
  viewerId = '',
): Promise<Comment[]> {
  const { results } = await db()
    .prepare(
      `${SELECT} WHERE c.post_slug = ?1 ${includeHidden ? '' : 'AND c.hidden = 0'}
       ORDER BY c.created_at`,
    )
    .bind(postSlug, viewerId)
    .all<CommentRow>();

  return (results ?? []).map(toComment);
}

/**
 * Casts, changes or retracts a vote.
 *
 * Voting the same way twice retracts — the button is a toggle, which is what
 * people expect and what makes a mis-click undoable. The composite primary key
 * means a change is an upsert, not a second row, so a member can never hold
 * two votes on one comment.
 */
export async function vote(commentId: string, memberId: string, value: 1 | -1): Promise<void> {
  const existing = await db()
    .prepare('SELECT value FROM comment_votes WHERE comment_id = ?1 AND member_id = ?2')
    .bind(commentId, memberId)
    .first<{ value: number }>();

  if (existing?.value === value) {
    await db()
      .prepare('DELETE FROM comment_votes WHERE comment_id = ?1 AND member_id = ?2')
      .bind(commentId, memberId)
      .run();
    return;
  }

  await db()
    .prepare(
      `INSERT INTO comment_votes (comment_id, member_id, value, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (comment_id, member_id) DO UPDATE SET value = excluded.value`,
    )
    .bind(commentId, memberId, value, new Date().toISOString())
    .run();
}

/** Confirms a comment exists and which post it belongs to, before voting. */
export async function postSlugOf(commentId: string): Promise<string | null> {
  const row = await db()
    .prepare('SELECT post_slug FROM comments WHERE id = ?1')
    .bind(commentId)
    .first<{ post_slug: string }>();
  return row?.post_slug ?? null;
}

export async function add(input: {
  postSlug: string;
  memberId: string;
  body: string;
  html: string;
}): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO comments (id, post_slug, member_id, body, html, hidden, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)`,
    )
    .bind(
      crypto.randomUUID(),
      input.postSlug,
      input.memberId,
      input.body,
      input.html,
      new Date().toISOString(),
    )
    .run();
}

export async function setHidden(id: string, hidden: boolean): Promise<void> {
  await db()
    .prepare('UPDATE comments SET hidden = ?2 WHERE id = ?1')
    .bind(id, hidden ? 1 : 0)
    .run();
}

/**
 * How many comments this member has posted since `since`.
 *
 * Everyone who can comment is already approved by hand, so this is not a spam
 * defence — it is a guard against a loop, a double-submit, or a broken script,
 * which is the realistic failure among people you trust.
 */
export async function recentCount(memberId: string, since: Date): Promise<number> {
  const row = await db()
    .prepare('SELECT count(*) AS n FROM comments WHERE member_id = ?1 AND created_at > ?2')
    .bind(memberId, since.toISOString())
    .first<{ n: number }>();

  return row?.n ?? 0;
}

/** Thread sizes for a set of slugs, for showing counts on listings. */
export async function countsFor(slugs: string[]): Promise<Map<string, number>> {
  if (slugs.length === 0) return new Map();

  const placeholders = slugs.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db()
    .prepare(
      `SELECT post_slug, count(*) AS n FROM comments
       WHERE hidden = 0 AND post_slug IN (${placeholders})
       GROUP BY post_slug`,
    )
    .bind(...slugs)
    .all<{ post_slug: string; n: number }>();

  return new Map((results ?? []).map((r) => [r.post_slug, r.n]));
}
