import {
  BoxGeometry,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector4,
  Box3,
  type BufferAttribute,
} from 'three';
import { CORE_POINT_LOCAL, MONOLITH, MONOLITH_ROTATION } from './dimensions';
import { createNoise2, smoothstep } from './noise';
import type { TierSettings } from './quality';
import type { SceneModule, SceneState } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/monolith.vert?raw';
import fragmentShader from './shaders/monolith.frag?raw';

export { MONOLITH } from './dimensions';

export const LAVA_LIGHT_COUNT = 6;

export interface MonolithModule extends SceneModule {
  mesh: Mesh;
  /** Local-space bounds, for pointer ray tests. */
  bounds: Box3;
  setLavaLights(lights: Vector4[]): void;
}

/** Rough-hewn slab: tapered, faintly bulging faces, chipped edges. */
function buildGeometry(segments: [number, number, number]) {
  const { width: W, height: H, depth: D } = MONOLITH;
  const geometry = new BoxGeometry(W, H, D, ...segments);
  geometry.translate(0, H / 2, 0);

  const n1 = createNoise2(7);
  const n2 = createNoise2(19);
  const n3 = createNoise2(31);
  const pos = geometry.attributes.position as BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const hx = Math.abs(x) / (W / 2);
    const hz = Math.abs(z) / (D / 2);
    const sx = Math.sign(x) || 1;
    const sz = Math.sign(z) || 1;

    // Faces bulge and dip a few centimetres. Offsets depend on position only, so
    // the duplicated vertices along box seams move together and never split.
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
    const taper = 1 - 0.075 * (y / H);
    x *= taper;
    z *= 1 - 0.05 * (y / H);

    pos.setXYZ(i, x, y, z);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createMonolith(shared: SharedUniforms, tier: TierSettings): MonolithModule {
  const geometry = buildGeometry(tier.monolithSegments);

  const lavaLights = Array.from({ length: LAVA_LIGHT_COUNT }, () => new Vector4(0, -100, 0, 0));
  const uniforms = {
    ...shared,
    uFaceHeat: { value: new Vector4() },
    uPointer: { value: new Vector3(0, -100, 0) },
    uPointerHeat: { value: 0 },
    uPointerRadius: { value: 3.2 },
    uFissureGain: { value: 1 },
    uHeight: { value: MONOLITH.height },
    uCorePoint: { value: CORE_POINT_LOCAL.clone() },
    uCoreOpen: { value: 0 },
    uLavaLights: { value: lavaLights },
  };

  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
    defines: {
      FISSURE_OCTAVES: tier.fissureOctaves,
      LAVA_LIGHTS: LAVA_LIGHT_COUNT,
    },
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'monolith';
  mesh.position.y = -MONOLITH.sink;
  mesh.rotation.copy(MONOLITH_ROTATION);
  mesh.updateMatrixWorld(true);

  return {
    object: mesh,
    mesh,
    bounds: geometry.boundingBox!.clone(),
    setLavaLights(lights) {
      lights.slice(0, LAVA_LIGHT_COUNT).forEach((light, i) => lavaLights[i]!.copy(light));
    },
    update(state: SceneState) {
      uniforms.uFaceHeat.value.copy(state.faceHeat);
      uniforms.uPointer.value.copy(state.pointerPoint);
      uniforms.uPointerHeat.value = state.pointerHeat;
      uniforms.uFissureGain.value = state.fissureGain;
      uniforms.uCoreOpen.value = state.coreOpen;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Inverse world matrix helper for pointer tests in the monolith's local space. */
export function toLocal(mesh: Mesh, out = new Matrix4()) {
  return out.copy(mesh.matrixWorld).invert();
}
