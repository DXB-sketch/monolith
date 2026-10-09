#!/usr/bin/env -S npx tsx
/**
 * Open Graph / Twitter images, one per page (public/og/<key>.jpg, 1200×630,
 * under 300 KB each), on the poster tooling: each page's own camera view is
 * rendered on the High tier in the dev scene viewer (deterministic capture),
 * then the page's headline is set over it in Sora, with the wordmark.
 *
 * Usage:
 *   npm run dev                      # in another terminal
 *   npm run og                       # or: npx tsx scripts/render-og.ts http://localhost:4321
 *
 * Re-run whenever a page headline or a case study title changes (titles are
 * read from the content entries). CHROMIUM_PATH optional.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PALETTE_HEX as P } from '../src/scene/palette.ts';

const base = process.argv[2] ?? 'http://localhost:4321';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/og');
mkdirSync(outDir, { recursive: true });

const MAX_BYTES = 300 * 1024;

/** Flags the dev scene viewer sets when its capture is ready (or failed). */
type SceneWindow = Window & { __sceneReady?: boolean; __sceneError?: string };

/** Front-matter title of a content entry. */
function titleOf(file: string) {
  const match = readFileSync(file, 'utf8').match(/^title:\s*(.+)$/m);
  return match ? match[1]!.trim().replace(/^['"]|['"]$/g, '') : '';
}

interface Card {
  key: string;
  eyebrow: string;
  title: string;
  accent: string;
  /** The scene: a page view, or a story position (home). */
  scene: string;
}

const CARDS: Card[] = [
  // Phase 6: the 2D landing page's headline; /potential has the story's arrival.
  {
    key: 'home',
    eyebrow: 'Custom websites · South East Queensland',
    title: 'Your business deserves better than',
    accent: 'a template.',
    scene: 'progress=0',
  },
  {
    key: 'potential',
    eyebrow: 'Full 3D · Optional',
    title: 'See the',
    accent: 'potential.',
    scene: 'progress=0',
  },
  { key: 'work', eyebrow: 'Work', title: 'Sites built', accent: 'to stand.', scene: 'view=work' },
  {
    key: 'services',
    eyebrow: 'Services',
    title: 'Three ways to',
    accent: 'work together.',
    scene: 'view=services',
  },
  {
    key: 'about',
    eyebrow: 'About',
    title: 'One person,',
    accent: 'start to finish.',
    scene: 'view=about',
  },
  {
    key: 'lab',
    eyebrow: 'Lab',
    title: 'Experiments in',
    accent: 'light and stone.',
    scene: 'view=lab',
  },
  {
    key: 'contact',
    eyebrow: 'Contact',
    title: 'Let’s make something',
    accent: 'that stands.',
    scene: 'view=contact',
  },
  {
    key: 'notfound',
    eyebrow: '404 · Unknown terrain',
    title: 'You’ve wandered off the',
    accent: 'edge of the map.',
    scene: 'view=notfound',
  },
  {
    key: 'privacy',
    eyebrow: 'Privacy',
    title: 'Your details,',
    accent: 'in plain English.',
    scene: 'view=about',
  },
];
for (const [dir, prefix, eyebrow, view] of [
  ['work', 'case', 'Case study', 'case'],
  ['lab', 'lab', 'Lab', 'lab'],
] as const) {
  const folder = resolve(root, 'src/content', dir);
  for (const name of readdirSync(folder).filter((n) => n.endsWith('.md'))) {
    const file = resolve(folder, name);
    if (!statSync(file).isFile()) continue;
    const id = name.replace(/\.md$/, '');
    const concept = /^isConcept:\s*true/m.test(readFileSync(file, 'utf8'));
    CARDS.push({
      key: `${prefix}-${id}`,
      eyebrow: concept ? 'Concept' : eyebrow,
      title: titleOf(file),
      accent: '',
      scene: `view=${view}`,
    });
  }
}

const font = (file: string) =>
  `url(data:font/woff2;base64,${readFileSync(resolve(root, 'public/fonts', file)).toString('base64')})`;

const compose = (card: Card, background: string) => `<!doctype html><html><head><style>
@font-face { font-family: Sora; font-weight: 200; src: ${font('sora-latin-200-normal.woff2')}; }
@font-face { font-family: Sora; font-weight: 500; src: ${font('sora-latin-500-normal.woff2')}; }
@font-face { font-family: Mono; font-weight: 400; src: ${font('jetbrains-mono-latin-400-normal.woff2')}; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: ${P.basalt}; }
.bg { position: absolute; inset: 0; background: url(${background}) center / cover; }
.scrim { position: absolute; inset: 0; background: linear-gradient(90deg, ${P.basalt}e6 0%, ${P.basalt}b3 45%, ${P.basalt}1a 80%); }
.rule { position: absolute; left: 0; right: 0; top: 0; height: 4px; background: ${P.lava}; }
.copy { position: absolute; left: 80px; right: 360px; bottom: 96px; color: ${P.bone}; }
.eyebrow { font: 400 20px Mono; letter-spacing: 0.16em; text-transform: uppercase; color: ${P.ash}; margin-bottom: 22px; }
h1 { margin: 0; font: 200 72px/1.04 Sora; letter-spacing: -0.035em; }
h1 em { display: block; font-style: normal; font-weight: 500; color: ${P.lava}; }
.mark { position: absolute; left: 80px; top: 64px; font: 500 18px Sora; letter-spacing: 0.42em; color: ${P.bone}; }
</style></head><body>
<div class="bg"></div><div class="scrim"></div><div class="rule"></div>
<div class="mark">MONOLITH</div>
<div class="copy"><div class="eyebrow">${card.eyebrow}</div><h1>${card.title}${card.accent ? `<em>${card.accent}</em>` : ''}</h1></div>
</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  for (const card of CARDS) {
    const scene = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await scene.goto(`${base}/dev/scene?tier=high&capture=12&${card.scene}`);
    await scene.waitForFunction(
      () => (window as SceneWindow).__sceneReady || (window as SceneWindow).__sceneError,
      null,
      {
        timeout: 300_000,
      },
    );
    const error = await scene.evaluate(() => (window as SceneWindow).__sceneError);
    if (error) throw new Error(`${card.key}: ${error}`);
    const background = `data:image/png;base64,${(await scene.screenshot()).toString('base64')}`;
    await scene.close();

    const page = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await page.setContent(compose(card, background));
    await page.evaluate(() => document.fonts.ready);
    let quality = 86;
    let jpg = await page.screenshot({ type: 'jpeg', quality });
    while (jpg.length > MAX_BYTES && quality > 50) {
      quality -= 6;
      jpg = await page.screenshot({ type: 'jpeg', quality });
    }
    await page.close();
    writeFileSync(resolve(outDir, `${card.key}.jpg`), jpg);
    console.log(`og/${card.key}.jpg  ${(jpg.length / 1024).toFixed(0)} KB (q${quality})`);
  }
} finally {
  await browser.close();
}
