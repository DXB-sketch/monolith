#!/usr/bin/env -S npx tsx
/**
 * Award-submission assets (Phase 5), rendered deterministically: once a page
 * has loaded, its clock (performance.now, Date.now and the requestAnimationFrame
 * timestamp: the scene, GSAP, Lenis and the story all run on it) is frozen and
 * moved on exactly 1/60 s per frame, and CSS and view-transition animations
 * are paused and stepped by hand. However long the software renderer takes to
 * draw a frame, the output is smooth and repeatable without a GPU.
 *
 *   screenshots   High tier: Home (each chapter and the dive), Work, a case
 *                 study, Services, Contact at 1600×1200 and 2560×1440; phone
 *                 (390×844, Lite, 3× pixels): the same pages
 *   recording     1920×1080, 60 fps: the home story, a page transition to a
 *                 case study and back, then the rest of the story and the dive;
 *                 encoded to MP4 (H.264) and WebM (VP9)
 *
 * Usage: npm run build && npm run serve:prod   (another terminal)
 *        npm run capture -- [screenshots|recording|all] [http://localhost:4600]
 * Writes to submission/ (not deployed). Needs ffmpeg with libx264 and
 * libvpx-vp9 for the recording. CHROMIUM_PATH optional.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'submission');
const what = process.argv[2] ?? 'all';
const base = process.argv[3] ?? 'http://localhost:4600';
const FRAME = 1000 / 60;

const browser: Browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// ── Deterministic time ────────────────────────────────────────────────────

/**
 * The page's clock, controlled from here. Time runs normally while a page
 * loads (fetching, shader compiles, layer fades), then `freeze()` stops it:
 * from there on performance.now, Date.now and requestAnimationFrame's
 * timestamp move only when `advance()` is called. The real
 * requestAnimationFrame keeps firing, so the page still paints (and
 * screenshots stay fast); every callback just sees the frozen time.
 */
// Plain JavaScript source (not a function): the TypeScript loader's helpers
// don't exist in the page.
const TIME_CONTROL = `(() => {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const dateBase = Date.now() - realNow();
  let frozen = null;
  const now = () => (frozen === null ? realNow() : frozen);
  performance.now = now;
  Date.now = () => Math.round(dateBase + now());
  window.requestAnimationFrame = (callback) => realRaf(() => callback(now()));
  window.__freeze = () => { frozen = realNow(); };
  window.__advance = (ms) => { if (frozen !== null) frozen += ms; };
  // Resolves after two real frames: everything scheduled for this time has drawn.
  window.__painted = () => new Promise((resolve) => realRaf(() => realRaf(() => resolve())));
})();`;

/** Pause every CSS animation, transition and view-transition animation, and move each on by `ms`. */
const stepAnimations = (page: Page, ms: number) =>
  page.evaluate((ms) => {
    for (const animation of document.getAnimations()) {
      // Scroll-driven animations (the reading progress) follow the scroll, not time.
      if (animation.timeline !== document.timeline || animation.playState === 'finished') continue;
      animation.pause();
      animation.currentTime = Number(animation.currentTime ?? 0) + ms;
    }
  }, ms);

type Controlled = Window & {
  __freeze(): void;
  __advance(ms: number): void;
  __painted(): Promise<void>;
};

/** One frame: CSS animations and the page clock both advance 1/60 s, and it's drawn. */
async function frame(page: Page) {
  await stepAnimations(page, FRAME);
  await page.evaluate(async (ms) => {
    const w = window as unknown as Controlled;
    w.__advance(ms);
    await w.__painted();
  }, FRAME);
}

async function frames(page: Page, count: number) {
  for (let i = 0; i < count; i++) await frame(page);
}

async function open(viewport: { width: number; height: number }, scale = 1, mobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile,
  });
  // The first-visit intro is part of the experience, not of a still.
  await context.addInitScript(() => sessionStorage.setItem('monolith:intro', '1'));
  await context.addInitScript(TIME_CONTROL);
  return context.newPage();
}

/**
 * Load a page on a forced tier at full resolution (`scale=1` holds the dynamic
 * resolution, which a software renderer would otherwise lower), wait in real
 * time for its scene and every layer, then freeze the clock.
 */
async function load(page: Page, path: string, tier: 'high' | 'lite') {
  await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}tier=${tier}&scale=1`);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('[data-scene-stage].is-live', { timeout: 120_000 });
  await page.waitForTimeout(12_000); // progressive layers, fades, reveals, the first glide
  await page.evaluate(() => (window as unknown as Controlled).__freeze());
  await frames(page, 30);
}

/** Scroll the home story to a chapter the way its own links do (Lenis, eased), then let it settle. */
async function toChapter(page: Page, id: string) {
  await page.evaluate((id) => {
    const link = document.querySelector<HTMLAnchorElement>(`a[href="#${id}"]`);
    link?.click();
  }, id);
  await frames(page, 150);
}

// ── Screenshots ──────────────────────────────────────────────────────────

async function screenshots() {
  const dir = join(out, 'screenshots');
  mkdirSync(dir, { recursive: true });
  const sizes = [
    { name: '1600x1200', viewport: { width: 1600, height: 1200 }, tier: 'high' as const },
    { name: '2560x1440', viewport: { width: 2560, height: 1440 }, tier: 'high' as const },
    {
      name: 'phone-390x844',
      viewport: { width: 390, height: 844 },
      tier: 'lite' as const,
      scale: 3,
      mobile: true,
    },
  ];
  for (const size of sizes) {
    const page = await open(size.viewport, size.scale ?? 1, size.mobile);
    const shot = async (name: string) => {
      // The chapter links focus their heading (right for keyboard users); a still
      // shouldn't show the focus ring.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await frame(page);
      await page.screenshot({
        path: join(dir, `${size.name}-${name}.jpg`),
        type: 'jpeg',
        quality: 93,
      });
      console.log(`screenshots/${size.name}-${name}.jpg`);
    };

    await load(page, '/', size.tier);
    await shot('home-00-arrival');
    for (const [i, id] of ['face-i', 'face-ii', 'the-lab', 'the-core'].entries()) {
      await toChapter(page, id);
      await shot(`home-0${i + 1}-${id}`);
    }
    // The dive: on past The Core, into the fissure.
    await page.evaluate(() => scrollBy({ top: innerHeight * 1.1, behavior: 'instant' }));
    await frames(page, 150);
    await shot('home-05-the-dive');

    for (const [path, name] of [
      ['/work', 'work'],
      ['/work/seqdvgc', 'case-study'],
      ['/services', 'services'],
      ['/contact', 'contact'],
    ] as const) {
      await load(page, path, size.tier);
      await shot(name);
    }
    await page.context().close();
  }
}

// ── Recording ────────────────────────────────────────────────────────────

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function recording() {
  const dir = join(out, 'recording-frames');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await open({ width: 1920, height: 1080 });
  let n = 0;
  const capture = async () => {
    await frame(page);
    await page.screenshot({
      path: join(dir, `${String(n++).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: 92,
    });
    if (n % 60 === 0) console.log(`recording: ${n / 60} s`);
  };
  const hold = async (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) await capture();
  };
  /** Scroll smoothly (eased) to y over `seconds`, one frame at a time. */
  const scrollToY = async (y: number, seconds: number) => {
    const from = await page.evaluate(() => scrollY);
    const count = Math.round(seconds * 60);
    for (let i = 1; i <= count; i++) {
      const top = from + (y - from) * ease(i / count);
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), top);
      await capture();
    }
  };
  /** Where the story's own chapter links would take the page. */
  const chapterY = (id: string) =>
    page.evaluate((id) => {
      const el = document.getElementById(id)!;
      return el.getBoundingClientRect().top + scrollY;
    }, id);

  await load(page, '/', 'high');
  await hold(1.5);
  await scrollToY(await chapterY('face-i'), 3.5);
  await hold(1.2);

  // Into the SEQDVGC case study through its card: the page transition.
  // A real mouse click, as a visitor would (no keyboard focus ring follows it).
  await page.locator('#face-i a[href="/work/seqdvgc"]').click();
  await hold(3);
  await scrollToY((await page.evaluate(() => innerHeight)) * 1.2, 3);
  await hold(1);
  await scrollToY(0, 1.5);
  await hold(0.5);

  // And back: the story is restored where it was left.
  await page.evaluate(() => history.back());
  await hold(2);
  for (const id of ['face-ii', 'the-lab', 'the-core']) {
    await scrollToY(await chapterY(id), 3);
    await hold(1);
  }
  // The dive.
  await scrollToY(await page.evaluate(() => scrollY + innerHeight * 1.3), 4);
  await hold(2);
  await page.context().close();

  const mp4 = join(out, 'monolith-recording-1080p60.mp4');
  const webm = join(out, 'monolith-recording-1080p60.webm');
  const input = ['-y', '-framerate', '60', '-i', join(dir, '%05d.jpg')];
  execFileSync(
    'ffmpeg',
    [
      ...input,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      mp4,
    ],
    { stdio: 'inherit' },
  );
  execFileSync(
    'ffmpeg',
    [
      ...input,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '34',
      '-row-mt',
      '1',
      '-pix_fmt',
      'yuv420p',
      webm,
    ],
    { stdio: 'inherit' },
  );
  for (const file of [mp4, webm])
    console.log(
      `${file}: ${(statSync(file).size / 1e6).toFixed(1)} MB, ${n} frames (${(n / 60).toFixed(1)} s)`,
    );
  rmSync(dir, { recursive: true, force: true });
}

try {
  if (what === 'screenshots' || what === 'all') await screenshots();
  if (what === 'recording' || what === 'all') await recording();
} finally {
  await browser.close();
}
