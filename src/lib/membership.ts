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
  /** Chosen handle, if they have one. */
  username?: string;
  /** True when this viewer has a member row and has not picked a handle yet. */
  needsUsername: boolean;
}

const ANONYMOUS: Membership = { audience: 'anonymous', needsUsername: false };

export async function resolveMembership(viewer: Viewer | null): Promise<Membership> {
  if (!viewer) return ANONYMOUS;

  const fromLists = audienceFromLists(viewer);
  // Owners and env-listed members are named by the site's own configuration,
  // so they are never asked to pick a handle.
  if (fromLists !== 'anonymous') return { audience: fromLists, needsUsername: false };

  let member: Awaited<ReturnType<typeof members.get>> = null;
  try {
    member = await members.get(viewer.sub);
  } catch (error) {
    // A database problem must not silently promote anyone, and must not break
    // the site for a signed-in reader either. Degrade to public-only.
    console.error('membership lookup failed', error);
    return ANONYMOUS;
  }

  if (!member) return { audience: 'anonymous', status: 'pending', needsUsername: false };

  const needsUsername = !member.username;

  if (member.status === 'approved') {
    return { audience: 'circle', status: 'approved', username: member.username, needsUsername };
  }

  // 'pending' and 'blocked' both see exactly what a stranger sees. They differ
  // only in what the sign-in page tells them.
  return {
    audience: 'anonymous',
    status: member.status,
    username: member.username,
    needsUsername,
  };
}

/**
 * Records a sign-in. Never changes an existing status — a second sign-in must
 * not reset an approval or move a blocked person back into the queue.
 *
 * Returns whether the member still has no handle, so the sign-in flow can send
 * a first-time visitor to pick one.
 */
export async function recordSignIn(viewer: Viewer): Promise<{ needsUsername: boolean }> {
  try {
    await members.record(viewer);
    const member = await members.get(viewer.sub);
    return { needsUsername: Boolean(member && !member.username) };
  } catch (error) {
    // Sign-in itself must still succeed; the person simply will not appear in
    // the approval queue until they return.
    console.error('could not record sign-in', error);
    return { needsUsername: false };
  }
}
