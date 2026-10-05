// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

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

// Static output: every page is prerendered at build time. The Vercel adapter is
// present so individual routes can opt out with `export const prerender = false`
// (the contact endpoint in src/pages/api/contact.ts, wired up in Phase 3).
export default defineConfig({
  site: 'https://monolith.example',
  output: 'static',
  adapter: vercel(),
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
