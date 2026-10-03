// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Static output: every page is prerendered at build time. The Vercel adapter is
// present so individual routes can opt out with `export const prerender = false`
// (the contact endpoint in src/pages/api/contact.ts, wired up in Phase 3).
export default defineConfig({
  site: 'https://monolith.example',
  output: 'static',
  adapter: vercel(),
  trailingSlash: 'ignore',
  prefetch: false,
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      // The scene chunk is lazily imported; keep Three.js out of the entry.
      chunkSizeWarningLimit: 900,
    },
  },
});
