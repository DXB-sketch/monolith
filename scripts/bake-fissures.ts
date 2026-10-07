#!/usr/bin/env -S npx tsx
/**
 * Bakes the monolith's fissure field into public/textures/fissures.png, the
 * atlas the Medium and Lite tiers sample instead of computing 3D Voronoi
 * per pixel.
 *
 * The field is computed by the same GLSL the High tier runs
 * (src/scene/shaders/fissure-field.glsl), rendered headlessly in Chromium
 * (SwiftShader is fine), at the exact displaced surface point each texel maps
 * to (src/scene/monolith-geometry.ts). So High and the baked tiers show the
 * same veins.
 *
 * Channels (8-bit each):
 *   r: main vein edge distance, e = dMain − width, pushed 6 cm out where the
 *      vein breaks (sqrt-encoded, −0.04..0.56 m)
 *   g: branch edge distance, gated where branches can't grow (same encoding)
 *   b: vein strength (the region mask)
 *   a: pulse phase (snoise, −1..1 → 0..1; never 0, so no encoder alters rgb)
 *
 * Two files:
 *   fissures-planes.avif  the four channels as grayscale planes in a 2048×4096
 *                         image (r g / b a), lossy AV1 (crf 6: mean error about
 *                         half a code value). About 175 KB. Repacked into an
 *                         RGBA texture on the GPU at load (src/scene/atlas.ts).
 *   fissures.png          the same atlas as lossless RGBA, about 1.2 MB: only
 *                         for browsers that can't decode AVIF.
 *
 * Usage: npm run bake   (needs ffmpeg with libaom; CHROMIUM_PATH selects a Chromium build)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ATLAS_HEIGHT, ATLAS_WIDTH, atlasPoint, displace } from '../src/scene/monolith-geometry.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/textures/fissures.png');
const outPlanes = resolve(root, 'public/textures/fissures-planes.avif');
const glsl = (name: string) => readFileSync(resolve(root, 'src/scene/shaders', name), 'utf8');

// ── Surface points, one per texel (texel centres; row 0 is v = 0) ─────────
const W = ATLAS_WIDTH;
const H = ATLAS_HEIGHT;
const points = new Float32Array(W * H * 4);
const p: [number, number, number] = [0, 0, 0];
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const hit = atlasPoint((i + 0.5) / W, (j + 0.5) / H);
    const k = (j * W + i) * 4;
    if (!hit) continue;
    displace(hit[1], hit[2], hit[3], p);
    points.set([p[0], p[1], p[2], 1], k);
  }
}

const fragment = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPoints;
out vec4 outColor;
${glsl('noise.glsl')}
${glsl('fissure-field.glsl')}

float dMainNear(float e) { return e + 0.02; }

float encodeEdge(float e) {
  return sqrt(clamp((e + 0.04) / 0.6, 0.0, 1.0));
}

void main() {
  vec4 point = texelFetch(uPoints, ivec2(gl_FragCoord.xy), 0);
  if (point.w < 0.5) { outColor = vec4(1.0, 1.0, 0.0, 0.5); return; }
  vec3 p = point.xyz;
  vec3 q = fissureWarp(p);
  float width = fissureWidth(p);
  // Breaks along each vein push the edge away (6 cm): the bright line breaks,
  // but its glow carries on through the gap, as bloom gives it on High.
  float e = fissureMainDistance(q) - width + (1.0 - fissureAlong(p)) * 0.06;
  // Branches the gate rules out are pushed out of reach (5 cm).
  float eb = fissureBranchDistance(q) - width * 0.45 + (1.0 - fissureBranchGate(p)) * 0.05;
  float strength = smoothstep(-0.12, 0.3, fissureRegion(p));
  float phase = fissurePhase(p) / 6.2831;
  // Branch light is invisible past ~12 cm (and only near main veins): flatten it.
  eb = min(eb, 0.12);
  if (dMainNear(e) > 1.4) eb = 0.12;
  vec4 texel = vec4(encodeEdge(e), encodeEdge(eb), strength, clamp(phase * 0.5 + 0.5, 1.0 / 255.0, 1.0));
  // Where no vein can show (strength 0, even with heat), the other channels
  // are never read: a constant there compresses to almost nothing.
  if (strength < 0.5 / 255.0) texel = vec4(1.0, encodeEdge(0.12), 0.0, 0.5);
  outColor = texel;
}
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let rgba: Buffer;
try {
  const page = await browser.newPage();
  // tsx (esbuild) wraps named functions in a __name() helper that the page lacks.
  await page.addInitScript('window.__name = (fn) => fn');
  await page.route('https://bake.local/points.bin', (route) =>
    route.fulfill({ body: Buffer.from(points.buffer), contentType: 'application/octet-stream' }),
  );
  await page.route('https://bake.local/', (route) =>
    route.fulfill({ body: '<!doctype html><title>bake</title>', contentType: 'text/html' }),
  );
  await page.goto('https://bake.local/');
  const base64 = await page.evaluate(
    async ({ fragment, W, H }) => {
      const data = new Float32Array(await (await fetch('/points.bin')).arrayBuffer());
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const gl = canvas.getContext('webgl2')!;
      const shader = (type: number, source: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
        return s;
      };
      const program = gl.createProgram()!;
      gl.attachShader(
        program,
        shader(
          gl.VERTEX_SHADER,
          `#version 300 es
          in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,
        ),
      );
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program)!);
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, data);

      // An RGBA8 target (not the canvas), so nothing is premultiplied.
      const target = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.viewport(0, 0, W, H);
      gl.enable(gl.SCISSOR_TEST);
      // Bands, so no single draw runs long enough to trip a GPU watchdog.
      const pixels = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y += 64) {
        gl.scissor(0, y, W, 64);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, y, W, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels.subarray(y * W * 4));
      }
      let binary = '';
      for (let i = 0; i < pixels.length; i += 0x8000)
        binary += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    { fragment, W, H },
  );
  rgba = Buffer.from(base64, 'base64');
} finally {
  await browser.close();
}

// ── PNG (RGBA8, row 0 = v = 0: uploaded with flipY off) ───────────────────
function png(width: number, height: number, data: Buffer) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const prev = Buffer.alloc(stride);
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const up = y ? data.subarray((y - 1) * stride, y * stride) : prev;
    // Pick the filter with the smallest sum of absolute residuals per row.
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const outRow = candidates[f]!;
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? row[x - 4]! : 0;
        const b = up[x]!;
        const c = x >= 4 ? up[x - 4]! : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[x]! - pred) & 255;
        outRow[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    candidates[best]!.copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([len, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png(W, H, rgba));

// ── Grayscale planes (image row 0 = atlas row 0, like the PNG) ────────────
const planes = Buffer.alloc(W * 2 * H * 2);
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const k = (j * W + i) * 4;
    planes[j * W * 2 + i] = rgba[k]!; // r: top left
    planes[j * W * 2 + W + i] = rgba[k + 1]!; // g: top right
    planes[(j + H) * W * 2 + i] = rgba[k + 2]!; // b: bottom left
    planes[(j + H) * W * 2 + W + i] = rgba[k + 3]!; // a: bottom right
  }
}
execFileSync(
  'ffmpeg',
  [
    ...['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray'],
    ...['-s', `${W * 2}x${H * 2}`, '-i', '-'],
    ...['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', '6', '-cpu-used', '4'],
    ...['-pix_fmt', 'gray', '-color_range', 'pc', outPlanes],
  ],
  { input: planes },
);

const kb = (file: string) => `${(statSync(file).size / 1024).toFixed(0)} KB`;
console.log(`fissure atlas ${W}×${H}: ${kb(outPlanes)} (AVIF planes), ${kb(out)} (PNG fallback)`);
