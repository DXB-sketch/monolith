import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShaderMaterial,
} from 'three';
import type { Channel } from './channel';
import { createNoise2, fbm, ridged, rng, smoothstep } from './noise';
import type { TierSettings } from './quality';
import type { SceneModule } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/terrain.vert?raw';
import fragmentShader from './shaders/terrain.frag?raw';

const nLumps = createNoise2(3);
const nFine = createNoise2(5);
const nRoll = createNoise2(11);
const nRidge = createNoise2(23);

/** Depth the channel is carved into the ground, metres. */
export const CHANNEL_DEPTH = 0.65;

/**
 * Ground height before the channel is carved. Flat around the monolith and the
 * camera's sightline, rising into low basalt ridges toward the horizon.
 */
export function terrainHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const lumps = fbm(nLumps, x * 0.11, z * 0.11, 4) * 0.35 + fbm(nFine, x * 0.5, z * 0.5, 2) * 0.06;
  const rolling = fbm(nRoll, x * 0.018, z * 0.018, 4) * 5 * smoothstep(12, 80, r);
  const ridges = ridged(nRidge, x * 0.008 + 3, z * 0.008 - 2, 5) * 16 * smoothstep(70, 280, r);
  const far = ridged(nRidge, x * 0.0035 + 9, z * 0.0035, 4) * 38 * smoothstep(300, 750, r);
  let h = lumps + rolling + ridges + far;

  // Keep the foreground and the camera's line of sight low.
  const front = smoothstep(-25, 12, z) * (1 - smoothstep(35, 90, Math.abs(x)));
  h *= 1 - front * 0.8;
  // A level pad around the base of the stone.
  h *= smoothstep(3.5, 10, r) * 0.85 + 0.15;
  return h;
}

/**
 * Grid denser near the monolith: u in [-1, 1] maps with a power curve. The linear
 * term keeps a minimum spacing; without it the cells at u = 0 collapse to
 * millimetres, the triangles degenerate and their normals become NaN.
 */
function axis(u: number, negExtent: number, posExtent: number) {
  const a = Math.abs(u);
  const m = 0.06 * a + 0.94 * a ** 2.2;
  return u < 0 ? -m * negExtent : m * posExtent;
}

function buildGround(segments: number, channel: Channel) {
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const lava = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = axis((j / segments) * 2 - 1, 1100, 220);
    for (let i = 0; i < n; i++) {
      const x = axis((i / segments) * 2 - 1, 1100, 1100);
      const hit = channel.query(x, z);
      let y = terrainHeight(x, z);
      // Carve the channel: a soft-sided trough under the lava ribbon.
      y -= CHANNEL_DEPTH * (1 - smoothstep(hit.halfWidth * 0.6, hit.halfWidth * 1.7, hit.distance));
      const k = j * n + i;
      positions.set([x, y, z], k * 3);
      // Distance to the molten surface edge, for the glow term in the shader.
      lava[k] = Math.max(0, hit.distance - hit.halfWidth * 0.8);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aLava', new BufferAttribute(lava, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

interface PlugSpec {
  x: number;
  z: number;
  radius: number;
  height: number;
  /** Horizontal drift of the summit, for crooked necks like Coonowrin. */
  lean: [number, number];
  seed: number;
}

/**
 * Distant volcanic plugs, after the Glasshouse Mountains: steep, knuckled domes
 * and one crooked spire, dark against the afterglow.
 */
const PLUGS: PlugSpec[] = [
  { x: -215, z: -790, radius: 46, height: 58, lean: [6, 0], seed: 7 },
  // Broad steep dome with a sheer face (after Beerwah).
  { x: -120, z: -830, radius: 66, height: 118, lean: [8, 0], seed: 1 },
  // The crooked neck (after Coonowrin).
  { x: -20, z: -880, radius: 30, height: 126, lean: [13, -3], seed: 2 },
  { x: 120, z: -960, radius: 44, height: 64, lean: [-6, 0], seed: 3 },
  // Knuckled plug (after Tibrogargan).
  { x: 330, z: -790, radius: 58, height: 92, lean: [-10, 4], seed: 4 },
  { x: 470, z: -860, radius: 38, height: 58, lean: [6, 0], seed: 5 },
  { x: 600, z: -760, radius: 80, height: 46, lean: [0, 0], seed: 6 },
];

function buildPlugs() {
  const radial = 48;
  const rings = 28;
  const positions: number[] = [];
  const index: number[] = [];
  for (const plug of PLUGS) {
    const noise = createNoise2(100 + plug.seed);
    const random = rng(plug.seed);
    const knuckle = 0.8 + random() * 0.6;
    const base = positions.length / 3;
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      // Steep sides and a rounded crown; extends below ground to hide the base.
      const u = Math.min(1, t);
      const profile =
        Math.pow(1 - u, 0.32) * (1 - Math.pow(u, 6 * knuckle)) * 0.82 + 0.18 * Math.pow(1 - u, 3);
      const y = -25 + t * (plug.height + 25);
      const cx = plug.x + plug.lean[0] * t * t;
      const cz = plug.z + plug.lean[1] * t * t;
      for (let i = 0; i < radial; i++) {
        const a = (i / radial) * Math.PI * 2;
        const wobble =
          1 +
          noise(Math.cos(a) * 1.2 + t * 1.6, Math.sin(a) * 1.2) * 0.2 +
          noise(Math.cos(a) * 5 + t * 3, Math.sin(a) * 5 + 9) * 0.07 +
          // Vertical fluting on the cliff walls.
          Math.abs(noise(Math.cos(a) * 11, Math.sin(a) * 11 + t * 0.6)) * 0.08;
        const r = plug.radius * Math.max(profile, 0.015) * wobble;
        positions.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < radial; i++) {
        const a = base + j * radial + i;
        const b = base + j * radial + ((i + 1) % radial);
        const c = a + radial;
        const d = b + radial;
        index.push(a, b, c, b, d, c);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    'aLava',
    new Float32BufferAttribute(new Float32Array(positions.length / 3).fill(1000), 1),
  );
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createTerrain(
  shared: SharedUniforms,
  tier: TierSettings,
  channel: Channel,
): SceneModule {
  const groundGeometry = buildGround(tier.terrainSegments, channel);
  const plugGeometry = buildPlugs();

  const makeMaterial = (peaks: boolean) =>
    new ShaderMaterial({
      uniforms: { ...shared },
      vertexShader,
      fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
      defines: peaks ? { PEAKS: 1 } : {},
    });
  const groundMaterial = makeMaterial(false);
  const plugMaterial = makeMaterial(true);

  const group = new Group();
  group.name = 'terrain';
  const ground = new Mesh(groundGeometry, groundMaterial);
  const plugs = new Mesh(plugGeometry, plugMaterial);
  group.add(ground, plugs);

  return {
    object: group,
    update() {},
    dispose() {
      groundGeometry.dispose();
      plugGeometry.dispose();
      groundMaterial.dispose();
      plugMaterial.dispose();
    },
  };
}
