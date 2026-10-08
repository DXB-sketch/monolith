#!/usr/bin/env -S npx tsx
/**
 * A production-like local server for audits (Lighthouse, axe, the browser flows):
 * the static output and the real Vercel function from `.vercel/output`, with
 * the route headers from its config.json (CSP, HSTS, caching) applied the way
 * Vercel applies them. Resend is mocked (nothing is ever emailed) and Vercel's
 * analytics endpoints are stubbed: their scripts are empty, so custom events
 * stay queued in `window.vaq` where tests can read them.
 *
 * Text responses are compressed (brotli, else gzip) as Vercel's CDN does;
 * NO_COMPRESS=1 serves them raw.
 *
 * Usage: npm run build && npm run serve:prod   (PORT=4600 by default)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, '.vercel/output');
const PORT = Number(process.env.PORT || 4600);

// ── Mock Resend ───────────────────────────────────────────────────────────
let mailed = 0;
const mock = createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  mailed++;
  console.log(`[mock-resend] email ${mailed} (not sent)`);
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"mock"}');
});
await new Promise<void>((done) => mock.listen(0, '127.0.0.1', done));
const mockPort = (mock.address() as { port: number }).port;
Object.assign(process.env, {
  RESEND_API_KEY: 're_test_mock',
  CONTACT_TO_EMAIL: 'studio@example.com',
  CONTACT_FROM_EMAIL: 'Monolith <studio@example.com>',
  RESEND_API_BASE: `http://127.0.0.1:${mockPort}`,
});

const entry = join(OUT, 'functions/_render.func/.vercel/output/server/entry.mjs');
const handler = (await import(pathToFileURL(entry).href)).default as {
  fetch(request: Request): Promise<Response>;
};

// ── Route headers, as Vercel applies them ─────────────────────────────────
interface Route {
  src?: string;
  dest?: string;
  headers?: Record<string, string>;
  continue?: boolean;
}
const config = JSON.parse(await readFile(join(OUT, 'config.json'), 'utf8')) as {
  routes: Route[];
};
const headerRoutes = config.routes.filter((route) => route.src && route.headers && route.continue);
const functionRoutes = config.routes
  .filter((route) => route.src && route.dest === '_render')
  .map((route) => new RegExp(route.src!));
const routeHeaders = (path: string) => {
  const headers: Record<string, string> = {};
  for (const route of headerRoutes)
    if (new RegExp(route.src!).test(path))
      for (const [key, value] of Object.entries(route.headers!)) headers[key.toLowerCase()] = value;
  return headers;
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
};

const COMPRESS = process.env.NO_COMPRESS !== '1';
const TEXT = /^(text\/|application\/(json|xml|javascript|manifest\+json)|image\/svg)/;

/** Compress a text body for the request's Accept-Encoding, as the CDN would. */
function encode(
  body: Buffer,
  type: string,
  accept: string,
): { body: Buffer; headers: Record<string, string> } {
  if (!COMPRESS || !TEXT.test(type) || body.length < 1024) return { body, headers: {} };
  if (/\bbr\b/.test(accept))
    return {
      body: brotliCompressSync(body),
      headers: { 'content-encoding': 'br', vary: 'Accept-Encoding' },
    };
  if (/\bgzip\b/.test(accept))
    return {
      body: gzipSync(body),
      headers: { 'content-encoding': 'gzip', vary: 'Accept-Encoding' },
    };
  return { body, headers: {} };
}

async function findFile(path: string) {
  for (const candidate of [path, join(path, 'index.html'), `${path}.html`]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // next
    }
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);
  const accept = String(req.headers['accept-encoding'] ?? '');
  const send = (status: number, headers: Record<string, string | string[]>) =>
    res.writeHead(status, { ...headers, ...routeHeaders(path) });

  if (path.startsWith('/_vercel/')) {
    if (req.method === 'POST') {
      for await (const chunk of req) void chunk;
      send(200, {});
      return res.end();
    }
    send(200, { 'content-type': 'text/javascript' });
    return res.end('/* analytics stub */');
  }

  if (functionRoutes.some((pattern) => pattern.test(path))) {
    let body: Buffer | undefined;
    if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = Buffer.concat(chunks);
    }
    const response = await handler.fetch(
      new Request(url, {
        method: req.method,
        headers: Object.entries(req.headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
        body: body ? new Uint8Array(body) : undefined,
      }),
    );
    const headers: Record<string, string | string[]> = {};
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') headers[key] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    const raw = Buffer.from(await response.arrayBuffer());
    const encoded = encode(raw, String(headers['content-type'] ?? ''), accept);
    delete headers['content-length'];
    send(response.status, { ...headers, ...encoded.headers });
    return res.end(encoded.body);
  }

  const file = await findFile(join(OUT, 'static', path));
  const target = file ?? join(OUT, 'static/404.html');
  const type = TYPES[extname(target)] ?? 'application/octet-stream';
  const encoded = encode(await readFile(target), type, accept);
  send(file ? 200 : 404, { 'content-type': type, ...encoded.headers });
  res.end(encoded.body);
}).listen(PORT, () => console.log(`Production-like server on http://localhost:${PORT}`));
