import type { Audience, Viewer } from './visibility';
import { audienceFromLists } from './visibility';
import * as members from './data/members';
import type { MemberStatus } from './data/members';

/**
 * Resolves what a signed-in viewer is entitled to, combining two sources:
 *
 *   1. The OWNERS / CIRCLE environment lists — the bootstrap. Checked first so
 *      an owner can always get in, even with an empty or unreachable database.
 *   2. The `members` table — people who signed in and were approved by hand.
 *
 * Anonymous requests never reach the database. That matters: the public path
 * is the cached one, and it stays free of queries entirely.
 */

export interface Membership {
  audience: Audience;
  /** Absent for anonymous visitors and for anyone covered by the env lists. */
  status?: MemberStatus;
}

export async function resolveMembership(viewer: Viewer | null): Promise<Membership> {
  if (!viewer) return { audience: 'anonymous' };

  const fromLists = audienceFromLists(viewer);
  if (fromLists !== 'anonymous') return { audience: fromLists };

  let member: Awaited<ReturnType<typeof members.get>> = null;
  try {
    member = await members.get(viewer.sub);
  } catch (error) {
    // A database problem must not silently promote anyone, and must not break
    // the site for a signed-in reader either. Degrade to public-only.
    console.error('membership lookup failed', error);
    return { audience: 'anonymous' };
  }

  if (!member) return { audience: 'anonymous', status: 'pending' };
  if (member.status === 'approved') return { audience: 'circle', status: 'approved' };

  // 'pending' and 'blocked' both see exactly what a stranger sees. They differ
  // only in what the sign-in page tells them.
  return { audience: 'anonymous', status: member.status };
}

/**
 * Records a sign-in. Never changes an existing status — a second sign-in must
 * not reset an approval or move a blocked person back into the queue.
 */
export async function recordSignIn(viewer: Viewer): Promise<void> {
  try {
    await members.record(viewer);
  } catch (error) {
    // Sign-in itself must still succeed; the person simply will not appear in
    // the approval queue until they return.
    console.error('could not record sign-in', error);
  }
}
