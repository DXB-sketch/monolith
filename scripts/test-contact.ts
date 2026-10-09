#!/usr/bin/env -S npx tsx
/**
 * Contact endpoint tests against the production build: the real built Worker
 * (`dist/server`), run locally in Cloudflare's runtime (workerd, via
 * wrangler), with Resend replaced by a local mock, so no email is ever sent.
 *
 * Covers: valid sends (JSON and plain form), validation errors (and the no-JS
 * error round trip), the honeypot, fast and forged submissions, the rate
 * limit, oversized bodies, a provider failure, other methods, HTML escaping,
 * and that no message content or API key reaches the logs.
 *
 * Usage: npm run build && npm run test:contact
 */
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { unstable_startWorker } from 'wrangler';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = resolve(root, 'dist/server/wrangler.json');
if (!existsSync(config)) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

// ── Mock Resend ───────────────────────────────────────────────────────────

interface Sent {
  auth: string | undefined;
  body: Record<string, unknown>;
}
const sent: Sent[] = [];
let failNext = false;

const readAll = async (req: IncomingMessage) => {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data;
};

const mock = createServer(async (req, res) => {
  const body = JSON.parse(await readAll(req)) as Record<string, unknown>;
  if (req.method !== 'POST' || req.url !== '/emails') {
    res.writeHead(404).end();
    return;
  }
  if (failNext) {
    failNext = false;
    res.writeHead(500, { 'content-type': 'application/json' }).end('{"name":"internal"}');
    return;
  }
  sent.push({ auth: req.headers.authorization, body });
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"mock"}');
});
await new Promise<void>((done) => mock.listen(0, '127.0.0.1', done));

const API_KEY = 're_test_not_a_real_key_0123456789';
const FROM = 'Monolith <enquiries@example.com>';
const vars = {
  RESEND_API_KEY: API_KEY,
  CONTACT_TO_EMAIL: 'studio@example.com',
  CONTACT_FROM_EMAIL: FROM,
  RESEND_API_BASE: `http://127.0.0.1:${(mock.address() as AddressInfo).port}`,
};
// The token helpers below run here, in Node, and must sign with the Worker's key.
process.env.RESEND_API_KEY = API_KEY;

// Capture everything printed while the Worker runs (its console output included).
const logs: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    logs.push(String(chunk));
    return write(chunk, ...rest);
  }) as typeof stream.write;
}

const worker = await unstable_startWorker({
  config,
  bindings: Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, { type: 'secret_text', value }]),
  ),
  dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, watch: false },
});
await worker.ready;
// Real HTTP requests to the local server; redirects are what's being tested.
const ORIGIN = (await worker.url).origin;
const handler = { fetch: (request: Request) => fetch(request, { redirect: 'manual' }) };
const { issueToken } = await import('../src/lib/contact-server.ts');

// ── Helpers ───────────────────────────────────────────────────────────────

let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;
const agedToken = () => issueToken(Date.now() - 5000);

const MESSAGE = 'We need a new site for the club <script>alert(1)</script> & more.';
const valid = () => ({
  need: 'new-website',
  budget: 'not-sure',
  timeline: 'flexible',
  name: 'Test Person',
  email: 'enquirer@example.org',
  business: 'Test Club',
  phone: '07 0000 0000',
  message: MESSAGE,
  website: '',
  started: agedToken(),
});

type Fields = Record<string, string>;

function post(fields: Fields | string, opts: { json?: boolean; ip?: string; type?: string } = {}) {
  const json = opts.json ?? false;
  const body =
    typeof fields === 'string'
      ? fields
      : json
        ? JSON.stringify(fields)
        : new URLSearchParams(fields).toString();
  return handler.fetch(
    new Request(`${ORIGIN}/api/contact`, {
      method: 'POST',
      headers: {
        'content-type':
          opts.type ?? (json ? 'application/json' : 'application/x-www-form-urlencoded'),
        accept: json ? 'application/json' : 'text/html',
        'cf-connecting-ip': opts.ip ?? freshIp(),
        origin: ORIGIN,
      },
      body,
    }),
  );
}

let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.info(`ok   ${name}`);
  } catch (error) {
    failures++;
    console.info(`FAIL ${name}\n     ${(error as Error).message}`);
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function expectSilentAccept(response: Response, json: boolean, before: number) {
  if (json) {
    assert(response.status === 200, `status ${response.status}`);
    assert((await response.json()).ok === true, 'body should say ok');
  } else {
    assert(response.status === 303, `status ${response.status}`);
    assert(response.headers.get('location')?.endsWith('/contact/thanks'), 'should go to thanks');
  }
  assert(sent.length === before, 'no email should have been sent');
}

// ── Tests ─────────────────────────────────────────────────────────────────

await test('valid JSON submission sends one email', async () => {
  const before = sent.length;
  const response = await post(valid(), { json: true });
  assert(response.status === 200, `status ${response.status}`);
  assert((await response.json()).ok === true, 'body should say ok');
  assert(sent.length === before + 1, 'one email expected');
  const email = sent.at(-1)!;
  assert(email.auth === `Bearer ${API_KEY}`, 'bearer auth');
  assert(email.body.reply_to === 'enquirer@example.org', 'reply_to is the enquirer');
  assert(JSON.stringify(email.body.to) === '["studio@example.com"]', 'to is CONTACT_TO_EMAIL');
  assert(email.body.from === FROM, 'from is CONTACT_FROM_EMAIL');
  assert(String(email.body.subject).includes('Test Person'), 'subject names the enquirer');
});

await test('email HTML is escaped, text body is plain', async () => {
  const email = sent.at(-1)!;
  const html = String(email.body.html);
  assert(!html.includes('<script>'), 'raw script tag in HTML');
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more.'), 'escaped message');
  assert(String(email.body.text).includes(MESSAGE), 'text body carries the message verbatim');
});

await test('only one email per enquiry (no auto-reply)', async () => {
  const before = sent.length;
  await post(valid(), { json: true });
  assert(sent.length === before + 1, `expected exactly one, got ${sent.length - before}`);
  assert(
    sent.every((e) => JSON.stringify(e.body.to) === '["studio@example.com"]'),
    'nothing goes to the enquirer',
  );
});

await test('valid plain-form (no JS) submission redirects to /contact/thanks', async () => {
  const before = sent.length;
  const response = await post(valid());
  assert(response.status === 303, `status ${response.status}`);
  assert(response.headers.get('location')?.endsWith('/contact/thanks'), 'location');
  assert(sent.length === before + 1, 'one email expected');
});

await test('validation errors (JSON) return 422 with field errors', async () => {
  const before = sent.length;
  const response = await post(
    { ...valid(), email: 'not-an-email', message: 'short', need: 'nope' },
    { json: true },
  );
  assert(response.status === 422, `status ${response.status}`);
  const body = (await response.json()) as { errors: Record<string, string> };
  for (const field of ['email', 'message', 'need']) {
    assert(body.errors[field], `missing error for ${field}`);
  }
  assert(!body.errors.name, 'name was valid');
  assert(sent.length === before, 'nothing sent');
});

await test('validation errors (no JS) round-trip to /contact with values kept', async () => {
  const response = await post({ ...valid(), email: 'not-an-email', name: '' });
  assert(response.status === 303, `status ${response.status}`);
  assert(response.headers.get('location')?.endsWith('/contact#form-errors'), 'location');
  const cookies = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  assert(cookies.includes('contact_flash_n='), 'flash cookies set');
  const page = await handler.fetch(
    new Request(`${ORIGIN}/contact`, { headers: { cookie: cookies, accept: 'text/html' } }),
  );
  assert(page.status === 200, `contact status ${page.status}`);
  assert(page.headers.get('cache-control')?.includes('no-store'), 'no-store');
  const html = await page.text();
  assert(/id="form-errors"[^>]*>/.test(html) && html.includes('Enter your name.'), 'summary');
  assert(html.includes('Enter an email address like name@example.com.'), 'email error');
  assert(html.includes('aria-invalid="true"'), 'aria-invalid set');
  assert(html.includes('value="Test Club"'), 'business kept');
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'message kept, escaped');
  assert(!html.includes('<script>alert(1)'), 'message not injected');
  const cleared = page.headers
    .getSetCookie()
    .filter((c) => /^contact_flash_n=deleted;.*Expires=Thu, 01 Jan 1970/i.test(c));
  assert(cleared.length > 0, 'flash cleared after reading');
});

await test('honeypot filled: silent success, nothing sent', async () => {
  const before = sent.length;
  await expectSilentAccept(
    await post({ ...valid(), website: 'http://spam.example' }, { json: true }),
    true,
    before,
  );
  await expectSilentAccept(await post({ ...valid(), website: 'x' }), false, before);
});

await test('fast submission (under 3 s): silent success, nothing sent', async () => {
  const before = sent.length;
  await expectSilentAccept(
    await post({ ...valid(), started: issueToken() }, { json: true }),
    true,
    before,
  );
});

await test('missing, forged or expired timestamp: silent success, nothing sent', async () => {
  const before = sent.length;
  const old = Date.now() - 5000;
  for (const started of [
    '',
    `${old}.forged-signature`,
    issueToken(Date.now() - 25 * 60 * 60 * 1000),
  ]) {
    await expectSilentAccept(await post({ ...valid(), started }, { json: true }), true, before);
  }
});

await test('rate limit: the 6th submission from one IP in 10 minutes is dropped', async () => {
  const ip = freshIp();
  const before = sent.length;
  for (let i = 0; i < 5; i++) {
    const response = await post(valid(), { json: true, ip });
    assert(response.status === 200, `submission ${i + 1}: status ${response.status}`);
  }
  assert(sent.length === before + 5, 'first five sent');
  await expectSilentAccept(await post(valid(), { json: true, ip }), true, before + 5);
  const other = await post(valid(), { json: true });
  assert(other.status === 200 && sent.length === before + 6, 'other IPs unaffected');
});

await test('a request without forwarding headers still works', async () => {
  const before = sent.length;
  const response = await handler.fetch(
    new Request(`${ORIGIN}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', origin: ORIGIN },
      body: JSON.stringify(valid()),
    }),
  );
  assert(response.status === 200, `status ${response.status}`);
  assert(sent.length === before + 1, 'one email expected');
});

await test('oversized payload is rejected without sending', async () => {
  const before = sent.length;
  const response = await post({ ...valid(), message: 'x'.repeat(30 * 1024) }, { json: true });
  assert(response.status === 400, `status ${response.status}`);
  assert(sent.length === before, 'nothing sent');
  const plain = await post({ ...valid(), message: 'x'.repeat(30 * 1024) });
  assert(plain.status === 303, `plain status ${plain.status}`);
});

await test('malformed JSON is rejected', async () => {
  const response = await post('{not json', { json: true });
  assert(response.status === 400, `status ${response.status}`);
});

await test('provider failure: 502 (JSON) or back to the form with values (no JS)', async () => {
  failNext = true;
  const response = await post(valid(), { json: true });
  assert(response.status === 502, `status ${response.status}`);
  failNext = true;
  const plain = await post(valid());
  assert(plain.status === 303, `plain status ${plain.status}`);
  assert(plain.headers.get('location')?.endsWith('/contact#form-errors'), 'location');
});

await test("other methods are refused (405, or 403 from Astro's origin check)", async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const response = await handler.fetch(new Request(`${ORIGIN}/api/contact`, { method }));
    assert([403, 405].includes(response.status), `${method}: ${response.status}`);
  }
  const get = await handler.fetch(new Request(`${ORIGIN}/api/contact`));
  assert(get.status === 405, `GET: ${get.status}`);
});

await test('cross-site form posts are refused by the origin check', async () => {
  const before = sent.length;
  const response = await handler.fetch(
    new Request(`${ORIGIN}/api/contact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example',
      },
      body: new URLSearchParams(valid()).toString(),
    }),
  );
  assert(response.status === 403, `status ${response.status}`);
  assert(sent.length === before, 'nothing sent');
});

await test('logs never contain message content, enquirer details or the API key', async () => {
  const joined = logs.join('\n');
  for (const secret of [API_KEY, 'alert(1)', 'enquirer@example.org', 'Test Person']) {
    assert(!joined.includes(secret), `logs contain ${secret}`);
  }
});

await worker.dispose();
mock.close();
console.info(failures ? `\n${failures} failed` : '\nall contact endpoint tests passed');
process.exit(failures ? 1 : 0);
