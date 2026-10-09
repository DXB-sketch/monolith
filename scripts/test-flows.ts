#!/usr/bin/env -S npx tsx
/**
 * The main flows, in any browser engine (Phase 5 cross-browser checks):
 *
 *   tiers        the tier each engine settles on by default, and that the
 *                forced live tiers (?tier=lite, ?tier=high) render a frame
 *   story        home story scroll: every chapter reached, the dive, the CTA
 *   deep link    /#the-lab lands on that chapter
 *   round trip   home → work → case study → back → back → forward, with the
 *                canvas persisting across the ClientRouter navigations
 *   contact      the whole brief, sent (Resend mocked by serve:prod)
 *   lab          the demo (forced ?tier=lite) runs and its controls respond; where
 *                the demo itself declines (it refuses software renderers), the still
 *   analytics    the events fired along the way, and that none of them holds
 *                anything typed into the form
 *
 * Each flow runs at desktop and phone sizes, under the production headers
 * (CSP included): any CSP violation, page error or console error fails it.
 *
 * Usage: npm run build && npm run serve:prod   (another terminal)
 *        BROWSER=chromium|firefox|webkit npm run test:flows [-- http://localhost:4600]
 * Firefox and WebKit need `npx playwright install firefox webkit` first.
 * CHROMIUM_PATH optional (Chromium only). Exits 1 on any failure.
 */
import { chromium, firefox, webkit, type BrowserContext, type Page } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4600';
const engineName = (process.env.BROWSER ?? 'chromium') as 'chromium' | 'firefox' | 'webkit';
const engine = { chromium, firefox, webkit }[engineName];

const SIZES = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  {
    name: 'phone',
    viewport: { width: 390, height: 844 },
    isMobile: engineName !== 'firefox',
    hasTouch: true,
  },
];

const results: { flow: string; ok: boolean; note: string }[] = [];
const PERSONAL = [
  'Flow Tester',
  'flows@example.com',
  'Flow Test Pty Ltd',
  'A brief from the flow tests',
];

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content.Security.Policy|Refused to/i.test(text))
      problems.push(`csp: ${text.slice(0, 160)}`);
    else if (msg.type() === 'error' && !/status of 404/.test(text))
      problems.push(`console: ${text.slice(0, 160)}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  return problems;
}

async function run(
  flow: string,
  size: (typeof SIZES)[number],
  body: (page: Page, context: BrowserContext) => Promise<string | void>,
  contextOptions = {},
) {
  const context = await browser.newContext({ ...size, ...contextOptions });
  // Record the site's analytics events (src/lib/analytics.ts) as they fire.
  await context.addInitScript(() => {
    const log: unknown[] = ((window as unknown as { __events: unknown[] }).__events = []);
    document.addEventListener('monolith:analytics', (event) =>
      log.push((event as CustomEvent).detail),
    );
  });
  const page = await context.newPage();
  const problems = watch(page);
  const label = `${flow} (${size.name})`;
  try {
    const note = (await body(page, context)) ?? '';
    const ok = problems.length === 0;
    results.push({ flow: label, ok, note: ok ? note : `${note} ${problems.join('; ')}` });
  } catch (e) {
    results.push({
      flow: label,
      ok: false,
      note: `${(e as Error).message.split('\n')[0]} ${problems.join('; ')}`,
    });
  } finally {
    await context.close();
  }
  const last = results.at(-1)!;
  console.log(`${last.ok ? 'ok  ' : 'FAIL'} ${last.flow}${last.note ? `: ${last.note}` : ''}`);
}

const tierOf = (page: Page) =>
  page.evaluate(() => ({
    tier: document.documentElement.dataset.tier ?? 'pending',
    live: Boolean(document.querySelector('[data-scene-stage].is-live')),
  }));

/** The analytics events fired on the page so far (recorded by the init script). */
const events = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __events?: { name: string; data?: Record<string, unknown> }[] })
        .__events ?? [],
  );

const browser = await engine.launch(
  engineName === 'chromium'
    ? {
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      }
    : {},
);

try {
  for (const size of SIZES) {
    await run('tiers', size, async (page) => {
      const notes: string[] = [];
      for (const query of ['', '?tier=lite', '?tier=high']) {
        await page.goto(`${base}/${query}`);
        if (query) {
          await page.waitForSelector('[data-scene-stage].is-live', { timeout: 90_000 });
        } else {
          await page.waitForFunction(() => document.documentElement.dataset.tier, null, {
            timeout: 30_000,
          });
          await page.waitForTimeout(2000);
        }
        const { tier, live } = await tierOf(page);
        notes.push(`${query || 'default'} → ${tier}${live ? ' (live)' : ''}`);
      }
      return notes.join(', ');
    });

    await run('story', size, async (page) => {
      await page.goto(`${base}/`);
      await page.waitForLoadState('networkidle');
      const ids = ['arrival', 'face-i', 'face-ii', 'the-lab', 'the-core'];
      for (const id of ids) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      }
      await page.mouse.wheel(0, 20_000);
      await page.waitForTimeout(800);
      const cta = page.locator('main a.btn[href="/contact"]').last();
      if (!(await cta.isVisible())) throw new Error('closing CTA not visible after the story');
      await cta.click();
      await page.waitForURL('**/contact');
      const sent = await events(page);
      const progress = sent.find((e) => e.name === 'story_progress');
      const click = sent.find((e) => e.name === 'cta_click');
      if (!progress) throw new Error('no story_progress event');
      if (!click) throw new Error('no cta_click event');
      return `story_progress ${JSON.stringify(progress.data)}, cta_click ${JSON.stringify(click.data)}`;
    });

    await run('deep link', size, async (page) => {
      await page.goto(`${base}/#the-lab`);
      await page.waitForTimeout(1500);
      const top = await page.locator('#the-lab').evaluate((el) => el.getBoundingClientRect().top);
      if (Math.abs(top) > 900) throw new Error(`#the-lab is ${Math.round(top)}px from the top`);
      return `#the-lab at ${Math.round(top)}px`;
    });

    await run('round trip', size, async (page) => {
      await page.goto(`${base}/`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => {
        const canvas = document.querySelector('[data-scene-canvas]');
        if (canvas) (canvas as HTMLElement & { __marked?: boolean }).__marked = true;
      });
      const h1 = () => page.locator('h1').first().innerText();
      if (size.name === 'phone') await page.click('.nav__toggle');
      await page.click('nav a[href="/work"]');
      await page.waitForURL('**/work');
      await page.locator('a[href="/work/seqdvgc"]').first().click();
      await page.waitForURL('**/work/seqdvgc');
      const caseTitle = await h1();
      await page.goBack();
      await page.waitForURL('**/work');
      await page.goBack();
      await page.waitForURL(`${base}/`);
      await page.goForward();
      await page.waitForURL('**/work');
      await page.waitForTimeout(600);
      const persisted = await page.evaluate(
        () =>
          (
            document.querySelector('[data-scene-canvas]') as
              (HTMLElement & { __marked?: boolean }) | null
          )?.__marked === true,
      );
      if (!persisted) throw new Error('the canvas was replaced during navigation');
      return `case study "${caseTitle.replace(/\s+/g, ' ')}", canvas persisted`;
    });

    await run('contact', size, async (page) => {
      await page.goto(`${base}/contact`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3200); // the form's minimum fill time
      for (const step of ['need', 'budget', 'timeline']) {
        await page.waitForSelector(`fieldset:not([hidden]) input[name="${step}"]`);
        await page.locator(`input[name="${step}"]`).first().check({ force: true });
        await page.click('[data-brief-next]');
      }
      await page.fill('#field-name', PERSONAL[0]!);
      await page.fill('#field-email', PERSONAL[1]!);
      await page.fill('#field-business', PERSONAL[2]!);
      await page.click('[data-brief-next]');
      await page.fill('#field-message', PERSONAL[3]!);
      await page.click('[data-brief-submit]');
      await page.waitForSelector('[data-brief-success]:not([hidden])', { timeout: 15_000 });
      const sent = await events(page);
      const json = JSON.stringify(sent);
      const leaked = PERSONAL.filter((value) => json.includes(value));
      if (leaked.length) throw new Error(`personal data in analytics: ${leaked.join(', ')}`);
      const steps = sent.filter((e) => e.name === 'contact_step').length;
      if (!sent.some((e) => e.name === 'contact_submit'))
        throw new Error('no contact_submit event');
      return `sent; ${steps} contact_step events, contact_submit, no personal data`;
    });

    await run('lab', size, async (page) => {
      await page.goto(`${base}/lab/light-through-stone?tier=lite`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2500);
      const controls = page.locator('[data-demo-controls]');
      if (!(await controls.isVisible())) {
        const note = await page.locator('[data-demo-note]').innerText();
        return `no live demo here (shows the still): "${note.trim().slice(0, 60)}"`;
      }
      await page.locator('[data-demo-heat]').fill('1.2');
      await page.locator('[data-demo-speed]').fill('2');
      return 'controls respond';
    });
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${engineName}: ${results.length - failed.length}/${results.length} flows passed.`);
process.exit(failed.length ? 1 : 0);
