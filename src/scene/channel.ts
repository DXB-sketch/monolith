import { CatmullRomCurve3, Vector3, Vector4 } from 'three';
import { smoothstep } from './noise';

/**
 * The lava channel, as a polyline on the ground plane. It starts in the distant
 * peaks, meanders across the plain, wraps around the front of the monolith's
 * base and leaves toward the camera on the left: a leading line into the stone.
 */
const CONTROL_POINTS: [number, number][] = [
  [150, -560],
  [108, -420],
  [62, -305],
  [74, -205],
  [40, -132],
  [13, -82],
  [17, -42],
  [8.5, -15],
  [5.8, -4.5],
  [5.0, 3.2],
  [0.6, 6.6],
  [-5.6, 8.8],
  [-11.5, 15.5],
  [-16, 27],
  [-19.5, 44],
  [-24, 72],
];

export interface ChannelSample {
  x: number;
  z: number;
  /** Arc length from the source, metres. */
  s: number;
  /** Unit tangent on the ground plane. */
  tx: number;
  tz: number;
  /** Half-width of the molten channel, metres. */
  halfWidth: number;
}

export interface ChannelHit {
  distance: number;
  halfWidth: number;
}

export interface Channel {
  samples: ChannelSample[];
  length: number;
  /** Distance from a ground point to the channel centreline (capped at `maxDistance`). */
  query(x: number, z: number): ChannelHit;
  maxDistance: number;
  /** Points along the channel close to the monolith, used as light sources. */
  lightsNear(count: number, radius: number): Vector4[];
}

function halfWidthAt(x: number, z: number) {
  const r = Math.hypot(x, z);
  return 0.65 + 1.05 * (1 - smoothstep(10, 220, r));
}

export function createChannel(sampleCount = 900): Channel {
  const curve = new CatmullRomCurve3(
    CONTROL_POINTS.map(([x, z]) => new Vector3(x, 0, z)),
    false,
    'centripetal',
  );
  const pts = curve.getSpacedPoints(sampleCount);
  const length = curve.getLength();

  const samples: ChannelSample[] = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    return {
      x: p.x,
      z: p.z,
      s: (i / sampleCount) * length,
      tx: tx / tl,
      tz: tz / tl,
      halfWidth: halfWidthAt(p.x, p.z),
    };
  });

  // Uniform grid of segment indices, so terrain vertices only test nearby segments.
  const maxDistance = 40;
  const cell = 20;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const x0 = Math.floor((Math.min(a.x, b.x) - maxDistance) / cell);
    const x1 = Math.floor((Math.max(a.x, b.x) + maxDistance) / cell);
    const z0 = Math.floor((Math.min(a.z, b.z) - maxDistance) / cell);
    const z1 = Math.floor((Math.max(a.z, b.z) + maxDistance) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(i);
      }
    }
  }

  const query = (x: number, z: number): ChannelHit => {
    const list = grid.get(key(Math.floor(x / cell), Math.floor(z / cell)));
    let best = maxDistance;
    let halfWidth = 1;
    if (!list) return { distance: best, halfWidth };
    for (const i of list) {
      const a = samples[i]!;
      const b = samples[i + 1]!;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const t = Math.max(
        0,
        Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz || 1)),
      );
      const dx = x - (a.x + abx * t);
      const dz = z - (a.z + abz * t);
      const d = Math.hypot(dx, dz);
      if (d < best) {
        best = d;
        halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * t;
      }
    }
    return { distance: best, halfWidth };
  };

  const lightsNear = (count: number, radius: number) => {
    const near = samples.filter((p) => Math.hypot(p.x, p.z) < radius);
    if (!near.length) return [];
    return Array.from({ length: count }, (_, i) => {
      const p = near[Math.round((i / Math.max(1, count - 1)) * (near.length - 1))]!;
      return new Vector4(p.x, 0.4, p.z, p.halfWidth / 1.7);
    });
  };

  return { samples, length, query, maxDistance, lightsNear };
}
