import type { APIRoute } from 'astro';
import { posts as postStore, comments as commentStore } from '../../lib/data';
import { canComment } from '../../lib/visibility';
import {
  renderComment,
  validateComment,
  COMMENT_MESSAGES,
  MAX_COMMENT_LENGTH,
} from '../../lib/comment-markdown';

export const prerender = false;

/** Five in ten minutes. Not a spam defence — see the note in data/comments.ts. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MINUTES = 10;

const seeOther = (location: string): Response =>
  new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'private, no-store' },
  });

const back = (slug: string, params: Record<string, string> = {}): Response => {
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query}` : '';
  return seeOther(`/posts/${encodeURIComponent(slug)}${suffix}#comments`);
};

export const POST: APIRoute = async ({ request, locals, url }) => {
  const { audience, viewer, memberStatus } = locals;

  // Anyone signed in and not blocked, but the post check below is what
  // actually decides — see canComment().
  if (!viewer || memberStatus === 'blocked') return new Response(null, { status: 404 });

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });

  const form = await request.formData();
  const slug = String(form.get('slug') ?? '').trim();
  const body = String(form.get('body') ?? '');

  if (!slug) return new Response(null, { status: 400 });

  // Re-check the post rather than trusting the form. Signing in is not the
  // same as being allowed to read this particular post, and a comment on
  // something you cannot see should not exist.
  const post = await postStore.get(slug);
  if (!post || !canComment(post.data, audience, viewer, memberStatus)) {
    return new Response(null, { status: 404 });
  }

  const problem = validateComment(body);
  if (problem) {
    return back(slug, {
      commentError: COMMENT_MESSAGES[problem],
      draft: body.slice(0, MAX_COMMENT_LENGTH),
    });
  }

  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000);
  if ((await commentStore.recentCount(viewer.sub, since)) >= RATE_LIMIT) {
    return back(slug, {
      commentError: `That's ${RATE_LIMIT} comments in ${RATE_WINDOW_MINUTES} minutes. Give it a moment.`,
      draft: body.slice(0, MAX_COMMENT_LENGTH),
    });
  }

  const trimmed = body.trim().slice(0, MAX_COMMENT_LENGTH);

  await commentStore.add({
    postSlug: slug,
    memberId: viewer.sub,
    body: trimmed,
    // Rendered once, here, by the escape-first renderer. Never by the one that
    // handles post bodies, which allows raw HTML.
    html: renderComment(trimmed),
  });

  return back(slug);
};
