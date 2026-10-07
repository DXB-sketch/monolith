/**
 * The monolith's shape and the fissure atlas layout. Shader-free and
 * Three.js-light, so the build-time bake (scripts/bake-fissures.ts) evaluates
 * exactly the same surface the mesh is built from.
 *
 * Every vertex keeps its undisplaced box coordinate as its atlas address, so
 * the atlas follows the stone through the taper, bulges and chips.
 */
import { BoxGeometry, BufferAttribute } from 'three';
import { MONOLITH } from './dimensions';
import { createNoise2, smoothstep } from './noise';

const { width: W, height: H, depth: D } = MONOLITH;

const n1 = createNoise2(7);
const n2 = createNoise2(19);
const n3 = createNoise2(31);

/**
 * Rough-hewn slab: tapered, faintly bulging faces, chipped edges. Takes a point
 * on the undisplaced box (base at y = 0) and returns the displaced point.
 * Offsets depend on position only, so the duplicated vertices along box seams
 * move together and never split.
 */
export function displace(
  x0: number,
  y0: number,
  z0: number,
  out: [number, number, number] = [0, 0, 0],
) {
  let x = x0;
  let y = y0;
  let z = z0;
  const hx = Math.abs(x) / (W / 2);
  const hz = Math.abs(z) / (D / 2);
  const sx = Math.sign(x) || 1;
  const sz = Math.sign(z) || 1;

  // Faces bulge and dip a few centimetres.
  const bulgeX = n1(y * 0.22, z * 0.5 + 3) * 0.05 + n2(y * 0.9, z * 1.4) * 0.012;
  const bulgeZ = n1(y * 0.22 + 9, x * 0.4) * 0.04 + n2(y * 0.9 + 4, x * 1.2) * 0.01;
  x += sx * bulgeX * hx;
  z += sz * bulgeZ * hz;

  // Chipped vertical edges: bite inward where both x and z are near the edge.
  const vEdge = smoothstep(0.86, 1, hx) * smoothstep(0.72, 1, hz);
  const chip = Math.max(0, n3(y * 0.6 + sx * 13 + sz * 29, 0.5)) * 0.12 + 0.02;
  x -= sx * chip * vEdge * 0.7;
  z -= sz * chip * vEdge;

  // Chipped top edges, and a slightly uneven crown.
  const top = smoothstep(H - 0.5, H, y);
  const crownEdge = Math.max(smoothstep(0.8, 1, hx), smoothstep(0.6, 1, hz));
  const crownChip = Math.max(0, n3(x * 0.9 + 40, z * 0.9)) * 0.35 + 0.04;
  y -= top * crownEdge * crownChip;
  y += top * n2(x * 0.35, z * 0.35 + 70) * 0.12;

  // Taper toward the top.
  x *= 1 - 0.075 * (y / H);
  z *= 1 - 0.05 * (y / H);

  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

// ── Fissure atlas layout ─────────────────────────────────────────────────
//
// 1024 × 2048 texels. Two rows, each the full height of the stone:
//   top row:    front (+z) | left (−x)
//   bottom row: back (−z)  | right (+x)
// The faces get 128 texels per metre across (veins run mostly vertically, so
// across-vein resolution matters most) and 64 per metre up. The crown (and the
// buried base) sits in a narrow column on the right. Each region has a gutter
// of extrapolated field, so mipmaps never blend one face into another.

export const ATLAS_WIDTH = 1024;
export const ATLAS_HEIGHT = 2048;
/** Gutter around each region, texels. */
export const ATLAS_GUTTER = 6;

const FACE_COLUMNS = 960 / ATLAS_WIDTH;
const WIDE = (FACE_COLUMNS * W) / (W + D);

export type AtlasFace = 'front' | 'left' | 'back' | 'right' | 'crown';

/** Atlas rectangle of each region (u0, v0, u1, v1), before gutters. */
export const ATLAS_REGIONS: Record<AtlasFace, [number, number, number, number]> = {
  front: [0, 0.5, WIDE, 1],
  left: [WIDE, 0.5, FACE_COLUMNS, 1],
  back: [0, 0, WIDE, 0.5],
  right: [WIDE, 0, FACE_COLUMNS, 0.5],
  crown: [FACE_COLUMNS, 0, 1, 1],
};

/** Region rectangle shrunk by the gutter. */
function inner(face: AtlasFace): [number, number, number, number] {
  const [u0, v0, u1, v1] = ATLAS_REGIONS[face];
  const gu = ATLAS_GUTTER / ATLAS_WIDTH;
  const gv = ATLAS_GUTTER / ATLAS_HEIGHT;
  return [u0 + gu, v0 + gv, u1 - gu, v1 - gv];
}

/**
 * Face-local parameters (s, t in 0..1) for an undisplaced box point.
 * s runs across the face as seen from outside it, t runs up the stone.
 */
function faceParams(face: AtlasFace, x: number, y: number, z: number): [number, number] {
  switch (face) {
    case 'front':
      return [(x + W / 2) / W, y / H];
    case 'back':
      return [(W / 2 - x) / W, y / H];
    case 'left':
      return [(z + D / 2) / D, y / H];
    case 'right':
      return [(D / 2 - z) / D, y / H];
    case 'crown':
      return [(z + D / 2) / D, (x + W / 2) / W];
  }
}

/** Atlas UV of an undisplaced box point on a face. */
export function atlasUv(face: AtlasFace, x: number, y: number, z: number): [number, number] {
  const [s, t] = faceParams(face, x, y, z);
  const [u0, v0, u1, v1] = inner(face);
  return [u0 + s * (u1 - u0), v0 + t * (v1 - v0)];
}

/**
 * The inverse, for the bake: the undisplaced box point at an atlas UV, or null
 * outside every region. Inside a gutter the face parameters run past 0..1, so
 * the field extends smoothly beyond the face edge.
 */
export function atlasPoint(u: number, v: number): [AtlasFace, number, number, number] | null {
  for (const face of Object.keys(ATLAS_REGIONS) as AtlasFace[]) {
    const [r0, q0, r1, q1] = ATLAS_REGIONS[face];
    if (u < r0 || u >= r1 || v < q0 || v >= q1) continue;
    const [u0, v0, u1, v1] = inner(face);
    const s = (u - u0) / (u1 - u0);
    const t = (v - v0) / (v1 - v0);
    switch (face) {
      case 'front':
        return [face, s * W - W / 2, t * H, D / 2];
      case 'back':
        return [face, W / 2 - s * W, t * H, -D / 2];
      case 'left':
        return [face, -W / 2, t * H, s * D - D / 2];
      case 'right':
        return [face, W / 2, t * H, D / 2 - s * D];
      case 'crown':
        return [face, t * W - W / 2, H, s * D - D / 2];
    }
  }
  return null;
}

/** Which atlas region a box face (by its axis-aligned normal) uses. */
function faceOf(nx: number, ny: number, nz: number): AtlasFace {
  if (nz > 0.5) return 'front';
  if (nz < -0.5) return 'back';
  if (nx < -0.5) return 'left';
  if (nx > 0.5) return 'right';
  // Crown, and the buried base (never seen) shares it.
  void ny;
  return 'crown';
}

/**
 * The monolith mesh geometry: displaced box plus `aAtlas` (fissure atlas UV)
 * on every vertex.
 */
export function buildMonolithGeometry(segments: [number, number, number]) {
  const geometry = new BoxGeometry(W, H, D, ...segments);
  geometry.translate(0, H / 2, 0);
  const pos = geometry.attributes.position as BufferAttribute;
  const normal = geometry.attributes.normal as BufferAttribute;
  const atlas = new Float32Array(pos.count * 2);
  const out: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);
    const face = faceOf(normal.getX(i), normal.getY(i), normal.getZ(i));
    const [u, v] = atlasUv(face, x0, y0, z0);
    atlas[i * 2] = u;
    atlas[i * 2 + 1] = v;
    displace(x0, y0, z0, out);
    pos.setXYZ(i, out[0], out[1], out[2]);
  }

  geometry.setAttribute('aAtlas', new BufferAttribute(atlas, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
