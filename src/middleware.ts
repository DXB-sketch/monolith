/**
 * Security headers for the pages the Worker renders on demand (/contact and
 * /api/contact). Cloudflare's `_headers` file covers static assets only. The
 * Content-Security-Policy hashes the response's own inline scripts, so it
 * always matches what was sent. Prerendered pages aren't affected: their
 * headers come from `_headers` (src/integrations/security-headers.ts).
 */
import { defineMiddleware } from 'astro:middleware';
import {
  contentSecurityPolicy,
  inlineScripts,
  scriptHash,
  SECURITY_HEADERS,
} from './lib/security-policy';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (context.isPrerendered) return response;

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);

  let body: BodyInit | null = response.body;
  if (headers.get('content-type')?.includes('text/html')) {
    const html = await response.text();
    const hashes = await Promise.all([...new Set(inlineScripts(html))].map(scriptHash));
    headers.set('Content-Security-Policy', contentSecurityPolicy(hashes));
    body = html;
  } else {
    headers.set('Content-Security-Policy', contentSecurityPolicy([]));
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
});
