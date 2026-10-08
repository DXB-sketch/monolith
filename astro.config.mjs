// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';
import { placeholderReport } from './src/integrations/placeholder-report';

/**
 * Writes the scene chunk's built URL into scene-boot.ts (in place of the
 * __MONOLITH_SCENE_CHUNK__ placeholder) so the boot script can prefetch it with
 * <link rel="prefetch"> while the GPU is checked, without executing it.
 * @returns {import('vite').Plugin}
 */
function sceneChunkUrl() {
  const placeholder = '__MONOLITH_SCENE_CHUNK__';
  return {
    name: 'monolith-scene-chunk-url',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
      // Match by contained module: the chunk has no facade when it is shared.
      const scene = chunks.find((chunk) =>
        chunk.moduleIds.some((id) => id.endsWith('/src/scene/index.ts')),
      );
      if (!scene) return;
      for (const chunk of chunks) {
        if (chunk.code.includes(placeholder)) {
          chunk.code = chunk.code.replaceAll(placeholder, `/${scene.fileName}`);
        }
      }
    },
  };
}

/**
 * Dev-only routes (the scene viewer used by the poster, capture and cost
 * scripts). Injected under `astro dev` only, so nothing of them reaches a
 * production build.
 * @returns {import('astro').AstroIntegration}
 */
function devRoutes() {
  return {
    name: 'monolith-dev-routes',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/dev/scene', entrypoint: './src/dev/scene.astro' });
      },
    },
  };
}

/**
 * The site's public origin: set PUBLIC_SITE_URL in Vercel (Production) once the
 * domain is connected. Canonical URLs, the sitemap, Open Graph images and
 * structured data all derive from it. The placeholder keeps preview and local
 * builds working; production builds refuse to ship with it (placeholder gate).
 */
export const SITE_PLACEHOLDER = 'https://monolith.example';
const site = process.env.PUBLIC_SITE_URL?.replace(/\/$/, '') || SITE_PLACEHOLDER;

// Static output: every page is prerendered at build time. The Vercel adapter is
// present so individual routes can opt out with `export const prerender = false`
// (the contact endpoint in src/pages/api/contact.ts, wired up in Phase 3).
export default defineConfig({
  site,
  output: 'static',
  adapter: vercel(),
  integrations: [
    devRoutes(),
    sitemap({
      // Not for search: the thank-you page (noindex), dev and API routes.
      filter: (page) => !/\/(dev|api)\//.test(page) && !/\/contact\/thanks\/?$/.test(page),
      // One canonical form per page, as in <link rel="canonical">: no trailing slash.
      serialize: (item) => ({ ...item, url: item.url.replace(/(?<!:\/)\/$/, '') || item.url }),
    }),
    placeholderReport(),
  ],
  trailingSlash: 'ignore',
  prefetch: false,
  devToolbar: { enabled: false },
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    plugins: [sceneChunkUrl()],
    build: {
      // The scene chunk is lazily imported; keep Three.js out of the entry.
      chunkSizeWarningLimit: 900,
    },
  },
});
