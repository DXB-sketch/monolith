#!/usr/bin/env -S npx tsx
/**
 * The icon set, rendered from public/favicon.svg (npm run icons):
 *
 *   favicon.ico            16 and 32 px, PNG inside ICO (the fallback for old browsers)
 *   apple-touch-icon.png   180 px
 *   icon-192.png, icon-512.png
 *   icon-maskable-512.png  the mark inside the 80% safe zone, on a full-bleed basalt field
 *
 * Re-run after changing the favicon. Needs Playwright's Chromium (CHROMIUM_PATH optional).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PALETTE_HEX as P } from '../src/scene/palette.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (name: string) => resolve(root, 'public', name);
const svg = readFileSync(out('favicon.svg'), 'utf8');
const svgData = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function render(size: number, maskable = false): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // The mark fills the icon; the maskable icon keeps it inside the central 80%
  // (with margin to spare), so any platform mask leaves it whole.
  const inset = maskable ? Math.round(size * 0.18) : 0;
  await page.setContent(
    `<html><body style="margin:0;background:${maskable ? P.basalt : 'transparent'}">` +
      `<img src="${svgData}" style="display:block;position:absolute;inset:${inset}px;width:${size - inset * 2}px;height:${size - inset * 2}px"></body></html>`,
  );
  await page.waitForFunction(() => document.images[0]?.complete);
  const png = await page.screenshot({ omitBackground: !maskable, type: 'png' });
  await page.close();
  return png;
}

/** An ICO file whose entries are PNG images (supported everywhere ICO is). */
function ico(images: { size: number; png: Buffer }[]) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

try {
  writeFileSync(
    out('favicon.ico'),
    ico([
      { size: 16, png: await render(16) },
      { size: 32, png: await render(32) },
    ]),
  );
  writeFileSync(out('apple-touch-icon.png'), await render(180, true));
  writeFileSync(out('icon-192.png'), await render(192));
  writeFileSync(out('icon-512.png'), await render(512));
  writeFileSync(out('icon-maskable-512.png'), await render(512, true));
} finally {
  await browser.close();
}
console.log('icons written to public/');
