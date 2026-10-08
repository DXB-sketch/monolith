import type { APIRoute } from 'astro';

/**
 * Everything may be crawled except the dev and API routes. Vercel adds
 * `X-Robots-Tag: noindex` to every preview deployment itself, so only the
 * production domain is indexed.
 */
export const GET: APIRoute = ({ site }) =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /dev/',
      'Disallow: /api/',
      '',
      `Sitemap: ${new URL('/sitemap-index.xml', site)}`,
      '',
    ].join('\n'),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
