#!/usr/bin/env -S npx tsx
/**
 * Renders the 2D landing page's hero (Phase 6): the real scene, pre-rendered as
 * an image sequence of the stone turning, scrubbed by scroll (src/lib/orbit.ts).
 * The stone is never drawn by hand: every frame comes from the Three.js scene.
 *
 * Capture: the dev scene route (/dev/scene, as scripts/render-posters.mjs) on the
 * High tier, every layer in, full resolution scale, the clock frozen. The camera
 * follows the capture-only orbit path (ORBIT_CAPTURE in src/scene/camera-path.ts;
 * the story's path is untouched). 72 frames at 5° steps cover 360°, the magma
 * advancing by a constant TIME_STEP per frame.
 *
 * Output, public/media/orbit/:
 *   desktop  72 frames, 960×1200 WebP (orbit-d-00.webp …), frame 0 also AVIF
 *   phone    36 frames (every other angle), 640×800 WebP (orbit-m-00.webp …),
 *            downscaled from the desktop renders; frame 0 also AVIF
 *   orbit.json  the manifest: counts, sizes, file names, angle step
 * Budgets: desktop set ≤ 2.8 MB, phone set ≤ 1.0 MB. The WebP quality starts at
 * 72 and steps down until each set fits; the final numbers are printed.
 *
 * Usage:
 *   npm run dev            # in another terminal
 *   npm run orbit          # or: npx tsx scripts/render-orbit.ts http://localhost:4321
 * Needs ffmpeg (libwebp, libaom-av1). CHROMIUM_PATH optional; WebGL runs on
 * SwiftShader unless CHROMIUM_ARGS says otherwise (the output is the same, only slower).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4321';
const out = resolve('public/media/orbit');
const tmp = mkdtempSync(join(tmpdir(), 'orbit-'));

const FRAMES = 72;
const STEP_DEG = 360 / FRAMES;
/** Scene time of frame 0 (as the posters), and the magma's advance per frame. */
const TIME_START = 12;
const TIME_STEP = 0.1;
const DESKTOP = { width: 960, height: 1200, budget: 2.8e6 };
const PHONE = { width: 640, height: 800, budget: 1.0e6 };
const QUALITY_START = 72;
const QUALITY_MIN = 40;

const pad = (n: number) => String(n).padStart(2, '0');
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
const size = (files: string[]) => files.reduce((sum, file) => sum + statSync(file).size, 0);
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(2)} MB`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CHROMIUM_ARGS?.split(' ') ?? [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

try {
  // ── Render the desktop frames (PNG) ─────────────────────────────────────
  const page = await browser.newPage({
    viewport: { width: DESKTOP.width, height: DESKTOP.height },
    deviceScaleFactor: 1,
  });
  await page.goto(`${base}/dev/scene?tier=high&capture=${TIME_START}&orbit`);
  await page.waitForFunction(
    () =>
      (window as unknown as { __sceneReady?: boolean; __sceneError?: string }).__sceneReady ||
      (window as unknown as { __sceneError?: string }).__sceneError,
    null,
    { timeout: 300_000 },
  );
  const failure = await page.evaluate(
    () => (window as unknown as { __sceneError?: string }).__sceneError,
  );
  if (failure) throw new Error(failure);

  const pngs: string[] = [];
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate(
      ([time, degrees]) =>
        (
          window as unknown as { __orbitFrame: (t: number, d: number) => Promise<void> }
        ).__orbitFrame(time!, degrees!),
      [TIME_START + i * TIME_STEP, i * STEP_DEG],
    );
    const png = join(tmp, `d-${pad(i)}.png`);
    await page.screenshot({ path: png });
    pngs.push(png);
    if (i % 12 === 0) console.log(`rendered ${i + 1}/${FRAMES}`);
  }
  await page.close();

  // ── Encode, lowering the quality until each set fits its budget ─────────
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const encodeSet = (
    name: 'd' | 'm',
    indices: number[],
    target: { width: number; height: number; budget: number },
  ) => {
    for (let quality = QUALITY_START; quality >= QUALITY_MIN; quality -= 4) {
      const files = indices.map((frame, n) => {
        const file = join(out, `orbit-${name}-${pad(n)}.webp`);
        ffmpeg([
          '-i',
          pngs[frame]!,
          '-vf',
          `scale=${target.width}:${target.height}:flags=lanczos`,
          '-c:v',
          'libwebp',
          '-quality',
          String(quality),
          '-compression_level',
          '6',
          file,
        ]);
        return file;
      });
      const total = size(files);
      if (total <= target.budget || quality - 4 < QUALITY_MIN) {
        if (total > target.budget)
          throw new Error(`${name}: ${mb(total)} over budget at q${quality}`);
        return { files, total, quality };
      }
      console.log(`${name}: ${mb(total)} at q${quality}, over ${mb(target.budget)}: lowering`);
    }
    throw new Error('unreachable');
  };

  const desktopFrames = Array.from({ length: FRAMES }, (_, i) => i);
  const phoneFrames = desktopFrames.filter((i) => i % 2 === 0);
  const desktop = encodeSet('d', desktopFrames, DESKTOP);
  const phone = encodeSet('m', phoneFrames, PHONE);

  // Frame 0 as AVIF too: the hero's <picture> (and LCP candidate).
  for (const [name, target] of [
    ['d', DESKTOP],
    ['m', PHONE],
  ] as const) {
    ffmpeg([
      '-i',
      pngs[0]!,
      '-vf',
      `scale=${target.width}:${target.height}:flags=lanczos`,
      '-c:v',
      'libaom-av1',
      '-still-picture',
      '1',
      '-crf',
      '30',
      '-cpu-used',
      '4',
      '-pix_fmt',
      'yuv420p',
      join(out, `orbit-${name}-00.avif`),
    ]);
  }

  const file = (path: string) => path.split(/[\\/]/).pop()!;
  const manifest = {
    note: 'Generated by scripts/render-orbit.ts (npm run orbit). Frames are rendered from the real scene.',
    stepDegrees: STEP_DEG,
    timeStep: TIME_STEP,
    desktop: {
      count: desktop.files.length,
      width: DESKTOP.width,
      height: DESKTOP.height,
      stepDegrees: STEP_DEG,
      quality: desktop.quality,
      bytes: desktop.total,
      poster: 'orbit-d-00.avif',
      frames: desktop.files.map(file),
    },
    phone: {
      count: phone.files.length,
      width: PHONE.width,
      height: PHONE.height,
      stepDegrees: STEP_DEG * 2,
      quality: phone.quality,
      bytes: phone.total,
      poster: 'orbit-m-00.avif',
      frames: phone.files.map(file),
    },
  };
  writeFileSync(join(out, 'orbit.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const avif = readdirSync(out).filter((f) => f.endsWith('.avif'));
  console.log(
    `desktop: ${desktop.files.length} frames, ${mb(desktop.total)} at q${desktop.quality}`,
  );
  console.log(`phone: ${phone.files.length} frames, ${mb(phone.total)} at q${phone.quality}`);
  console.log(
    `frame 0 AVIF: ${avif.map((f) => `${f} ${(statSync(join(out, f)).size / 1024).toFixed(0)} KB`).join(', ')}`,
  );
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
