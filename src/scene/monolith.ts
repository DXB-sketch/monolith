import {
  BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Box3,
  type Texture,
} from 'three';
import { CORE_POINT_LOCAL, MONOLITH, MONOLITH_ROTATION } from './dimensions';
import { buildMonolithGeometry } from './monolith-geometry';
import type { TierSettings } from './quality';
import type { SceneModule, SceneState } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/monolith.vert?raw';
import fragmentShader from './shaders/monolith.frag?raw';
import fissureFieldGlsl from './shaders/fissure-field.glsl?raw';
import obsidianGlsl from './shaders/obsidian.glsl?raw';

export { MONOLITH } from './dimensions';

export const LAVA_LIGHT_COUNT = 6;

export interface MonolithModule extends SceneModule {
  mesh: Mesh;
  /** Local-space bounds, for pointer ray tests. */
  bounds: Box3;
  /** Fissure glow, 0..1: ignites from dark as the layer appears. */
  setFade(value: number): void;
  /** Baked tiers: the fissure atlas (null shows the flat-glow fallback). */
  setAtlas(texture: Texture | null, ready: number): void;
  /** Optional detail (hairline crazing on High). */
  setExtras(on: boolean): void;
}

/**
 * The lava channel's light on each vertex (the baked tiers' replacement for six
 * point lights): the same diffuse falloff, summed once at build time.
 */
function bakeLavaLight(mesh: Mesh, lights: Vector4[]) {
  const geometry = mesh.geometry;
  const pos = geometry.attributes.position as BufferAttribute;
  const normal = geometry.attributes.normal as BufferAttribute;
  const out = new Float32Array(pos.count);
  const p = new Vector3();
  const n = new Vector3();
  const toL = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normal, i).transformDirection(mesh.matrixWorld);
    let sum = 0;
    for (const light of lights) {
      toL.set(light.x - p.x, light.y - p.y, light.z - p.z);
      const d2 = toL.lengthSq();
      const nl = Math.max(0, n.dot(toL.normalize()));
      sum += (nl * light.w) / (1 + d2 * 0.12);
    }
    out[i] = sum;
  }
  geometry.setAttribute('aLavaLight', new BufferAttribute(out, 1));
}

export function createMonolith(
  shared: SharedUniforms,
  tier: TierSettings,
  lavaLights: Vector4[],
): MonolithModule {
  const geometry = buildMonolithGeometry(tier.monolithSegments);
  const baked = tier.bakedFissures;

  const lights = Array.from(
    { length: LAVA_LIGHT_COUNT },
    (_, i) => lavaLights[i]?.clone() ?? new Vector4(0, -100, 0, 0),
  );
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
    uFade: { value: 1 },
    uExtras: { value: 1 },
    uLavaLights: { value: lights },
    uAtlas: { value: null as Texture | null },
    uAtlasReady: { value: 0 },
  };

  const defines: Record<string, number> = baked
    ? { BAKED_FISSURES: 1 }
    : { FISSURE_OCTAVES: tier.fissureOctaves, LAVA_LIGHTS: LAVA_LIGHT_COUNT };
  if (baked && tier.vertexLighting) defines.VERTEX_LIGHTING = 1;
  if (tier.vertexFog) defines.VERTEX_FOG = 1;
  if (tier.fakeBloom) defines.FAKE_BLOOM = 1;

  // The baked tiers light (and fog) per vertex, so their vertex shader needs
  // the noise, atmosphere and obsidian chunks too.
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: baked ? FRAGMENT_PRELUDE + obsidianGlsl + vertexShader : vertexShader,
    fragmentShader: FRAGMENT_PRELUDE + (baked ? obsidianGlsl : fissureFieldGlsl) + fragmentShader,
    defines,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'monolith';
  mesh.position.y = -MONOLITH.sink;
  mesh.rotation.copy(MONOLITH_ROTATION);
  mesh.updateMatrixWorld(true);
  if (baked) bakeLavaLight(mesh, lights);

  return {
    object: mesh,
    mesh,
    bounds: geometry.boundingBox!.clone(),
    setFade(value) {
      uniforms.uFade.value = value;
    },
    setAtlas(texture, ready) {
      uniforms.uAtlas.value = texture;
      uniforms.uAtlasReady.value = texture ? ready : 0;
    },
    setExtras(on) {
      uniforms.uExtras.value = on ? 1 : 0;
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
