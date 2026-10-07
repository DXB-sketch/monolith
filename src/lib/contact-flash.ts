/**
 * No-JS error round trip: when the plain form fails validation, the endpoint
 * stores the errors and the visitor's answers in short-lived cookies and
 * redirects back to /contact, which shows them and clears the cookies. The
 * message can be up to 4,000 characters, so the data is split across cookies.
 */
import type { AstroCookies } from 'astro';
import type { FieldErrors } from './contact-schema';

export interface Flash {
  errors: FieldErrors;
  values: Record<string, string>;
  /** The form was valid but sending failed. */
  sendFailed?: boolean;
}

const NAME = 'contact_flash';
const CHUNK = 3000;
const MAX_CHUNKS = 6;
const options = (secure: boolean) =>
  ({ path: '/contact', httpOnly: true, sameSite: 'lax', secure, maxAge: 120 }) as const;

export function writeFlash(cookies: AstroCookies, flash: Flash, secure: boolean) {
  const encoded = Buffer.from(JSON.stringify(flash), 'utf8').toString('base64url');
  const chunks = Math.min(MAX_CHUNKS, Math.ceil(encoded.length / CHUNK));
  for (let i = 0; i < chunks; i++) {
    cookies.set(`${NAME}_${i}`, encoded.slice(i * CHUNK, (i + 1) * CHUNK), options(secure));
  }
  cookies.set(`${NAME}_n`, String(chunks), options(secure));
}

export function readFlash(cookies: AstroCookies): Flash | null {
  const count = Number(cookies.get(`${NAME}_n`)?.value ?? 0);
  if (!count || count > MAX_CHUNKS) return null;
  let encoded = '';
  for (let i = 0; i < count; i++) encoded += cookies.get(`${NAME}_${i}`)?.value ?? '';
  for (let i = 0; i < count; i++) cookies.delete(`${NAME}_${i}`, { path: '/contact' });
  cookies.delete(`${NAME}_n`, { path: '/contact' });
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Flash;
  } catch {
    return null;
  }
}
