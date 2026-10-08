/**
 * The scene's later layers, in their own chunk so the first layer (sky, peaks,
 * stone: src/scene/index.ts) can start before this has downloaded:
 *   L2 terrain and fog · L3 lava and its glow · L4 embers · L5 post-processing
 */
import {
  HalfFloatType,
  Mesh,
  PlaneGeometry,
  Scene,
  UnsignedByteType,
  type Camera,
  type Material,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { Channel } from './channel';
import { createEmbers, type EmbersModule } from './embers';
import { createLava, type LavaModule } from './lava';
import type { TierSettings } from './quality';
import { createTerrain, type TerrainModule } from './terrain';
import { createCellsTexture } from './textures';
import type { SharedUniforms } from './uniforms';
import { BLOOM_INTENSITY, VIGNETTE_DARKNESS } from './look';
import { WashEffect } from './wash';
import { HeatEffect } from './heat';

export type { EmbersModule } from './embers';
export type { LavaModule } from './lava';
export type { TerrainModule } from './terrain';

export { createCellsTexture };

export function buildTerrain(
  shared: SharedUniforms,
  tier: TierSettings,
  channel: Channel,
  textures: { noise: Texture; cells: Texture },
): TerrainModule {
  return createTerrain(shared, tier, channel, textures);
}

export function buildLava(
  shared: SharedUniforms,
  tier: TierSettings,
  channel: Channel,
  textures: { noise: Texture; cells: Texture },
): LavaModule {
  return createLava(shared, channel, tier, textures);
}

export function buildEmbers(
  shared: SharedUniforms,
  tier: TierSettings,
  channel: Channel,
): EmbersModule {
  return createEmbers(shared, tier.embers, channel);
}

export interface PostChain {
  composer: EffectComposer;
  bloom: BloomEffect;
  vignette: VignetteEffect;
  wash: WashEffect;
  grain: NoiseEffect;
  /** Heat haze (High) and the page-change shimmer (High, Medium). */
  heat: HeatEffect;
  /** Whether this chain was built with the haze (High); Medium only shimmers. */
  hazeCapable: boolean;
  /** Scale bloom, vignette and grain together while the layer fades in. */
  fade: number;
  /** The render target the scene is drawn into (for compiling its programs). */
  inputBuffer: WebGLRenderTarget;
  /** Every post-processing material, for compiling ahead of the first use. */
  materials(): Material[];
  dispose(): void;
}

/** Every material reachable from the composer's passes and effects. */
function collectPostMaterials(composer: EffectComposer): Material[] {
  const found = new Set<Material>();
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 3) return;
    seen.add(value);
    if ((value as Material).isMaterial) {
      found.add(value as Material);
      return;
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else
      for (const key of Object.keys(value))
        visit((value as Record<string, unknown>)[key], depth + 1);
  };
  for (const pass of composer.passes) {
    // Build the merged effect shader now (normally deferred to the first render).
    // Protected in the typings, public at runtime.
    if (pass instanceof EffectPass)
      (pass as unknown as { updateMaterial(): void }).updateMaterial();
    visit(pass, 0);
  }
  return [...found];
}

/**
 * Heat (haze and the page-change shimmer, bending the UVs first), bloom
 * (selective by luminance on HDR buffers), vignette, ACES tone mapping, the
 * Chapter 04 wash and grain, merged into one effect pass (pmndrs/postprocessing).
 * High: 8 bloom levels and 4× MSAA. Medium ("light"): 5 levels at a lower
 * internal resolution, no MSAA.
 */
export function buildPost(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  tier: TierSettings,
  halfFloat: boolean,
  noise: Texture,
): PostChain {
  const composer = new EffectComposer(renderer, {
    frameBufferType: halfFloat ? HalfFloatType : UnsignedByteType,
    multisampling: tier.msaa,
  });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.6,
    luminanceSmoothing: 0.3,
    intensity: BLOOM_INTENSITY,
    radius: 0.75,
    levels: tier.bloomLevels,
    resolutionScale: tier.bloomResolution,
  });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: VIGNETTE_DARKNESS });
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const wash = new WashEffect();
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  // The haze is High's alone: Phase 2.5 measured no headroom on Medium for it.
  const hazeCapable = tier.post === 'full';
  const heat = new HeatEffect(noise, hazeCapable);
  heat.mask = bloom.texture;
  const effects = new EffectPass(camera, heat, bloom, vignette, toneMapping, wash, grain);
  if (!halfFloat) effects.dithering = true;
  composer.addPass(effects);

  return {
    composer,
    bloom,
    vignette,
    wash,
    grain,
    heat,
    hazeCapable,
    fade: 1,
    inputBuffer: composer.inputBuffer,
    materials: () => collectPostMaterials(composer),
    dispose: () => composer.dispose(),
  };
}

/** A scene of full-screen quads, one per material, so compileAsync can compile them. */
export function quadScene(materials: Material[]) {
  const quad = new PlaneGeometry(2, 2);
  const scene = new Scene();
  for (const material of materials) {
    const mesh = new Mesh(quad, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  return { scene, dispose: () => quad.dispose() };
}
