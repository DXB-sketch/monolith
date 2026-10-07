import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Channel } from './channel';
import { CORE_POINT_WORLD, FRONT_NORMAL_WORLD } from './dimensions';
import { terrainHeight } from './ground';
import type { SceneModule, SceneState } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';

/**
 * Lite has no bloom pass. A few soft additive sprites at the brightest points
 * (the core vein, the lava where it wraps the base of the stone) give back the
 * glow that bloom spreads around them on the other tiers.
 */
export interface GlowModule extends SceneModule {
  /** Pixels per world unit at distance 1 (same as the embers'). */
  setPointScale(scale: number): void;
  setFade(value: number): void;
}

const vertexShader = /* glsl */ `
attribute float aSize;
attribute float aKind;        // 0: core vein, 1: lava
uniform vec3 uFront;          // the front face's outward normal (world)
uniform float uPointScale;
uniform float uCoreOpen;
uniform float uFissureGain;
uniform float uLavaIntensity;
uniform float uLavaGlow;
uniform float uFade;
uniform float uTime;
varying float vKind;
varying float vStrength;

void main() {
  vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float pulse = 0.85 + 0.15 * sin(uTime * 0.52 + position.x * 3.0);
  float size = aSize;
  if (aKind < 0.5) {
    // Grows and brightens as the camera dives into the core vein.
    size *= 1.0 + uCoreOpen * 2.0;
    // Drawn without a depth test (the stone's own edges would clip it), so it
    // fades out as the front face turns away from the camera.
    float facing = smoothstep(0.05, 0.45, dot(normalize(cameraPosition - position), uFront));
    vStrength = (0.12 + 0.1 * uFissureGain + uCoreOpen * 0.9) * pulse * uFade * facing;
  } else {
    vStrength = 0.16 * uLavaIntensity * uLavaGlow * pulse;
  }
  vKind = aKind;
  gl_PointSize = min(size * uPointScale / max(-mv.z, 0.1), 1024.0);
}
`;

const fragmentShader = /* glsl */ `
varying float vKind;
varying float vStrength;

void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  // A wide, soft falloff: it should read as light in the air, never as a disc.
  float a = exp(-r * r * 3.5) * (1.0 - smoothstep(0.55, 1.0, r));
  vec3 color = vKind < 0.5 ? mix(uLava, uLavaHot, 0.35) : mix(uEmber, uLava, 0.6);
  gl_FragColor = vec4(safeHdr(color * a * vStrength), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createGlow(shared: SharedUniforms, channel: Channel): GlowModule {
  const positions: number[] = [];
  const sizes: number[] = [];
  const kinds: number[] = [];

  // The core vein: just off the front face, so the stone doesn't clip it.
  const core = CORE_POINT_WORLD.clone().addScaledVector(FRONT_NORMAL_WORLD, 0.35);
  positions.push(core.x, core.y, core.z);
  sizes.push(8);
  kinds.push(0);

  // The lava where it passes closest to the stone.
  const near = channel.samples.filter((s) => Math.hypot(s.x, s.z) < 10);
  const p = new Vector3();
  for (let i = 0; i < 5 && near.length; i++) {
    const s = near[Math.round((i / 4) * (near.length - 1))]!;
    p.set(s.x, terrainHeight(s.x, s.z) + 0.25, s.z);
    positions.push(p.x, p.y, p.z);
    sizes.push(5.5);
    kinds.push(1);
  }

  const uniforms = {
    ...shared,
    uFront: { value: FRONT_NORMAL_WORLD.clone() },
    uPointScale: { value: 800 },
    uCoreOpen: { value: 0 },
    uFissureGain: { value: 1 },
    uLavaIntensity: { value: 1 },
    uFade: { value: 1 },
  };
  const geometries: BufferGeometry[] = [];
  const materials: ShaderMaterial[] = [];
  const sprites = (from: number, to: number, depthTest: boolean, name: string) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions.slice(from * 3, to * 3)), 3),
    );
    geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes.slice(from, to)), 1));
    geometry.setAttribute('aKind', new BufferAttribute(new Float32Array(kinds.slice(from, to)), 1));
    const material = new ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: AdditiveBlending,
    });
    geometries.push(geometry);
    materials.push(material);
    const points = new Points(geometry, material);
    points.name = name;
    points.frustumCulled = false;
    points.renderOrder = 3;
    return points;
  };
  const points = new Group();
  points.name = 'glow';
  // The core vein's glow, and the lava's (occluded by the stone like any object).
  points.add(sprites(0, 1, false, 'glow'), sprites(1, kinds.length, true, 'glow'));

  return {
    object: points,
    setPointScale(scale) {
      uniforms.uPointScale.value = scale;
    },
    setFade(value) {
      uniforms.uFade.value = value;
    },
    update(state: SceneState) {
      uniforms.uCoreOpen.value = state.coreOpen;
      uniforms.uFissureGain.value = state.fissureGain;
      uniforms.uLavaIntensity.value = state.lavaIntensity;
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
