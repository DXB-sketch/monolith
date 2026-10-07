import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  Vector2,
} from 'three';
import type { Channel } from './channel';
import { rng } from './noise';
import { terrainHeight } from './ground';
import type { SceneModule, SceneState } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/embers.vert?raw';
import fragmentShader from './shaders/embers.frag?raw';

export interface EmbersModule extends SceneModule {
  /** Pixels per world unit at distance 1: viewport height / (2 tan(fov / 2)). */
  setPointScale(scale: number): void;
  /** Cap the live particle count (dropped as an optional extra under load). */
  setMaxCount(count: number): void;
  /** 0..1: the embers appear as the layer fades in. */
  setFade(value: number): void;
}

/**
 * GPU embers: every particle's whole life is computed in the vertex shader from
 * a spawn point and four random seeds, so the CPU never touches them per frame.
 */
export function createEmbers(
  shared: SharedUniforms,
  count: number,
  channel: Channel,
): EmbersModule {
  const random = rng(42);
  const spawn = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);

  const nearLava = channel.samples.filter((s) => Math.hypot(s.x, s.z) < 11);

  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    if (random() < 0.62 && nearLava.length) {
      // Rising off the lava surface near the stone.
      const s = nearLava[Math.floor(random() * nearLava.length)]!;
      const off = (random() * 2 - 1) * s.halfWidth;
      x = s.x - s.tz * off;
      z = s.z + s.tx * off;
    } else {
      // Rising from the ground at the base of the monolith.
      const a = random() * Math.PI * 2;
      const r = 2.2 + random() * 2.2;
      x = Math.cos(a) * r * 1.25;
      z = Math.sin(a) * r * 0.7;
    }
    spawn.set([x, terrainHeight(x, z) - 0.1, z], i * 3);
    seed.set([random(), random(), random(), random()], i * 4);
  }

  const geometry = new BufferGeometry();
  // `position` is required by three; the shader uses aSpawn.
  geometry.setAttribute('position', new BufferAttribute(spawn, 3));
  geometry.setAttribute('aSpawn', new BufferAttribute(spawn, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seed, 4));

  const uniforms = {
    ...shared,
    uDensity: { value: 1 },
    uFade: { value: 1 },
    uPointScale: { value: 800 },
    uWind: { value: new Vector2(0.18, -0.06) },
  };

  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geometry, material);
  points.name = 'embers';
  points.frustumCulled = false;
  points.renderOrder = 2;

  return {
    object: points,
    setPointScale(scale) {
      uniforms.uPointScale.value = scale;
    },
    setFade(value) {
      uniforms.uFade.value = value;
    },
    setMaxCount(max) {
      geometry.setDrawRange(0, Math.min(count, max));
    },
    update(state: SceneState) {
      uniforms.uDensity.value = state.emberDensity;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
