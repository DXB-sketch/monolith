#!/usr/bin/env -S npx tsx
/**
 * A production-like local server for audits (Lighthouse, axe, the browser flows):
 * the built Worker (`dist/server`) and its static assets, run in Cloudflare's
 * runtime (workerd, via wrangler), so `_headers` (CSP, HSTS, caching), the
 * trailing-slash rule and the middleware all apply as they do on Cloudflare.
 * Resend is mocked: nothing is ever emailed.
 *
 * Text responses are compressed (brotli, else gzip) as Cloudflare's edge does;
 * NO_COMPRESS=1 serves them raw. Cloudflare Web Analytics is injected by the
 * edge, so it isn't present locally.
 *
 * Usage: npm run build && npm run serve:prod   (PORT=4600 by default)
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { unstable_startWorker } from 'wrangler';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = resolve(root, 'dist/server/wrangler.json');
const PORT = Number(process.env.PORT || 4600);
if (!existsSync(config)) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

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

const vars = {
  RESEND_API_KEY: 're_test_mock',
  CONTACT_TO_EMAIL: 'studio@example.com',
  CONTACT_FROM_EMAIL: 'Monolith <studio@example.com>',
  RESEND_API_BASE: `http://127.0.0.1:${mockPort}`,
};
const worker = await unstable_startWorker({
  config,
  bindings: Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, { type: 'secret_text', value }]),
  ),
  dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, watch: false },
});
await worker.ready;
const upstream = (await worker.url).origin;

// ── Front server: forwards to the Worker, compresses like the edge ────────
const COMPRESS = process.env.NO_COMPRESS !== '1';
const TEXT = /^(text\/|application\/(json|xml|javascript|manifest\+json)|image\/svg)/;

createServer(async (req, res) => {
  let body: Buffer | undefined;
  if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  const headers = Object.entries(req.headers)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    // fetch() sets these itself.
    .filter(
      ([key]) => !['content-length', 'connection', 'keep-alive', 'transfer-encoding'].includes(key),
    )
    // The Worker sees its own origin, so the origin check compares like for like.
    .map(([key, value]): [string, string] =>
      key === 'origin'
        ? [key, upstream]
        : key === 'host'
          ? [key, new URL(upstream).host]
          : [key, value],
    );
  headers.push(['cf-connecting-ip', req.socket.remoteAddress ?? '127.0.0.1']);
  const response = await fetch(`${upstream}${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
    redirect: 'manual',
  }).catch((error: Error) => {
    console.error(`[serve-prod] ${req.method} ${req.url}: ${error.cause ?? error.message}`);
    return new Response('Bad gateway', { status: 502 });
  });

  const out: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (!['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding'].includes(key))
      out[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  const location = response.headers.get('location');
  if (location?.startsWith(upstream)) out.location = location.slice(upstream.length) || '/';

  let raw = Buffer.from(await response.arrayBuffer());
  const accept = String(req.headers['accept-encoding'] ?? '');
  if (COMPRESS && TEXT.test(response.headers.get('content-type') ?? '') && raw.length >= 1024) {
    if (/\bbr\b/.test(accept)) {
      raw = brotliCompressSync(raw);
      out['content-encoding'] = 'br';
    } else if (/\bgzip\b/.test(accept)) {
      raw = gzipSync(raw);
      out['content-encoding'] = 'gzip';
    }
    out.vary = 'Accept-Encoding';
  }
  res.writeHead(response.status, out).end(req.method === 'HEAD' ? undefined : raw);
}).listen(PORT, () => console.log(`Production-like server on http://localhost:${PORT}`));

const stop = async () => {
  await worker.dispose();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
