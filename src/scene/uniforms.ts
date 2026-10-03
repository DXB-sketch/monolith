import { Vector3, type IUniform } from 'three';
import { createPalette } from './palette';
import noiseGlsl from './shaders/noise.glsl?raw';
import atmosphereGlsl from './shaders/atmosphere.glsl?raw';

export type Uniforms = Record<string, IUniform>;

/**
 * Uniforms shared by every material: palette colours, time, the afterglow
 * direction and fog. Materials spread this object into their own uniforms, so
 * each entry is the same `{ value }` reference everywhere and one write updates
 * the whole scene.
 */
export function createSharedUniforms() {
  const palette = createPalette();
  return {
    uBasalt: { value: palette.basalt },
    uObsidian: { value: palette.obsidian },
    uObsidianEdge: { value: palette.obsidianEdge },
    uMagma: { value: palette.magma },
    uLava: { value: palette.lava },
    uLavaHot: { value: palette.lavaHot },
    uEmber: { value: palette.ember },
    uAsh: { value: palette.ash },
    uBone: { value: palette.bone },
    // Afterglow sits low on the horizon, behind the monolith and a little left.
    uSunDir: { value: new Vector3(-0.42, 0.07, -1).normalize() },
    uTime: { value: 0 },
    uFogDensity: { value: 0.0019 },
    uGlow: { value: 1 },
  } satisfies Uniforms;
}

export type SharedUniforms = ReturnType<typeof createSharedUniforms>;

/** Fragment header: precision, shared noise and atmosphere chunks. */
export const FRAGMENT_PRELUDE = `precision highp float;\n${noiseGlsl}\n${atmosphereGlsl}\n`;
/** Vertex shaders that need noise but not the atmosphere uniforms. */
export const NOISE_GLSL = noiseGlsl;
