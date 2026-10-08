#!/usr/bin/env -S npx tsx
/**
 * Case study images from the live client sites (real screenshots of real work):
 *
 *   src/assets/work/<slug>-cover.png     1600×1000, the top of the home page
 *   src/assets/work/<slug>-desktop.png   1600×1000, further down the home page
 *   src/assets/work/<slug>-mobile.png    780×1600, the home page on a phone
 *   public/media/<slug>-recording.mp4    (with --recording) a 1280×800 scroll
 *                                        through the home page, 30 fps, no sound
 *
 * Usage: npm run capture:work -- <slug> <url> [--recording]
 * Needs ffmpeg (libx264) for the recording. CHROMIUM_PATH, CHROMIUM_ARGS and
 * FETCH_VIA_NODE=1 (route requests through Node's TLS stack) optional.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const [slug, url] = process.argv.slice(2);
const withRecording = process.argv.includes('--recording');
if (!slug || !url) {
  console.error('Usage: npm run capture:work -- <slug> <url> [--recording]');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'src/assets/work');
mkdirSync(assets, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  // Extra flags, space-separated (e.g. to trust a corporate proxy's CA by its SPKI hash).
  args: process.env.CHROMIUM_ARGS?.split(' ').filter(Boolean),
});

async function open(width: number, height: number, scale: number, mobile = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
  });
  if (process.env.FETCH_VIA_NODE === '1') {
    // Behind a TLS-intercepting proxy the browser may not trust, Node (which
    // honours NODE_EXTRA_CA_CERTS) fetches every request instead.
    await context.route('**/*', async (route) => route.fulfill({ response: await route.fetch() }));
  }
  const page = await context.newPage();
  await page.goto(url!, { waitUntil: 'networkidle', timeout: 60_000 });
  // Lazy images and on-scroll reveals: pass through the page once, then return.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);
  return page;
}

try {
  const desktop = await open(1280, 800, 1.25);
  await desktop.screenshot({ path: join(assets, `${slug}-cover.png`) });
  await desktop.evaluate(() => scrollTo(0, innerHeight * 0.9));
  await desktop.waitForTimeout(800);
  await desktop.screenshot({ path: join(assets, `${slug}-desktop.png`) });
  await desktop.context().close();

  const phone = await open(390, 800, 2, true);
  await phone.screenshot({ path: join(assets, `${slug}-mobile.png`) });
  await phone.context().close();

  if (withRecording) {
    const frames = join(tmpdir(), `capture-work-${slug}`);
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    const page = await open(1280, 800, 1);
    const end = Math.min(
      await page.evaluate(() => document.body.scrollHeight - innerHeight),
      800 * 4,
    );
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const total = 30 * 9; // 1 s still, 7 s scroll, 1 s still
    for (let i = 0; i < total; i++) {
      const t = Math.min(1, Math.max(0, (i - 30) / 210));
      await page.evaluate((y) => scrollTo(0, y), Math.round(end * ease(t)));
      await page.waitForTimeout(30);
      await page.screenshot({
        path: join(frames, `${String(i).padStart(4, '0')}.jpg`),
        type: 'jpeg',
        quality: 90,
      });
    }
    await page.context().close();
    const mp4 = join(root, 'public/media', `${slug}-recording.mp4`);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      '30',
      '-i',
      join(frames, '%04d.jpg'),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      mp4,
    ]);
    // The video's poster: its first frame.
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      join(frames, '0000.jpg'),
      '-vf',
      'scale=1600:1000',
      join(assets, `${slug}-recording.png`),
    ]);
    rmSync(frames, { recursive: true, force: true });
  }
  console.log(`captured ${slug} from ${url}`);
} finally {
  await browser.close();
}
