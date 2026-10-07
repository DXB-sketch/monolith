/**
 * The contact form endpoint (the site's on-demand function on Vercel).
 *
 * - JS submissions (Accept: application/json) get JSON back; the plain form
 *   gets redirects: /contact/thanks, or back to /contact with its errors.
 * - The same Zod schema as the browser validates everything here.
 * - Spam: a honeypot, a signed start time (faster than 3 s is a bot) and a
 *   per-IP rate limit. All three reject silently: the response looks like a
 *   success, and never says which check failed.
 * - Never logs message contents or the API key.
 */
import type { APIRoute } from 'astro';
import { HONEYPOT, TOKEN, validate } from '../../lib/contact-schema';
import { writeFlash } from '../../lib/contact-flash';
import { MAX_BODY_BYTES, rateLimited, sendEnquiry, tokenIsValid } from '../../lib/contact-server';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

async function readBody(request: Request): Promise<Record<string, string> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  const type = request.headers.get('content-type') ?? '';
  try {
    const entries: [string, unknown][] = type.includes('application/json')
      ? Object.entries(JSON.parse(text) as Record<string, unknown>)
      : [...new URLSearchParams(text).entries()];
    return Object.fromEntries(
      entries.filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]),
    );
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request, cookies, redirect, clientAddress, url }) => {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  const secure = url.protocol === 'https:';
  const declared = Number(request.headers.get('content-length') ?? 0);

  const body = declared > MAX_BODY_BYTES ? null : await readBody(request);
  if (!body) {
    return wantsJson
      ? json({ ok: false, error: 'invalid' }, 400)
      : redirect('/contact?error=invalid', 303);
  }

  // Silent rejections: indistinguishable from a successful send.
  const accepted = () => (wantsJson ? json({ ok: true }) : redirect('/contact/thanks', 303));
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    (() => {
      try {
        return clientAddress;
      } catch {
        return 'unknown';
      }
    })();
  if ((body[HONEYPOT] ?? '') !== '') return accepted();
  if (!tokenIsValid(body[TOKEN])) return accepted();
  if (rateLimited(ip)) return accepted();

  const result = validate(body);
  if (!result.ok) {
    if (wantsJson) return json({ ok: false, errors: result.errors }, 422);
    const { [HONEYPOT]: _honeypot, [TOKEN]: _token, ...values } = body;
    void _honeypot;
    void _token;
    writeFlash(cookies, { errors: result.errors, values }, secure);
    return redirect('/contact#form-errors', 303);
  }

  const sent = await sendEnquiry(result.data);
  if (!sent.ok) {
    if (wantsJson) return json({ ok: false, error: 'send' }, 502);
    const { [HONEYPOT]: _honeypot, [TOKEN]: _token, ...values } = body;
    void _honeypot;
    void _token;
    writeFlash(cookies, { errors: {}, values, sendFailed: true }, secure);
    return redirect('/contact#form-errors', 303);
  }
  return accepted();
};

export const ALL: APIRoute = () =>
  new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
