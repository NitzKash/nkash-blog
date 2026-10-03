import type { APIRoute } from 'astro';
import { renderMarkdown } from '../../lib/markdown';

export const prerender = false;

/**
 * Renders markdown for the editor's Preview tab.
 *
 * This deliberately costs a round trip rather than bundling a parser into the
 * browser. A client-side renderer would be instant, but it would be a
 * *different* renderer from the one `/admin/save` uses — and a preview that
 * can disagree with what gets published is worse than no preview at all,
 * because the disagreement only surfaces after you hit save.
 *
 * Owner-only, so the request volume is a handful per post and the free tier
 * never notices.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  // Contributors write too. Whether they may touch *this* post is canEdit's
  // job, not this gate's.
  if (locals.audience !== 'owner' && locals.audience !== 'circle') {
    return new Response(null, { status: 404 });
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });

  const body = await request.text();

  // The response is injected into the page with innerHTML. That is safe for
  // the same reason post bodies are: only an owner can reach this route, and
  // the output is their own markdown through the same pipeline that renders
  // their own posts. It is not the escape-first path comments use, and must
  // never be reused for anything a non-owner can write.
  return new Response(await renderMarkdown(body), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
