import type { APIRoute } from 'astro';
import { posts as postStore } from '../../lib/data';
import { canEdit, canDelete } from '../../lib/visibility';
import { renderMarkdown, readingMinutes, slugify, excerpt } from '../../lib/markdown';

export const prerender = false;

const VISIBILITIES = ['public', 'circle', 'private'];

const seeOther = (location: string): Response =>
  new Response(null, {
    // 303 so the browser follows with GET and a refresh does not resubmit.
    status: 303,
    headers: { Location: location, 'Cache-Control': 'private, no-store' },
  });

const backToEditor = (slug: string | null, message: string): Response =>
  seeOther(
    `/admin/editor?${slug ? `slug=${encodeURIComponent(slug)}&` : ''}error=${encodeURIComponent(message)}`,
  );

export const POST: APIRoute = async ({ request, locals, url }) => {
  const { audience, viewer } = locals;
  if (!viewer) return new Response(null, { status: 404 });

  // 404 rather than 403, matching the rest of /admin. Contributors reach this;
  // canEdit below decides whether they may touch this particular post.
  if (audience !== 'owner' && audience !== 'circle') return new Response(null, { status: 404 });

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });

  const form = await request.formData();
  const str = (key: string) => String(form.get(key) ?? '').trim();

  const originalSlug = str('originalSlug') || null;

  // Editing or deleting an existing post requires rights to that post, not
  // merely rights to the editor. Checked against the stored row, never against
  // anything the form claims.
  const existing = originalSlug ? await postStore.get(originalSlug) : null;
  if (originalSlug && !existing) return new Response(null, { status: 404 });

  if (str('action') === 'delete') {
    if (!existing) return backToEditor(null, 'Nothing to delete.');
    // Owners can take anything down; authors can remove their own.
    if (!canDelete(existing.data, audience, viewer)) return new Response(null, { status: 404 });
    await postStore.remove(existing.id);
    return seeOther('/admin/posts?done=Deleted');
  }

  // An owner may read a contributor's post but must not be able to rewrite it
  // under their name, so this is narrower than canView.
  if (existing && !canEdit(existing.data, audience, viewer)) {
    return new Response(null, { status: 404 });
  }

  const title = str('title');
  if (!title) return backToEditor(originalSlug, 'A title is required.');

  const body = String(form.get('body') ?? '');

  // Slug: explicit if given, otherwise derived from the title. A title that
  // slugifies to nothing — all emoji, all CJK — has to be named by hand rather
  // than silently becoming an empty or meaningless URL.
  const slug = slugify(str('slug') || title);
  if (!slug) {
    return backToEditor(originalSlug, 'Could not derive a slug from that title — set one by hand.');
  }

  // Renaming must not silently overwrite a different post that already owns
  // the target slug.
  if (slug !== originalSlug && (await postStore.get(slug))) {
    return backToEditor(originalSlug, `A post already exists at "${slug}".`);
  }

  const visibilityInput = str('visibility');
  // Anything unrecognised becomes private. The form only ever submits one of
  // the three, so reaching this fallback means the request was hand-made — in
  // which case failing closed is the only safe reading.
  const visibility = VISIBILITIES.includes(visibilityInput) ? visibilityInput : 'private';

  const pubDateInput = str('pubDate');
  const pubDate = pubDateInput ? new Date(`${pubDateInput}T00:00:00Z`) : new Date();
  if (Number.isNaN(pubDate.valueOf())) {
    return backToEditor(originalSlug, 'That date could not be read.');
  }

  const tags = str('tags')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  await postStore.upsert({
    slug,
    // Preserved on edit, set on create — an edit must never reassign a byline.
    authorId: existing?.data.authorId ?? viewer.sub,
    title,
    description: str('description') || excerpt(body),
    visibility,
    draft: form.get('draft') === '1',
    pubDate,
    updatedDate: originalSlug ? new Date() : undefined,
    tags,
    body,
    html: await renderMarkdown(body),
    readingMinutes: readingMinutes(body),
  });

  // A rename is an insert at the new slug followed by a delete of the old one,
  // in that order — the reverse would lose the post if the insert failed.
  if (originalSlug && originalSlug !== slug) {
    await postStore.remove(originalSlug);
  }

  return seeOther(`/posts/${slug}`);
};
