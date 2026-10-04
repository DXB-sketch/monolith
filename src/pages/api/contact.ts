import type { APIRoute } from 'astro';

// Reserved serverless endpoint for the contact form (Resend), built in Phase 3.
// Opting out of prerendering makes this the site's single Vercel function.
export const prerender = false;

export const POST: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'The contact form is not live yet.' }), {
    status: 501,
    headers: { 'content-type': 'application/json' },
  });
