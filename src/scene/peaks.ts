import { BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial } from 'three';
import { createNoise2, rng } from './noise';
import type { TierSettings } from './quality';
import type { SceneModule } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/terrain.vert?raw';
import fragmentShader from './shaders/terrain.frag?raw';

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

/**
 * The distant volcanic plugs: part of the first layer (with the sky and the
 * stone), so the horizon reads before the ground has loaded.
 */
export function createPeaks(shared: SharedUniforms, tier: TierSettings): SceneModule {
  const geometry = buildPlugs();
  const defines: Record<string, number> = { PEAKS: 1 };
  if (tier.vertexFog) defines.VERTEX_FOG = 1;
  const material = new ShaderMaterial({
    uniforms: { ...shared, uFade: { value: 1 } },
    vertexShader: FRAGMENT_PRELUDE + vertexShader,
    fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
    defines,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'peaks';
  return {
    object: mesh,
    update() {},
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
