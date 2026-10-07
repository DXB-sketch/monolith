import {
  BackSide,
  DoubleSide,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
} from 'three';
import type { TierSettings } from './quality';
import type { SceneModule } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/sky.vert?raw';
import fragmentShader from './shaders/sky.frag?raw';

export const SKY_RADIUS = 2400;

export interface SkyModule extends SceneModule {
  /** Optional detail: the full multi-octave horizon smoke. */
  setExtras(on: boolean): void;
}

/**
 * Lite's dome: the gradient is computed per vertex, so its rings crowd toward
 * the horizon, where the ember band is only a couple of degrees tall.
 */
function liteDome() {
  const segments = 64;
  // Elevation angles: dense near 0, sparse overhead and below.
  const rings: number[] = [];
  for (let i = -6; i <= 0; i++) rings.push((i / 6) ** 2 * -0.5 * Math.PI);
  for (let i = 1; i <= 28; i++) rings.push(((i / 28) ** 2.4 * Math.PI) / 2);
  const positions: number[] = [];
  for (const elevation of rings) {
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const c = Math.cos(elevation);
      positions.push(
        c * Math.cos(a) * SKY_RADIUS,
        Math.sin(elevation) * SKY_RADIUS,
        c * Math.sin(a) * SKY_RADIUS,
      );
    }
  }
  const index: number[] = [];
  const row = segments + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);
  return geometry;
}

export function createSky(shared: SharedUniforms, tier: TierSettings, noise: Texture): SkyModule {
  const geometry = tier.liteSky ? liteDome() : new SphereGeometry(SKY_RADIUS, 48, 24);
  const uniforms = { ...shared, uExtras: { value: 1 }, uNoise: { value: noise } };
  const defines: Record<string, number> = tier.liteSky ? { LITE_SKY: 1 } : {};
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: FRAGMENT_PRELUDE + vertexShader,
    fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
    defines,
    // The Lite dome's winding isn't guaranteed: draw both sides (it costs nothing).
    side: tier.liteSky ? DoubleSide : BackSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'sky';
  // Drawn after the opaque scene (it sits on the far plane), so the depth test
  // skips every pixel the ground, peaks or stone already cover.
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;

  return {
    object: mesh,
    setExtras(on) {
      uniforms.uExtras.value = on ? 1 : 0;
    },
    update() {},
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
