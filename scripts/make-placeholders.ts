#!/usr/bin/env -S npx tsx
/**
 * Renders the placeholder media for content that hasn't been supplied yet:
 * covers, screenshots and one screen recording, each clearly labelled with
 * its bracketed placeholder. Replace the files (and their alt text) when the
 * real media arrives; nothing here pretends to be a real screenshot.
 *
 * Usage: npm run placeholders   (needs ffmpeg with libx264; CHROMIUM_PATH optional)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PALETTE_HEX as P } from '../src/scene/palette.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'src/assets/placeholders');
const media = resolve(root, 'public/media');
mkdirSync(assets, { recursive: true });
mkdirSync(media, { recursive: true });

const font = (file: string) =>
  `url(data:font/woff2;base64,${readFileSync(resolve(root, 'public/fonts', file)).toString('base64')})`;

interface Card {
  file: string;
  width: number;
  height: number;
  eyebrow: string;
  label: string;
}

const CARDS: Card[] = [
  {
    file: 'seqdvgc-cover.png',
    width: 1600,
    height: 1000,
    eyebrow: 'SEQDVGC',
    label: '[COVER IMAGE TO BE SUPPLIED]',
  },
  {
    file: 'seqdvgc-desktop.png',
    width: 1600,
    height: 1000,
    eyebrow: 'SEQDVGC · desktop',
    label: '[SCREENSHOT TO BE SUPPLIED]',
  },
  {
    file: 'seqdvgc-mobile.png',
    width: 780,
    height: 1600,
    eyebrow: 'SEQDVGC · mobile',
    label: '[SCREENSHOT TO BE SUPPLIED]',
  },
  {
    file: 'seqdvgc-recording.png',
    width: 1600,
    height: 1000,
    eyebrow: 'SEQDVGC · screen recording',
    label: '[SCREEN RECORDING TO BE SUPPLIED]',
  },
  {
    file: 'allen-gillon-cover.png',
    width: 1600,
    height: 1000,
    eyebrow: 'Allen Gillon',
    label: '[COVER IMAGE TO BE SUPPLIED]',
  },
  {
    file: 'allen-gillon-desktop.png',
    width: 1600,
    height: 1000,
    eyebrow: 'Allen Gillon · desktop',
    label: '[SCREENSHOT TO BE SUPPLIED]',
  },
  {
    file: 'allen-gillon-mobile.png',
    width: 780,
    height: 1600,
    eyebrow: 'Allen Gillon · mobile',
    label: '[SCREENSHOT TO BE SUPPLIED]',
  },
  {
    file: 'concept-cover.png',
    width: 1600,
    height: 1000,
    eyebrow: 'Concept',
    label: '[CONCEPT SUBJECT TO BE CHOSEN]',
  },
];

const page = (card: Card) => `<!doctype html><html><head><style>
@font-face { font-family: Sora; font-weight: 200; src: ${font('sora-latin-200-normal.woff2')}; }
@font-face { font-family: Mono; font-weight: 400; src: ${font('jetbrains-mono-latin-400-normal.woff2')}; }
html, body { margin: 0; width: ${card.width}px; height: ${card.height}px; }
body {
  display: grid; place-content: center; gap: 28px; text-align: center;
  background:
    linear-gradient(${P.obsidianEdge} 1px, transparent 1px) 0 0 / 80px 80px,
    linear-gradient(90deg, ${P.obsidianEdge} 1px, transparent 1px) 0 0 / 80px 80px,
    radial-gradient(80% 70% at 50% 110%, ${P.magma}, ${P.basalt} 70%);
  color: ${P.bone};
  border-top: 6px solid ${P.lava};
  box-sizing: border-box;
}
.eyebrow { font: 400 ${Math.round(card.width / 48)}px Mono; letter-spacing: 0.16em; text-transform: uppercase; color: ${P.ash}; }
.label { font: 200 ${Math.round(card.width / 22)}px Sora; letter-spacing: -0.02em; max-width: 14ch; margin: 0 auto; line-height: 1.1; }
</style></head><body><div class="eyebrow">${card.eyebrow}</div><div class="label">${card.label}</div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const tmp = mkdtempSync(join(tmpdir(), 'placeholders-'));
try {
  for (const card of CARDS) {
    const tab = await browser.newPage({ viewport: { width: card.width, height: card.height } });
    await tab.setContent(page(card));
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: join(assets, card.file) });
    await tab.close();
  }
  // A short, slow push-in on the recording card: exercises the video player
  // (muted, looping, play only in view) until a real recording is supplied.
  const still = join(assets, 'seqdvgc-recording.png');
  execFileSync('ffmpeg', [
    ...['-loglevel', 'error', '-y', '-loop', '1', '-i', still, '-t', '6'],
    ...['-vf', "scale=1600:1000,zoompan=z='1+0.0008*on':d=1:s=1280x800:fps=25"],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', '-an'],
    join(media, 'seqdvgc-recording.mp4'),
  ]);
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`placeholders written to ${assets} and ${media}`);
