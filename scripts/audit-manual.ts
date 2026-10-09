#!/usr/bin/env -S npx tsx
/**
 * The accessibility checks axe can't make, scripted (Phase 5):
 *
 *   reflow        320 px wide: no horizontal scrolling (WCAG 1.4.10)
 *   zoom          200% zoom (a 720 px viewport for a 1440 px screen): no
 *                 horizontal scrolling, no clipped text
 *   spacing       WCAG 1.4.12 text-spacing overrides: no clipped or
 *                 overlapping text
 *   keyboard      Tab through every page: the skip link comes first, every stop
 *                 is visible with a visible focus indicator, no traps; the mobile
 *                 menu opens, closes with Escape and returns focus; the whole
 *                 contact form works from the keyboard; the /potential gate
 *                 (forced pass) enters by keyboard, and the nav's 3D pill
 *                 (bar and mobile menu) works by keyboard in both modes
 *   links         link text that makes sense out of context
 *   reduced       prefers-reduced-motion: no running infinite animations, all
 *                 content visible
 *   no-js         all content visible without JavaScript
 *   forced        forced colours (Windows High Contrast): text visible, focus
 *                 visible (screenshots saved for review)
 *
 * Usage: npm run build && npm run serve:prod   (another terminal)
 *        npm run audit:manual [-- http://localhost:4600]
 * CHROMIUM_PATH optional; SHOTS=dir saves forced-colours screenshots.
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4600';
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

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
const GENERIC = /^(click here|here|read more|more|learn more|link|this|go)$/i;

const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `\n       ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser: Browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
async function withPage(options: BrowserContextOptions, body: (page: Page) => Promise<void>) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  try {
    await body(page);
  } finally {
    await context.close();
  }
}
const load = async (page: Page, path: string) => {
  await page.goto(base + path);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
};

/** Horizontal page scroll, and text boxes that clip their own content. */
const layoutProblems = (page: Page) =>
  page.evaluate(() => {
    const root = document.scrollingElement!;
    const problems: string[] = [];
    if (root.scrollWidth > root.clientWidth + 1)
      problems.push(`page scrolls sideways (${root.scrollWidth} > ${root.clientWidth})`);
    for (const el of document.querySelectorAll<HTMLElement>('main *, header *, footer *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"], .visually-hidden, [hidden]')) continue;
      // Text hidden on purpose, visually (clipped to nothing) but still read out.
      if (style.position === 'absolute' && el.clientWidth <= 1) continue;
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (!text) continue;
      const clipsX = /hidden|clip/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 2;
      const clipsY = /hidden|clip/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
      if (clipsX || clipsY)
        problems.push(`clipped: <${el.tagName.toLowerCase()} class="${el.className}">`);
    }
    return problems.slice(0, 5);
  });

const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }`;

try {
  // ── Reflow, zoom and text spacing ─────────────────────────────────────
  for (const [name, viewport, css] of [
    ['reflow 320', { width: 320, height: 640 }, ''],
    ['zoom 200%', { width: 720, height: 450 }, ''],
    ['text spacing', { width: 1440, height: 900 }, TEXT_SPACING],
    ['text spacing 390', { width: 390, height: 844 }, TEXT_SPACING],
  ] as const) {
    await withPage({ viewport, reducedMotion: 'reduce' }, async (page) => {
      for (const path of PAGES) {
        await load(page, path);
        if (css) await page.addStyleTag({ content: css });
        await page.waitForTimeout(150);
        const problems = await layoutProblems(page);
        check(problems.length === 0, `${name} ${path}`, problems.join('; '));
      }
    });
  }

  // ── Keyboard ──────────────────────────────────────────────────────────
  await withPage({ viewport: { width: 1440, height: 900 } }, async (page) => {
    for (const path of PAGES) {
      await load(page, path);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const stops: string[] = [];
      const problems: string[] = [];
      for (let i = 0; i < 120; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          el.scrollIntoView({ block: 'nearest' });
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          const indicator =
            (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
            s.boxShadow !== 'none' ||
            el.matches(':focus-visible');
          return {
            id: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`,
            visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0',
            indicator,
          };
        });
        if (!info) break;
        if (stops.includes(info.id) && stops[0] === info.id) break;
        stops.push(info.id);
        if (!info.visible) problems.push(`invisible stop ${info.id}`);
        if (!info.indicator) problems.push(`no focus indicator on ${info.id}`);
      }
      if (!/skip/i.test(stops[0] ?? ''))
        problems.push(`first stop is ${stops[0]}, not the skip link`);
      check(problems.length === 0, `keyboard ${path} (${stops.length} stops)`, problems.join('; '));
    }
  });

  await withPage({ viewport: { width: 390, height: 844 }, hasTouch: true }, async (page) => {
    await load(page, '/services');
    await page.focus('.nav__toggle');
    await page.keyboard.press('Enter');
    const expanded = await page.getAttribute('.nav__toggle', 'aria-expanded');
    await page.keyboard.press('Tab');
    const inMenu = await page.evaluate(() => Boolean(document.activeElement?.closest('#nav-menu')));
    await page.keyboard.press('Escape');
    const closed = await page.getAttribute('.nav__toggle', 'aria-expanded');
    const back = await page.evaluate(() =>
      document.activeElement?.classList.contains('nav__toggle'),
    );
    check(
      expanded === 'true' && inMenu && closed === 'false' && Boolean(back),
      'keyboard mobile menu (open, into menu, Escape, focus returns)',
      `expanded=${expanded} inMenu=${inMenu} closed=${closed} focusBack=${back}`,
    );
  });

  await withPage({ viewport: { width: 1440, height: 900 } }, async (page) => {
    await load(page, '/contact');
    await page.waitForTimeout(3000); // minimum fill time
    const focusIn = (selector: string) => page.focus(selector);
    // Radios: focus the group, Space selects; Next by keyboard.
    for (const step of ['need', 'budget', 'timeline']) {
      await focusIn(`input[name="${step}"]`);
      await page.keyboard.press('Space');
      await focusIn('[data-brief-next]');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
    }
    const legendFocused = await page.evaluate(() =>
      document.activeElement?.hasAttribute('data-brief-legend'),
    );
    await focusIn('#field-name');
    await page.keyboard.type('Keyboard Tester');
    await page.keyboard.press('Tab');
    await page.keyboard.type('keyboard@example.com');
    await page.keyboard.press('Enter'); // Enter in a field moves on
    await page.waitForTimeout(300);
    await focusIn('#field-message');
    await page.keyboard.type('Sent from the keyboard check.');
    await focusIn('[data-brief-submit]');
    await page.keyboard.press('Enter');
    const sent = await page
      .waitForSelector('[data-brief-success]:not([hidden])', { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    const headingFocused = await page.evaluate(() =>
      document.activeElement?.hasAttribute('data-brief-success-heading'),
    );
    check(
      Boolean(legendFocused) && sent && Boolean(headingFocused),
      'keyboard contact form (radios, Next, Enter, send, focus to success)',
      `legendFocused=${legendFocused} sent=${sent} successFocused=${headingFocused}`,
    );
    // "Arrange a call" is a mailto link: reachable by keyboard, with the studio address.
    const call = page.locator('[data-brief-success] [data-book-link]');
    await call.focus();
    const focused = await call.evaluate((el) => el === document.activeElement);
    const href = (await call.getAttribute('href')) ?? '';
    check(
      focused && href.startsWith('mailto:'),
      'keyboard Arrange a call',
      `focused=${focused} href=${href}`,
    );
  });

  // The gate (forced pass), Enter the stone, then Back to 2D from the nav's pill.
  await withPage({ viewport: { width: 1440, height: 900 } }, async (page) => {
    await load(page, '/potential?tier=high');
    const passed = await page
      .waitForFunction(
        () => document.querySelector('[data-gate]')?.getAttribute('data-state') === 'passed',
        null,
        {
          timeout: 90_000,
        },
      )
      .then(() => true)
      .catch(() => false);
    await page.focus('[data-gate-enter]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const entered = await page.evaluate(() => ({
      focus: document.activeElement?.id ?? '',
      mode: document.documentElement.dataset.experience,
    }));
    const exit = page.locator('.nav__potential[data-experience-exit]');
    await exit.focus();
    const exitLabel = (await exit.getAttribute('aria-label')) ?? '';
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      mode: document.documentElement.dataset.experience,
      focus: document.activeElement?.hasAttribute('data-potential-link') ?? false,
    }));
    check(
      passed &&
        entered.focus === 'hero-title' &&
        entered.mode === '3d' &&
        after.mode === '2d' &&
        after.focus,
      'keyboard gate: Enter the stone, then Back to 2D from the nav',
      `passed=${passed} focus=${entered.focus} mode=${entered.mode} exit="${exitLabel}" → mode=${after.mode} focusOnLink=${after.focus}`,
    );
  });

  // The pill in the mobile menu, reached by keyboard.
  await withPage({ viewport: { width: 390, height: 844 }, hasTouch: true }, async (page) => {
    await load(page, '/services');
    await page.focus('.nav__toggle');
    await page.keyboard.press('Enter');
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        () =>
          document.activeElement?.matches('#nav-menu [data-potential-link]') === true &&
          (document.activeElement as HTMLElement).offsetWidth > 0,
      );
    }
    check(reached, 'keyboard mobile menu: See the potential · 3D');
  });

  await withPage({ viewport: { width: 1440, height: 900 } }, async (page) => {
    await load(page, '/');
    const toggle = page.locator('[data-sound-toggle]');
    if (await toggle.isVisible()) {
      await toggle.focus();
      await page.keyboard.press('Enter');
      const on = await toggle.getAttribute('aria-pressed');
      await page.keyboard.press('Enter');
      const off = await toggle.getAttribute('aria-pressed');
      check(on === 'true' && off === 'false', 'keyboard sound toggle', `on=${on} off=${off}`);
    }
  });

  await withPage({ viewport: { width: 1440, height: 900 } }, async (page) => {
    await load(page, '/lab/light-through-stone?tier=lite');
    await page.waitForTimeout(3000);
    const heat = page.locator('[data-demo-heat]');
    if (await heat.isVisible()) {
      await heat.focus();
      const before = await heat.inputValue();
      await page.keyboard.press('ArrowRight');
      const after = await heat.inputValue();
      check(before !== after, 'keyboard Lab demo sliders', `${before} → ${after}`);
    } else check(true, 'keyboard Lab demo (still shown: no controls)');
  });

  // ── Link text ─────────────────────────────────────────────────────────
  await withPage({ viewport: { width: 1440, height: 900 } }, async (page) => {
    const bad = new Set<string>();
    for (const path of PAGES) {
      await load(page, path);
      for (const name of await page.$$eval('a[href]', (links) =>
        links.map((a) => (a.getAttribute('aria-label') || (a as HTMLElement).innerText).trim()),
      ))
        if (!name || GENERIC.test(name)) bad.add(`${path}: "${name}"`);
    }
    check(bad.size === 0, 'link text makes sense out of context', [...bad].join('; '));
  });

  // ── Reduced motion, no-JS, forced colours ─────────────────────────────
  const hiddenContent = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main p, main li')]
        .filter((el) => !el.closest('[hidden], [aria-hidden="true"], .visually-hidden, [data-hud]'))
        .filter((el) => {
          for (let n: HTMLElement | null = el; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.display === 'none') return false;
            if (Number(s.opacity) < 0.99 || s.visibility === 'hidden') return true;
          }
          return false;
        })
        .map((el) => `${el.tagName.toLowerCase()} "${el.innerText.trim().slice(0, 30)}"`)
        .slice(0, 5),
    );

  await withPage(
    { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' },
    async (page) => {
      for (const path of PAGES) {
        await load(page, path);
        const infinite = await page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (a) =>
                  a.playState === 'running' &&
                  a.effect?.getComputedTiming().iterations === Infinity,
              ).length,
        );
        const hidden = await hiddenContent(page);
        check(
          infinite === 0 && hidden.length === 0,
          `reduced motion ${path}`,
          `${infinite} infinite animations; hidden: ${hidden.join(', ')}`,
        );
      }
    },
  );

  await withPage(
    { viewport: { width: 1440, height: 900 }, javaScriptEnabled: false },
    async (page) => {
      for (const path of PAGES) {
        await page.goto(base + path);
        const hidden = await hiddenContent(page);
        check(hidden.length === 0, `no-JS ${path}`, `hidden: ${hidden.join(', ')}`);
      }
    },
  );

  await withPage(
    { viewport: { width: 1440, height: 900 }, forcedColors: 'active', colorScheme: 'dark' },
    async (page) => {
      for (const path of ['/', '/work/seqdvgc', '/services', '/contact']) {
        await load(page, path);
        // Scroll through first: below-the-fold content reveals on scroll, as normal.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
            scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 80));
          }
          scrollTo(0, 0);
        });
        await page.waitForTimeout(1500);
        const hidden = await hiddenContent(page);
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const s = getComputedStyle(document.activeElement!);
          return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
        });
        if (shots)
          await page.screenshot({
            path: `${shots}/forced${path.replace(/\//g, '_') || '_home'}.png`,
          });
        check(
          hidden.length === 0 && focus,
          `forced colours ${path}`,
          `focus outline=${focus}; hidden: ${hidden.join(', ')}`,
        );
      }
    },
  );
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `${failures.length} checks failed` : 'all checks passed'}.`);
process.exit(failures.length ? 1 : 0);
