/**
 * Small tiling textures that stand in for per-pixel noise on the baked tiers.
 * Generated on the CPU in a few milliseconds (no download, no decode):
 *
 * noise (256², RGBA): seamless gradient noise, 4 / 8 / 16 / 32 cycles per tile
 *   in r / g / b / a. Ground detail, the lava's warp and melt, horizon smoke.
 * cells (512², RGBA): a seamless Voronoi tiling of CELLS_PER_TILE² cells.
 *   r: distance to the cell border ((F2 − F1) / 2, in cell units, ×2);
 *   g: a random value per cell (how hot a crust plate is). Lava crust plates
 *   and the hot cracks in the channel banks.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { rng } from './noise';

export const NOISE_SIZE = 256;
export const CELLS_SIZE = 512;
export const CELLS_PER_TILE = 16;

function tilingTexture(data: Uint8Array, size: number) {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Periodic 2D gradient noise (Perlin-style), about −1..1. */
function periodicNoise(seed: number, period: number) {
  const random = rng(seed);
  const gx = new Float32Array(period * period);
  const gy = new Float32Array(period * period);
  for (let i = 0; i < period * period; i++) {
    const a = random() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const dot = (cx: number, cy: number, dx: number, dy: number) => {
      const k = (((cy % period) + period) % period) * period + (((cx % period) + period) % period);
      return gx[k]! * dx + gy[k]! * dy;
    };
    const u = fade(fx);
    const v = fade(fy);
    const a = dot(ix, iy, fx, fy);
    const b = dot(ix + 1, iy, fx - 1, fy);
    const c = dot(ix, iy + 1, fx, fy - 1);
    const d = dot(ix + 1, iy + 1, fx - 1, fy - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.6;
  };
}

export function createNoiseTexture() {
  const size = NOISE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const layers = [4, 8, 16, 32].map((period, i) => periodicNoise(101 + i, period));
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = (j * size + i) * 4;
      layers.forEach((noise, c) => {
        const period = 4 << c;
        const value = noise((i / size) * period, (j / size) * period);
        data[k + c] = Math.max(0, Math.min(255, Math.round((value * 0.5 + 0.5) * 255)));
      });
    }
  }
  return tilingTexture(data, size);
}

export function createCellsTexture() {
  const size = CELLS_SIZE;
  const n = CELLS_PER_TILE;
  const random = rng(77);
  // One feature point and one random value per cell.
  const px = new Float32Array(n * n);
  const py = new Float32Array(n * n);
  const heat = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    px[i] = random();
    py[i] = random();
    heat[i] = random();
  }
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const y = ((j + 0.5) / size) * n;
    const cy = Math.floor(y);
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * n;
      const cx = Math.floor(x);
      let f1 = 8;
      let f2 = 8;
      let id = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const k = (((gy % n) + n) % n) * n + (((gx % n) + n) % n);
          const dx = gx + px[k]! - x;
          const dy = gy + py[k]! - y;
          const d = dx * dx + dy * dy;
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = k;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      const border = 0.5 * (Math.sqrt(f2) - Math.sqrt(f1));
      const k = (j * size + i) * 4;
      data[k] = Math.min(255, Math.round(border * 2 * 255));
      data[k + 1] = Math.round(heat[id]! * 255);
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  }
  return tilingTexture(data, size);
}
