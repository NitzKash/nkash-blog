// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';

// Note: @astrojs/sitemap is deliberately NOT used. It enumerates built routes,
// and every post route here is on-demand rendered, so it would either miss the
// public posts entirely or risk listing gated slugs. `src/pages/sitemap.xml.ts`
// builds the sitemap from the content collection instead, filtered to public.

// https://astro.build/config
export default defineConfig({
  site: 'https://blogs.nkash.dev',

  // Everything is on-demand rendered: the home page, the archive and each post
  // all vary by who is asking. Public responses are given a long `s-maxage` so
  // Cloudflare's edge serves them without invoking the Worker again — see
  // `src/lib/cache.ts`. Gated responses are `no-store`.
  output: 'server',

  adapter: cloudflare(),
  integrations: [mdx()],

  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: true,
    },
  },
});
