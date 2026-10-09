#!/usr/bin/env -S npx tsx
/**
 * Accessibility and CSP audit (Phase 5): axe on every page type, in every
 * scene mode, at desktop and phone sizes, plus the states that only appear
 * after interaction: the contact form's errors, its details step, its success
 * (Resend mocked), the no-JS error round trip and the open mobile menu. Every run also records Content-Security-Policy violations
 * and console errors, so it doubles as the "everything works under the CSP,
 * in every tier" check.
 *
 * Modes: high and lite (forced with ?tier=, live WebGL: 3D mode), 2d (the
 * default everywhere since Phase 6), static (prefers-reduced-motion), and
 * no-JS (pages served without their scripts, since axe itself needs JavaScript).
 * /potential is audited at its gate as well as inside the story: in the live
 * modes the gate passes (forced) and "Enter the stone" is pressed; in 2D the
 * gate's own result (here: a software renderer, so it fails) is audited.
 *
 * Usage: npm run build && npm run serve:prod   (another terminal)
 *        npm run audit:a11y [-- http://localhost:4600]
 * MODES=high,lite,poster,static,no-js runs a subset. CHROMIUM_PATH optional.
 * Exits 1 on any violation.
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4600';

const PAGES = [
  '/',
  '/potential',
  '/work',
  '/work/seqdvgc',
  '/services',
  '/about',
  '/lab',
  '/lab/light-through-stone',
  '/contact',
  '/contact/thanks',
  '/privacy',
  '/no-such-page',
];

interface Mode {
  name: string;
  query: string;
  context: BrowserContextOptions;
}
const MODES: Mode[] = [
  { name: 'high', query: '?tier=high', context: {} },
  { name: 'lite', query: '?tier=lite', context: {} },
  { name: '2d', query: '', context: {} },
  { name: 'static', query: '', context: { reducedMotion: 'reduce' } },
  { name: 'no-js', query: '', context: {} },
];
const only = process.env.MODES?.split(',');
const NO_SCRIPT = /<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/g;
const SIZES = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

interface Result {
  label: string;
  violations: { id: string; impact: string | null | undefined; nodes: string[] }[];
  csp: string[];
  errors: string[];
}
const results: Result[] = [];

async function audit(page: Page, label: string, csp: string[], errors: string[]) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const result: Result = {
    label,
    violations: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    })),
    csp: [...csp],
    errors: [...errors],
  };
  results.push(result);
  const bad = result.violations.length + result.csp.length + result.errors.length;
  console.log(
    `${bad ? 'FAIL' : 'ok  '} ${label}` +
      (bad
        ? `\n       ${[
            ...result.violations.map((v) => `axe ${v.id} (${v.impact}): ${v.nodes.join(' | ')}`),
            ...result.csp.map((c) => `csp ${c}`),
            ...result.errors.map((e) => `console ${e}`),
          ].join('\n       ')}`
        : ''),
  );
}

async function open(browser: Browser, mode: Mode, size: (typeof SIZES)[number]) {
  const context = await browser.newContext({ ...mode.context, ...size });
  if (mode.name === 'no-js') {
    // axe needs JavaScript to run, so the page's own is removed instead: every
    // document is served without its scripts and no script loads, exactly
    // what a visitor without JavaScript gets.
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (request.resourceType() === 'script') return route.abort();
      if (request.resourceType() !== 'document') return route.continue();
      const response = await route.fetch({ maxRedirects: 0 });
      const body = (await response.text()).replace(NO_SCRIPT, '');
      return route.fulfill({ response, body });
    });
  }
  const page = await context.newPage();
  const csp: string[] = [];
  const errors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content.Security.Policy|Refused to/i.test(text)) csp.push(text.slice(0, 200));
    else if (msg.type() === 'error') errors.push(text.slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  return { context, page, csp, errors };
}

const live = (mode: Mode) => mode.name === 'high' || mode.name === 'lite';

/**
 * /potential's gate: wait for its verdict (and audit it), then in the live
 * modes enter the story.
 */
async function throughGate(page: Page, mode: Mode, label: string, csp: string[], errors: string[]) {
  if (mode.name === 'no-js') return;
  await page
    .waitForFunction(
      () =>
        /passed|failed/.test(
          document.querySelector('[data-gate]')?.getAttribute('data-state') ?? '',
        ),
      null,
      { timeout: 90_000 },
    )
    .catch(() => console.log('       (the gate gave no verdict in time)'));
  await audit(page, `${label} (gate)`, csp, errors);
  if (live(mode)) await page.click('[data-gate-enter]');
}

/** Let the page settle: fonts, reveals, and (live tiers) the scene's first frame. */
async function settle(page: Page, mode: Mode, path = '') {
  await page.waitForLoadState('networkidle').catch(() => {});
  // The 2D home page never runs the scene, whatever the mode.
  if (live(mode) && path !== '/') {
    await page
      .waitForSelector('[data-scene-stage].is-live', { timeout: 60_000 })
      .catch(() => console.log('       (scene did not go live in time)'));
  }
  // The intro (first visit) has opened.
  await page.waitForTimeout(1500);
  if (mode.name !== 'no-js') {
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      scrollTo(0, 0);
    });
    await revealsDone(page);
  }
}

/**
 * Every reveal has finished (full opacity all the way up): contrast is only
 * meaningful on the final state. On a software renderer the live tiers keep
 * the main thread busy, so reveals can take seconds there.
 */
async function revealsDone(page: Page) {
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('[data-reveal]')].every((el) => {
          for (let node: Element | null = el; node; node = node.parentElement)
            if (Number(getComputedStyle(node).opacity) < 0.99) return false;
          return true;
        }),
      null,
      { timeout: 20_000, polling: 250 },
    )
    .catch(() => console.log('       (reveals still running after 20 s)'));
}

async function fillBrief(page: Page) {
  await page.locator('input[name="need"]').first().check({ force: true });
  await page.click('[data-brief-next]');
  await page.locator('input[name="budget"]').first().check({ force: true });
  await page.click('[data-brief-next]');
  await page.locator('input[name="timeline"]').first().check({ force: true });
  await page.click('[data-brief-next]');
  await page.fill('#field-name', 'Test Visitor');
  await page.fill('#field-email', 'test@example.com');
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  for (const mode of MODES.filter((m) => !only || only.includes(m.name))) {
    for (const size of SIZES) {
      // Live tiers on the phone size cost minutes on a software renderer; the
      // markup is the same as the poster's, so they run at desktop size only.
      if ((mode.name === 'high' || mode.name === 'lite') && size.name === 'phone') continue;
      for (const path of PAGES) {
        const { context, page, csp, errors } = await open(browser, mode, size);
        await page.goto(base + path + mode.query, { waitUntil: 'load' });
        const label = `${mode.name} ${size.name} ${path}`;
        if (path === '/potential') await throughGate(page, mode, label, csp, errors);
        await settle(page, mode, path);
        // The 404 page logs its own 404 response: expected.
        if (path === '/no-such-page')
          errors.splice(0, errors.length, ...errors.filter((e) => !/404/.test(e)));
        await audit(page, label, csp, errors);
        await context.close();
      }

      // ── States ──────────────────────────────────────────────────────────
      const label = `${mode.name} ${size.name}`;
      if (mode.name === 'no-js') {
        // No-JS error round trip: submit the empty form, come back with errors.
        const { context, page, csp, errors } = await open(browser, mode, size);
        await page.goto(`${base}/contact`);
        // Native validation stops an empty form in the browser, so post an invalid
        // brief directly (same cookie jar) and come back the way a redirect would.
        const form = page.locator('form[data-brief]');
        const token = page.locator('form input[type="hidden"]').first();
        await context.request.post(new URL((await form.getAttribute('action'))!, base).href, {
          form: {
            [(await token.getAttribute('name'))!]: (await token.getAttribute('value'))!,
            need: 'new-website',
            email: 'not-an-email',
          },
          maxRedirects: 0,
        });
        await page.goto(`${base}/contact`);
        await audit(page, `${label} /contact (server errors)`, csp, errors);
        await context.close();
        continue;
      }

      {
        const { context, page, csp, errors } = await open(browser, mode, size);
        await page.goto(`${base}/contact${mode.query}`);
        await settle(page, mode);
        await page.click('[data-brief-next]');
        await page.waitForSelector('.brief__error:not([hidden])');
        await audit(page, `${label} /contact (step error)`, csp, errors);
        await page.reload();
        await page.waitForTimeout(3200); // the form's minimum fill time
        await fillBrief(page);
        await audit(page, `${label} /contact (details step)`, csp, errors);
        await page.click('[data-brief-next]');
        await page.fill('#field-message', 'An accessibility audit of the success state.');
        await page.click('[data-brief-submit]');
        await page.waitForSelector('[data-brief-success]:not([hidden])', { timeout: 15_000 });
        await audit(page, `${label} /contact (sent)`, csp, errors);
        await context.close();
      }
      if (size.name === 'phone') {
        const { context, page, csp, errors } = await open(browser, mode, size);
        await page.goto(`${base}/services${mode.query}`);
        await settle(page, mode);
        await page.click('.nav__toggle');
        await page.waitForTimeout(500);
        await audit(page, `${label} /services (menu open)`, csp, errors);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

const failing = results.filter((r) => r.violations.length || r.csp.length || r.errors.length);
console.log(`\n${results.length} audits, ${failing.length} with problems.`);
process.exit(failing.length ? 1 : 0);
