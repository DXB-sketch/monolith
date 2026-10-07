/**
 * Server side of the contact form: spam checks, the email and Resend.
 * Free of Astro virtual modules, so it can be tested directly (scripts/test-contact.ts).
 *
 * Environment (see .env.example):
 *   RESEND_API_KEY      Resend API key
 *   CONTACT_TO_EMAIL    where enquiries go
 *   CONTACT_FROM_EMAIL  the sender; needs a domain verified in Resend
 *   RESEND_API_BASE     tests only: point at a mock instead of https://api.resend.com
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BUDGETS, labelFor, NEEDS, TIMELINES, type Enquiry } from './contact-schema';

export const MIN_FILL_MS = 3000;
export const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;
/** Anything bigger is not a real enquiry (message max is 4,000 characters). */
export const MAX_BODY_BYTES = 24 * 1024;
export const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };

export function env(name: string): string | undefined {
  const fromProcess = typeof process !== 'undefined' ? process.env[name] : undefined;
  return fromProcess || (import.meta.env?.[name] as string | undefined) || undefined;
}

// ── Signed start time ─────────────────────────────────────────────────────

/** Per-process fallback, only when no API key is configured (local development). */
const fallbackKey = randomBytes(32);

function signingKey(): Buffer {
  const apiKey = env('RESEND_API_KEY');
  // Derived from the API key, so no extra secret is needed; never the key itself.
  return apiKey
    ? createHmac('sha256', 'monolith-contact-form').update(apiKey).digest()
    : fallbackKey;
}

const sign = (value: string) =>
  createHmac('sha256', signingKey()).update(value).digest('base64url');

/** A token recording when the form was served: "<ms>.<signature>". */
export function issueToken(now = Date.now()): string {
  return `${now}.${sign(String(now))}`;
}

/** True if the token is genuine and the form took a plausible time to fill in. */
export function tokenIsValid(token: unknown, now = Date.now()): boolean {
  if (typeof token !== 'string') return false;
  const [time, signature] = token.split('.');
  if (!time || !signature || !/^\d+$/.test(time)) return false;
  const expected = Buffer.from(sign(time));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const age = now - Number(time);
  return age >= MIN_FILL_MS && age <= MAX_TOKEN_AGE_MS;
}

// ── Rate limit (best effort: per serverless instance, in memory) ─────────

const hits = new Map<string, number[]>();

export function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    // Never grow without bound: drop the oldest entries.
    for (const key of [...hits.keys()].slice(0, 1000)) hits.delete(key);
  }
  return recent.length > RATE_LIMIT.max;
}

export function resetRateLimit() {
  hits.clear();
}

// ── The email ─────────────────────────────────────────────────────────────

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Header-safe single line (no CR/LF), for the subject. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').slice(0, 120);

export function renderEmail(enquiry: Enquiry) {
  const rows: [string, string][] = [
    ['Need', labelFor(NEEDS, enquiry.need)],
    ['Budget', labelFor(BUDGETS, enquiry.budget)],
    ['Timeline', labelFor(TIMELINES, enquiry.timeline)],
    ['Name', enquiry.name],
    ['Email', enquiry.email],
    ['Business', enquiry.business || '(not given)'],
    ['Phone', enquiry.phone || '(not given)'],
  ];
  const subject = `New enquiry: ${oneLine(enquiry.name)}${enquiry.business ? ` (${oneLine(enquiry.business)})` : ''}`;

  const text = [
    'New project enquiry from the website',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Message:',
    enquiry.message,
    '',
    'Reply to this email to answer the enquirer directly.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en-AU"><body style="font-family: system-ui, sans-serif; line-height: 1.5;">
<h1 style="font-size: 18px;">New project enquiry from the website</h1>
<table cellpadding="6" style="border-collapse: collapse;">
${rows
  .map(
    ([label, value]) =>
      `<tr><th align="left" style="padding-right: 16px;">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
  )
  .join('\n')}
</table>
<h2 style="font-size: 16px;">Message</h2>
<p style="white-space: pre-wrap;">${escapeHtml(enquiry.message)}</p>
<p style="color: gray;">Reply to this email to answer the enquirer directly.</p>
</body></html>`;

  return { subject, text, html };
}

// ── Sending ───────────────────────────────────────────────────────────────

export type SendResult = { ok: true } | { ok: false; reason: 'config' | 'provider' };

/**
 * Send through Resend's REST API. The enquirer gets no automatic reply (that
 * could be abused to send email to any address); reply_to is their address.
 */
export async function sendEnquiry(enquiry: Enquiry): Promise<SendResult> {
  const apiKey = env('RESEND_API_KEY');
  const to = env('CONTACT_TO_EMAIL');
  const from = env('CONTACT_FROM_EMAIL');
  if (!apiKey || !to || !from) return { ok: false, reason: 'config' };

  const { subject, text, html } = renderEmail(enquiry);
  const base = env('RESEND_API_BASE') ?? 'https://api.resend.com';
  try {
    const response = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], reply_to: enquiry.email, subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
    // Never log the message or the key: status only.
    if (!response.ok) {
      console.error(`[contact] Resend responded ${response.status}`);
      return { ok: false, reason: 'provider' };
    }
    return { ok: true };
  } catch (error) {
    console.error(`[contact] Resend request failed: ${(error as Error).name}`);
    return { ok: false, reason: 'provider' };
  }
}
