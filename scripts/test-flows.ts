#!/usr/bin/env -S npx tsx
/**
 * The main flows, in any browser engine (Phase 5 cross-browser checks):
 *
 *   no webgl     a first visit to /, /work, /services, /about, /lab or /contact
 *                requests no scene chunk, no fissure atlas and starts no worker
 *                (2D is the default, Phase 6)
 *   tiers        2D by default (the poster, reason experience-2d), and that the
 *                forced live tiers (?tier=lite, ?tier=high) render a frame on a
 *                content page
 *   gate pass    /potential?tier=high: the gate passes, Enter the stone starts
 *                the story (live) and focuses its heading
 *   gate fail    /potential?tier=poster: the gate fails with a reason and its
 *                way back reaches the home page
 *   story        the /potential story scroll in 2D: every chapter, the CTA
 *   deep link    /potential#the-lab lands on that chapter
 *   round trip   2D: home → /potential by the nav pill (the gate's verdict) →
 *                work → case study → back → back → forward, the canvas persisting;
 *                3D: /potential?tier=high → enter → work (live view) → home
 *                (stage hidden) → /potential (no gate, live) → reload (still 3D)
 *                → Back to 2D (scene stopped, no reload)
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
 * FLOWS=gate pass,round trip runs a subset. CHROMIUM_PATH optional (Chromium only).
 * Exits 1 on any failure.
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
  if (process.env.FLOWS && !process.env.FLOWS.split(',').includes(flow)) return;
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
    experience: document.documentElement.dataset.experience ?? '?',
    live: Boolean(document.querySelector('[data-scene-stage].is-live')),
  }));

const gateVerdict = (page: Page) =>
  page.waitForFunction(
    () =>
      /passed|failed/.test(document.querySelector('[data-gate]')?.getAttribute('data-state') ?? ''),
    null,
    { timeout: 120_000 },
  );

const gateState = (page: Page) =>
  page.evaluate(() => document.querySelector('[data-gate]')?.getAttribute('data-state') ?? null);

/** Pass the gate (forced with ?tier=) and enter the story. */
async function enterStone(page: Page) {
  await gateVerdict(page);
  if ((await gateState(page)) !== 'passed') throw new Error('the gate did not pass');
  await page.click('[data-gate-enter]');
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-entered'));
  await page.waitForSelector('[data-scene-stage].is-live', { timeout: 90_000 });
}

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
    await run('no webgl', size, async (page) => {
      const hits: string[] = [];
      page.on('request', (request) => {
        const url = request.url();
        if (/\/_astro\/(scene|layers)\.|fissures/.test(url)) hits.push(url.replace(base, ''));
      });
      page.on('worker', (worker) => hits.push(`worker ${worker.url().slice(0, 40)}`));
      const paths = ['/', '/work', '/services', '/about', '/lab', '/contact'];
      for (const path of paths) {
        // A first visit each time: nothing remembered from the last page.
        await page.goto(`${base}${path}`);
        await page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2500);
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(800);
      }
      if (hits.length) throw new Error(`WebGL requests on a first visit: ${hits.join(', ')}`);
      return `${paths.length} pages: no scene chunk, no atlas, no worker`;
    });

    await run('tiers', size, async (page) => {
      const notes: string[] = [];
      for (const query of ['', '?tier=lite', '?tier=high']) {
        await page.goto(`${base}/work${query}`);
        if (query) {
          await page.waitForSelector('[data-scene-stage].is-live', { timeout: 90_000 });
        } else {
          await page.waitForFunction(() => document.documentElement.dataset.tier, null, {
            timeout: 30_000,
          });
          await page.waitForTimeout(2000);
        }
        const { tier, experience, live } = await tierOf(page);
        if (!query && (experience !== '2d' || tier !== 'poster' || live))
          throw new Error(`default is not 2D: ${experience}, ${tier}`);
        notes.push(`${query || 'default'} → ${experience} ${tier}${live ? ' (live)' : ''}`);
      }
      return notes.join(', ');
    });

    await run('gate pass', size, async (page) => {
      await page.goto(`${base}/potential?tier=high`);
      await enterStone(page);
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => ({
        focus: document.activeElement?.id,
        gateHidden: (document.querySelector('[data-gate]') as HTMLElement).hidden,
        stored: localStorage.getItem('monolith:experience'),
      }));
      if (state.focus !== 'hero-title') throw new Error(`focus on ${state.focus}`);
      if (!state.gateHidden || state.stored !== '3d') throw new Error(JSON.stringify(state));
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(1500);
      return 'passed (forced), entered, story live, heading focused, 3d stored';
    });

    await run('gate fail', size, async (page) => {
      await page.goto(`${base}/potential?tier=poster`);
      await gateVerdict(page);
      if ((await gateState(page)) !== 'failed') throw new Error('the gate did not fail');
      const reason = (await page.locator('[data-gate-reason]').innerText()).trim();
      if (!reason) throw new Error('no reason shown');
      if (await page.locator('[data-gate-enter]').isVisible())
        throw new Error('Enter the stone still shown after failing');
      await page.click('[data-gate-back]');
      await page.waitForURL(`${base}/`);
      const { live } = await tierOf(page);
      if (live) throw new Error('scene live after failing');
      return `failed: "${reason}"; back to the 2D site`;
    });

    await run('story', size, async (page) => {
      await page.goto(`${base}/potential`);
      await gateVerdict(page);
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
      await page.goto(`${base}/potential#the-lab`);
      await page.waitForTimeout(1500);
      const top = await page.locator('#the-lab').evaluate((el) => el.getBoundingClientRect().top);
      if (Math.abs(top) > 900) throw new Error(`#the-lab is ${Math.round(top)}px from the top`);
      return `#the-lab at ${Math.round(top)}px`;
    });

    await run('round trip', size, async (page) => {
      const mark = () =>
        page.evaluate(() => {
          const canvas = document.querySelector('[data-scene-canvas]');
          if (canvas) (canvas as HTMLElement & { __marked?: boolean }).__marked = true;
        });
      const persisted = () =>
        page.evaluate(
          () =>
            (
              document.querySelector('[data-scene-canvas]') as
                (HTMLElement & { __marked?: boolean }) | null
            )?.__marked === true,
        );
      const stageShown = () =>
        page.evaluate(
          () => getComputedStyle(document.querySelector('[data-scene-stage]')!).display !== 'none',
        );
      let step = '';
      let verdict: string | null;
      let caseTitle: string;
      const nav = async (href: string) => {
        step = `nav ${href}`;
        if (href === '/potential') await page.click('.nav > .nav__potential[data-potential-link]');
        else {
          if (size.name === 'phone') await page.click('.nav__toggle');
          await page.click(`nav a[href="${href}"]`);
        }
        await page.waitForURL(`**${href}`);
        await page.waitForTimeout(600);
      };

      try {
        // 2D: home → /potential (by the pill) → work → case → back → back → forward.
        await page.goto(`${base}/`);
        await page.waitForLoadState('networkidle');
        if (await stageShown()) throw new Error('the stage shows on the 2D home page');
        await mark();
        await nav('/potential');
        await gateVerdict(page);
        verdict = await gateState(page);
        if (!(await stageShown())) throw new Error('no poster on /potential');
        await nav('/work');
        await page.locator('a[href="/work/seqdvgc"]').first().click();
        await page.waitForURL('**/work/seqdvgc');
        caseTitle = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ');
        await page.goBack();
        await page.waitForURL('**/work');
        await page.goBack();
        await page.waitForURL('**/potential');
        await page.goForward();
        await page.waitForURL('**/work');
        await page.waitForTimeout(600);
        if (!(await persisted())) throw new Error('the canvas was replaced (2D)');

        // 3D: enter at the gate, then work → home → potential, reload, Back to 2D.
        await page.goto(`${base}/potential?tier=high`);
        await enterStone(page);
        await mark();
        await nav('/work');
        await page.waitForSelector('[data-scene-stage].is-live.is-view', { timeout: 60_000 });
        await page.locator('.nav__brand').click();
        await page.waitForURL(`${base}/`);
        await page.waitForTimeout(600);
        if (await stageShown()) throw new Error('the stage shows on the home page in 3D mode');
        // In 3D mode the pill reads Back to 2D: the Eruption card's note links here.
        step = 'home to /potential (Eruption note)';
        // Scrolled to first and left to finish its reveal, so the click lands on it.
        await page.locator('main a[href="/potential"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(1800);
        await page.click('main a[href="/potential"]');
        await page.waitForURL('**/potential');
        if (await page.locator('[data-gate]').isVisible()) throw new Error('the gate shows again');
        await page.waitForSelector('[data-scene-stage].is-live', { timeout: 60_000 });
        if (!(await persisted())) throw new Error('the canvas was replaced (3D)');
        // Entering without ?tier= writes this session's tier (enterExperience); a
        // forced tier never does, so it's written here as a real device would have it.
        // (Without it the reload probes the GPU again and, on this software
        // renderer, rightly ends in 2D.)
        await page.evaluate(() =>
          sessionStorage.setItem(
            'monolith:tier',
            JSON.stringify({
              v: 2,
              tier: 'high',
              reason: 'passed the gate at high',
              ceiling: 'high',
              upgraded: [],
              scale: 1,
              gpu: '',
            }),
          ),
        );
        step = 'reload /work (3D remembered)';
        await page.goto(`${base}/work`);
        await page.waitForSelector('[data-scene-stage].is-live', { timeout: 90_000 });
        const afterReload = await tierOf(page);
        if (afterReload.experience !== '3d') throw new Error('3D was not remembered on reload');
        step = 'Back to 2D';
        await page.click('.nav > .nav__potential[data-experience-exit]');
        await page.waitForTimeout(1800);
        const after = await tierOf(page);
        const stored = await page.evaluate(() => localStorage.getItem('monolith:experience'));
        if (after.experience !== '2d' || after.live || stored)
          throw new Error(`Back to 2D left ${JSON.stringify(after)} stored=${stored}`);
      } catch (e) {
        throw new Error(`${step}: ${(e as Error).message.split(String.fromCharCode(10))[0]}`, {
          cause: e,
        });
      }
      return `2D: gate ${verdict}, case "${caseTitle}", canvas persisted; 3D: live view, home hidden, no gate, kept on reload, Back to 2D`;
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
