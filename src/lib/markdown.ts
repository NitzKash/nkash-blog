import { marked } from 'marked';

/**
 * Markdown → HTML, run once at save time rather than per request.
 *
 * `marked` is used instead of Astro's MDX pipeline because that pipeline only
 * exists at build time, and posts are now written through the editor at
 * runtime. It is small, has no dependencies, and runs inside a Worker.
 *
 * Raw HTML in a post is **not** stripped. Only an owner can author posts, so
 * this is the same trust model as any CMS where the author is the operator —
 * and stripping it would break embeds and figure markup. If authoring is ever
 * opened beyond owners, this is the line that has to change, and it should
 * change before that ships, not after.
 */

marked.setOptions({
  gfm: true,
  breaks: false,
});

export async function renderMarkdown(source: string): Promise<string> {
  return marked.parse(source ?? '');
}

/** ~220 words per minute, floored at one. */
export function readingMinutes(source: string): number {
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * URL slug from a title.
 *
 * Latin letters, digits and hyphens only. A title that reduces to nothing —
 * an all-emoji or all-CJK heading — returns an empty string rather than a
 * meaningless one, and the caller is expected to ask for a slug explicitly.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** First paragraph of body text, for a description the author left blank. */
export function excerpt(source: string, limit = 160): string {
  const text = source
    .replace(/^---[\s\S]*?---/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    // Links and images collapse to their text before the punctuation strip
    // below; doing it the other way round leaves the URL glued to the label.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#[\]()]/g, '')
    .trim();

  const firstParagraph = text.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (firstParagraph.length <= limit) return firstParagraph;
  return `${firstParagraph.slice(0, limit - 1).trimEnd()}…`;
}
