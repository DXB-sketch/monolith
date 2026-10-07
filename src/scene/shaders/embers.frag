// Prepended in TS: precision, noise.glsl, atmosphere.glsl (for the palette).
varying float vLife;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(c));
  a *= a;
  // Hot as they leave the lava, cooling to ember red as they rise.
  vec3 color = mix(uLavaHot, uLava, smoothstep(0.0, 0.5, vLife));
  color = mix(color, uEmber, smoothstep(0.5, 1.0, vLife));
  float intensity = mix(7.0, 1.5, vLife);
  gl_FragColor = vec4(safeHdr(color * intensity), clamp(a * vAlpha, 0.0, 1.0));
  // Only active without post-processing (direct to screen); no-ops into render targets.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
