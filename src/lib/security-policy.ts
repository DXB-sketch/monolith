/**
 * The site's security headers, in one place. Used twice:
 *
 * - at build time, for every prerendered page and asset, written to
 *   `_headers` (src/integrations/security-headers.ts);
 * - at run time, for the pages the Worker renders on demand (/contact and
 *   /api/contact), by the middleware (src/middleware.ts). Cloudflare applies
 *   `_headers` to static assets only.
 *
 * The Content-Security-Policy allows the site's own origin and nothing else,
 * except what each feature needs:
 * - inline scripts by SHA-256 hash only (the early `js`/intro flags and the
 *   intro's opener): no 'unsafe-inline' and no 'unsafe-eval' for scripts;
 * - `blob:` workers (the WebGL probe runs in a worker built from a Blob) and
 *   `blob:`/`data:` images (the fissure atlas is decoded from a Blob);
 * - Cloudflare Web Analytics: its beacon script and the endpoint it reports to.
 * Styles keep 'unsafe-inline': style attributes in the markup and the
 * ClientRouter's transition styles need it.
 *
 * Runs in Node (build) and in workerd (Worker): no Node-only APIs here.
 */

/** Cloudflare Web Analytics (cookieless): the beacon and where it reports. */
const ANALYTICS_SCRIPT = 'https://static.cloudflareinsights.com';
const ANALYTICS_CONNECT = 'https://cloudflareinsights.com';

/** Two years; `preload` is left to the owner (LAUNCH.md explains why). */
export const HSTS = 'max-age=63072000; includeSubDomains';

const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'hid=()',
  'midi=()',
  'magnetometer=()',
  'gyroscope=()',
  'accelerometer=()',
  'display-capture=()',
  'browsing-topics=()',
].join(', ');

/** The bodies of every executable inline script in an HTML document. */
export function inlineScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = match[1]!;
    if (/\bsrc=/.test(attrs)) continue;
    const type = attrs.match(/\btype=["']?([^"'\s>]+)/)?.[1];
    if (type && !/^(module|text\/javascript|application\/javascript)$/i.test(type)) continue;
    scripts.push(match[2]!);
  }
  return scripts;
}

/** A CSP source for a script body: 'sha256-…'. Web Crypto, so it runs anywhere. */
export async function scriptHash(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `'sha256-${btoa(binary)}'`;
}

export function contentSecurityPolicy(scriptHashes: string[]) {
  return [
    "default-src 'self'",
    `script-src 'self' ${[...scriptHashes].sort().join(' ')} ${ANALYTICS_SCRIPT}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self'",
    `connect-src 'self' ${ANALYTICS_CONNECT}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Every header except the CSP, for every response. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': HSTS,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
