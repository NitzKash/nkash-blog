import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Three tiers, in increasing order of restriction:
 *
 *   public   — anyone, indexed by search engines, cached at the edge
 *   circle   — signed-in viewers on the circle list (see src/access.config.ts)
 *   private  — owners only
 *
 * The default is `private`. That is deliberate: a post with a malformed or
 * missing `visibility` field fails closed, not open.
 */
export const VISIBILITY = ['public', 'circle', 'private'] as const;
export type Visibility = (typeof VISIBILITY)[number];

// Posts live in D1 now, written through /admin/editor — see lib/data/posts.ts.
// Keeping them as files would have meant committing private content to a repo
// that is going public.

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    status: z.enum(['live', 'building', 'archived']).default('building'),
    /** Where the running demo lives, e.g. https://demo.nkash.dev */
    demo: z.string().url().optional(),
    repo: z.string().url().optional(),
    stack: z.array(z.string()).default([]),
    visibility: z.enum(VISIBILITY).default('private'),
    allow: z.array(z.string()).default([]),
    order: z.number().default(0),
  }),
});

export const collections = { projects };
