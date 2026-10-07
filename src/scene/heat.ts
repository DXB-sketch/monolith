import { Effect } from 'postprocessing';
import { Uniform, Vector2, type Texture } from 'three';

/**
 * Heat in the air (Phase 4), one effect in the merged pass that bends the
 * screen's UVs before anything is sampled:
 *
 * - Haze (High only, SCENE_SPEC.md): a slow shimmer above hot things. The mask
 *   is the bloom texture read a little *below* each pixel, so the air above the
 *   lava channel and behind the burning stone moves, while the cool ground and
 *   the dark sky stay still. A scrolling noise tile drives the distortion.
 * - Shimmer (High and Medium): a brief, unmasked ripple of the whole view
 *   during a page change. Zero the rest of the time, and then skipped.
 *
 * Everything is in one branch on uniforms, so with neither active the cost is
 * one mask fetch (High) or nothing (Medium, compiled without the haze).
 */
const fragmentShader = /* glsl */ `
uniform sampler2D tHeatMask;
uniform sampler2D tHeatNoise;
uniform float uHeatTime;
uniform float uHaze;
uniform float uShimmer;
uniform vec2 uHeatAspect;

void mainUv(inout vec2 uv) {
  float amount = uShimmer * 0.011;
#if HAZE
  if (uHaze > 0.0) {
    // Heat rises: what is hot just below this pixel bends the air here.
    vec3 below = texture2D(tHeatMask, uv - vec2(0.0, 0.05)).rgb;
    float heat = dot(below, vec3(0.3, 0.59, 0.11));
    amount += smoothstep(0.015, 0.35, heat) * uHaze * 0.0032;
  }
#endif
  if (amount > 0.00002) {
    vec2 p = vec2(uv.x * uHeatAspect.x, uv.y) * 2.2;
    vec2 a = texture2D(tHeatNoise, p + vec2(0.0, -uHeatTime * 0.16)).gb - 0.5;
    vec2 b = texture2D(tHeatNoise, p * 2.3 + vec2(uHeatTime * 0.03, -uHeatTime * 0.41)).ba - 0.5;
    uv += (a + b * 0.6) * amount;
  }
}
`;

export class HeatEffect extends Effect {
  constructor(noise: Texture, haze: boolean) {
    super('HeatEffect', fragmentShader, {
      defines: new Map([['HAZE', haze ? '1' : '0']]),
      uniforms: new Map<string, Uniform>([
        ['tHeatMask', new Uniform(null)],
        ['tHeatNoise', new Uniform(noise)],
        ['uHeatTime', new Uniform(0)],
        ['uHaze', new Uniform(haze ? 1 : 0)],
        ['uShimmer', new Uniform(0)],
        ['uHeatAspect', new Uniform(new Vector2(1, 1))],
      ]),
    });
  }

  /** The bloom result, as the heat mask (set once the bloom effect exists). */
  set mask(texture: Texture | null) {
    this.uniforms.get('tHeatMask')!.value = texture;
  }

  set time(value: number) {
    this.uniforms.get('uHeatTime')!.value = value;
  }

  get haze(): number {
    return this.uniforms.get('uHaze')!.value as number;
  }

  set haze(value: number) {
    this.uniforms.get('uHaze')!.value = value;
  }

  set shimmer(value: number) {
    this.uniforms.get('uShimmer')!.value = value;
  }

  override setSize(width: number, height: number) {
    (this.uniforms.get('uHeatAspect')!.value as Vector2).set(width / Math.max(1, height), 1);
  }
}
