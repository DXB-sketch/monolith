#!/usr/bin/env node
/**
 * Renders the scene to static posters in public/posters/ (WebP + AVIF), used as
 * the fallback for Low/Off tiers, the first paint before the scene loads, and
 * Open Graph images.
 *
 * Usage:
 *   npm run dev                       # in another terminal
 *   npm run posters                   # or: node scripts/render-posters.mjs http://localhost:4321
 *
 * Needs ffmpeg (with libwebp and libaom/libsvtav1) on PATH. Set CHROMIUM_PATH to
 * use a specific Chromium build. WebGL is forced on via SwiftShader if no GPU.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4321';
const out = resolve('public/posters');
const tmp = mkdtempSync(join(tmpdir(), 'posters-'));

/** name, width, height. Portrait posters frame the stone above the hero copy. */
const SIZES = [
  ['hero-1920', 1920, 1080],
  ['hero-1280', 1280, 720],
  ['hero-portrait-1080', 1080, 2160],
  ['hero-portrait-720', 720, 1440],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  for (const [name, width, height] of SIZES) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`${base}/dev/scene?tier=high&capture=12`);
    await page.waitForFunction(() => window.__sceneReady || window.__sceneError, null, {
      timeout: 300_000,
    });
    const error = await page.evaluate(() => window.__sceneError);
    if (error) throw new Error(error);
    const png = join(tmp, `${name}.png`);
    // Large portrait frames on SwiftShader can take well over the default 30 s.
    await page.screenshot({ path: png, timeout: 300_000 });
    await page.close();

    const webp = join(out, `${name}.webp`);
    const avif = join(out, `${name}.avif`);
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-i',
      png,
      '-c:v',
      'libwebp',
      '-quality',
      '72',
      webp,
    ]);
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-y',
      '-i',
      png,
      '-c:v',
      'libaom-av1',
      '-still-picture',
      '1',
      '-crf',
      '34',
      '-cpu-used',
      '4',
      '-pix_fmt',
      'yuv420p',
      avif,
    ]);
    const kb = (file) => `${(statSync(file).size / 1024).toFixed(0)} KB`;
    console.log(`${name}: webp ${kb(webp)}, avif ${kb(avif)}`);
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
