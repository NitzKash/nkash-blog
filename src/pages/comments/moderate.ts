import type { APIRoute } from 'astro';
import { comments as commentStore } from '../../lib/data';

export const prerender = false;

/**
 * Hide or unhide a comment. Owner only.
 *
 * Hiding is a flag rather than a delete, so it can be undone and so the thread
 * keeps its shape. A hidden comment stays visible to the owner, greyed out,
 * which is what makes undoing it possible from the page.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  if (locals.audience !== 'owner') return new Response(null, { status: 404 });

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });

  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const slug = String(form.get('slug') ?? '');
  const action = String(form.get('action') ?? '');

  if (!id || !slug || !['hide', 'show'].includes(action)) {
    return new Response(null, { status: 400 });
  }

  await commentStore.setHidden(id, action === 'hide');

  return new Response(null, {
    status: 303,
    headers: {
      Location: `/posts/${encodeURIComponent(slug)}#comments`,
      'Cache-Control': 'private, no-store',
    },
  });
};
