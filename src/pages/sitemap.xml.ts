import type { APIRoute } from 'astro';
import { posts as postStore } from '../lib/data';

export const prerender = false;

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Public posts only, and it never consults the session. A sitemap is fetched
 * by crawlers, cached by everything in between, and read by anyone who asks —
 * so it is built from the `public` tier and nothing else, with no viewer in
 * scope to accidentally widen it.
 */
export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? new URL(url.origin)).origin;

  const posts = await postStore.listPublic();

  const urls = [
    { loc: `${origin}/`, lastmod: undefined as string | undefined },
    { loc: `${origin}/posts`, lastmod: undefined },
    { loc: `${origin}/projects`, lastmod: undefined },
    ...posts.map((post) => ({
      loc: `${origin}/posts/${post.id}`,
      lastmod: (post.data.updatedDate ?? post.data.pubDate).toISOString(),
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, lastmod }) =>
      `  <url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  });
};
