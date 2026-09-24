import type { APIRoute } from 'astro';
import { posts as postStore, comments as commentStore } from '../../lib/data';
import { canView } from '../../lib/visibility';

export const prerender = false;

/**
 * Up or down vote on a comment. Approved members and owners only.
 *
 * Voting the same way twice retracts the vote — see `vote()` in
 * data/comments.ts. Only totals are ever rendered; the per-member rows exist
 * to make one-vote-each enforceable and retraction possible, not to be shown.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const { audience, viewer } = locals;

  if (!viewer || (audience !== 'circle' && audience !== 'owner')) {
    return new Response(null, { status: 404 });
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });

  const form = await request.formData();
  const commentId = String(form.get('id') ?? '');
  const direction = String(form.get('direction') ?? '');

  if (!commentId || !['up', 'down'].includes(direction)) {
    return new Response(null, { status: 400 });
  }

  // Derive the post from the comment rather than trusting a form field, then
  // re-check that this viewer may read it. Otherwise an approved member could
  // vote on a thread attached to a post they cannot see.
  const slug = await commentStore.postSlugOf(commentId);
  if (!slug) return new Response(null, { status: 404 });

  const post = await postStore.get(slug);
  if (!post || !canView(post.data, audience, viewer)) {
    return new Response(null, { status: 404 });
  }

  await commentStore.vote(commentId, viewer.sub, direction === 'up' ? 1 : -1);

  return new Response(null, {
    status: 303,
    headers: {
      Location: `/posts/${encodeURIComponent(slug)}#c-${commentId}`,
      'Cache-Control': 'private, no-store',
    },
  });
};
