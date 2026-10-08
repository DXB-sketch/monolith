import type { APIRoute } from 'astro';
import { SITE } from '../lib/site';
import { PALETTE_HEX } from '../scene/palette';

/** The web app manifest, in the palette's colours (from scene/palette.ts, never hardcoded). */
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: SITE.name,
        short_name: SITE.shortName,
        description: SITE.description,
        lang: SITE.locale,
        start_url: '/',
        display: 'browser',
        background_color: PALETTE_HEX.basalt,
        theme_color: PALETTE_HEX.basalt,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      null,
      2,
    ),
    { headers: { 'content-type': 'application/manifest+json' } },
  );
