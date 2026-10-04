import { Effect } from 'postprocessing';
import { Color, Uniform } from 'three';

const fragmentShader = /* glsl */ `
uniform float uWash;
uniform vec3 uWashColor;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(mix(inputColor.rgb, uWashColor, uWash), inputColor.a);
}
`;

/**
 * Chapter 04's colour wash: the screen floods with molten light as the camera
 * enters the core fissure, then cools through magma to basalt. It runs after
 * tone mapping in the merged effect pass, so a full wash is exactly the palette
 * colour. Basalt at the end matches the plain section's background with no seam.
 */
export class WashEffect extends Effect {
  constructor() {
    super('WashEffect', fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ['uWash', new Uniform(0)],
        ['uWashColor', new Uniform(new Color())],
      ]),
    });
  }

  get amount(): number {
    return this.uniforms.get('uWash')!.value as number;
  }

  set amount(value: number) {
    this.uniforms.get('uWash')!.value = value;
  }

  get color(): Color {
    return this.uniforms.get('uWashColor')!.value as Color;
  }
}
