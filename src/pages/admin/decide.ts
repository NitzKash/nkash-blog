import type { APIRoute } from 'astro';
import * as members from '../../lib/data/members';

export const prerender = false;

const seeOther = (location: string): Response =>
  new Response(null, {
    // 303 so the browser follows with GET and a refresh does not resubmit.
    status: 303,
    headers: { Location: location, 'Cache-Control': 'private, no-store' },
  });

export const POST: APIRoute = async ({ request, locals, url }) => {
  const { audience, viewer } = locals;

  // 404 rather than 403, matching the admin page: no confirmation that the
  // route exists for anyone who is not already an owner.
  if (audience !== 'owner' || !viewer) return new Response(null, { status: 404 });

  // The session cookie is SameSite=Lax, so a cross-site POST would not carry
  // it and would already have failed the owner check above. This is the second
  // lock: a same-site-looking request from another origin is still refused.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });

  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const action = String(form.get('action') ?? '');

  if (!id) return seeOther('/admin/members?done=Missing+member+id');

  const status =
    action === 'approve' ? 'approved' : action === 'block' ? 'blocked' : null;

  if (!status) return seeOther('/admin/members?done=Unknown+action');

  // An owner cannot demote themselves through this screen — owner status comes
  // from the OWNERS environment variable, not from this table, so the row
  // would have no effect and the result would just be confusing.
  if (id === viewer.sub) return seeOther('/admin/members?done=That+is+you');

  await members.decide(id, status, viewer.sub);

  return seeOther(`/admin/members?done=${encodeURIComponent(`Marked ${status}`)}`);
};
