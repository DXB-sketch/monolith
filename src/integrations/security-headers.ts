/**
 * Security and caching headers (Phase 5), written into the Vercel adapter's
 * Build Output config (`.vercel/output/config.json`) after it is generated,
 * so they apply to every response, static and on demand, with no reliance on
 * `vercel.json` being merged. (The adapter is always the first integration,
 * so its `astro:build:done` has run by the time this one does.)
 *
 * The Content-Security-Policy allows the site's own origin and nothing else,
 * except what each feature needs:
 * - inline scripts by SHA-256 hash only (the early `js`/intro flags and the
 *   intro's opener), collected from the built pages: no 'unsafe-inline' and no
 *   'unsafe-eval' for scripts;
 * - `blob:` workers (the WebGL probe runs in a worker built from a Blob) and
 *   `blob:`/`data:` images (the fissure atlas is decoded from a Blob);
 * - Cal.com (script, frame, connect, style) for the on-demand booking embed;
 * - Vercel Web Analytics and Speed Insights are same-origin (`/_vercel/...`).
 * Styles keep 'unsafe-inline': style attributes in the markup, the
 * ClientRouter's transition styles and the Cal.com embed all need it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

const CAL_ORIGINS = ['https://app.cal.com', 'https://cal.com'];

/** Two years; `preload` is left to the owner (LAUNCH.md explains why). */
export const HSTS = 'max-age=63072000; includeSubDomains';

const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
  'hid=()',
  'midi=()',
  'magnetometer=()',
  'gyroscope=()',
  'accelerometer=()',
  'display-capture=()',
  'browsing-topics=()',
].join(', ');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

/** SHA-256 sources for every executable inline script in the built pages. */
export function inlineScriptHashes(html: string[]): string[] {
  const hashes = new Set<string>();
  for (const page of html) {
    for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const attrs = match[1]!;
      if (/\bsrc=/.test(attrs)) continue;
      const type = attrs.match(/\btype=["']?([^"'\s>]+)/)?.[1];
      if (type && !/^(module|text\/javascript|application\/javascript)$/i.test(type)) continue;
      hashes.add(`'sha256-${createHash('sha256').update(match[2]!).digest('base64')}'`);
    }
  }
  return [...hashes].sort();
}

/** An extra origin for a self-hosted or custom-domain booking page. */
function bookingOrigin(url: string | undefined) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(scriptHashes: string[], bookingUrl?: string) {
  const cal = [...new Set([...CAL_ORIGINS, bookingOrigin(bookingUrl)].filter(Boolean))].join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')} ${cal}`,
    `style-src 'self' 'unsafe-inline' ${cal}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self'",
    `connect-src 'self' ${cal}`,
    `frame-src ${cal}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const YEAR = 'public, max-age=31536000, immutable';
/** Not content-hashed (regenerated under the same name), so not immutable. */
const MONTH = 'public, max-age=2592000, stale-while-revalidate=86400';

interface Route {
  src?: string;
  headers?: Record<string, string>;
  continue?: boolean;
  handle?: string;
}

export function securityHeaders({ bookingUrl }: { bookingUrl?: string } = {}): AstroIntegration {
  let root: URL;
  return {
    name: 'monolith-security-headers',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = config.root;
      },
      'astro:build:done': ({ dir, logger }) => {
        const configPath = fileURLToPath(new URL('.vercel/output/config.json', root));
        if (!existsSync(configPath)) {
          logger.warn('No .vercel/output/config.json: headers not written.');
          return;
        }
        const pages = walk(fileURLToPath(dir)).map((file) => readFileSync(file, 'utf8'));
        const hashes = inlineScriptHashes(pages);
        const csp = contentSecurityPolicy(hashes, bookingUrl);

        const routes: Route[] = [
          {
            // Every response. HTML (static and on demand) is revalidated on each request;
            // the routes below give assets their long lifetimes.
            src: '^/(.*)$',
            headers: {
              'content-security-policy': csp,
              'strict-transport-security': HSTS,
              'x-content-type-options': 'nosniff',
              'referrer-policy': 'strict-origin-when-cross-origin',
              'permissions-policy': PERMISSIONS_POLICY,
              'x-frame-options': 'DENY',
              'cross-origin-opener-policy': 'same-origin',
              'cache-control': 'public, max-age=0, must-revalidate',
            },
            continue: true,
          },
          { src: '^/_astro/(.*)$', headers: { 'cache-control': YEAR }, continue: true },
          { src: '^/fonts/(.*)$', headers: { 'cache-control': YEAR }, continue: true },
          {
            src: '^/(posters|textures|og|media|models)/(.*)$',
            headers: { 'cache-control': MONTH },
            continue: true,
          },
          {
            src: '^/(favicon\\.ico|favicon\\.svg|apple-touch-icon\\.png|icon-[^/]+\\.png)$',
            headers: { 'cache-control': MONTH },
            continue: true,
          },
        ];

        const config = JSON.parse(readFileSync(configPath, 'utf8')) as { routes?: Route[] };
        // Ours replace any earlier run's and go first; the adapter's own /_astro rule
        // (the same immutable header) stays where it was.
        const own = new Set(routes.map((route) => route.src));
        const rest = (config.routes ?? []).filter(
          (route) => !(route.src && own.has(route.src) && route.continue),
        );
        config.routes = [...routes, ...rest];
        writeFileSync(configPath, JSON.stringify(config, null, '\t'));
        logger.info(
          `Security and caching headers written (${hashes.length} inline script hashes).`,
        );
      },
    },
  };
}
