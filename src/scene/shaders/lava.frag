// Lava channel: dark cooled crust plates drifting on a molten flow.
// Not cartoon lava: most of the surface is crust; the light is in the seams.
// Prepended in TS: precision, noise.glsl, atmosphere.glsl.

uniform float uLavaIntensity;

varying vec2 vUv;          // x: metres along the channel, y: -1..1 across (beyond 1 under banks)
varying float vHalfWidth;
varying vec3 vWorldPos;

void main() {
  float t = uTime;
  float across = abs(vUv.y);
  float centre = 1.0 - smoothstep(0.0, 1.0, across);

  // Flow runs faster in the middle of the channel than at its banks.
  float speed = 0.5 * (0.35 + 0.65 * centre);
  vec2 fp = vec2(vUv.x - t * speed, vUv.y * vHalfWidth);
  fp += vec2(snoise(vec3(fp * 0.3, t * 0.04)), snoise(vec3(fp * 0.3 + 7.0, t * 0.04))) * 0.55;

  vec4 cells = voronoi2(fp * 0.95);

  // Molten seams between plates: thin at the banks, opening up toward the centre.
  float seam = mix(0.02, 0.17, centre);
  float aa = fwidth(cells.y) + 1e-4;
  float molten = 1.0 - smoothstep(seam, seam + aa * 1.5, cells.y);

  // Some plates in the hot centre are half melted.
  float plateHeat = hash12(cells.zw);
  float melt = smoothstep(0.62, 1.05,
    centre * 0.85 + plateHeat * 0.3 + 0.18 * snoise(vec3(fp * 0.25, t * 0.08)));
  molten = max(molten, melt * 0.8);

  // Solid, cooled crust at and beyond the banks.
  molten *= 1.0 - smoothstep(0.82, 1.05, across);

  // In the distance the cells shrink below a pixel: settle to an average glow.
  float lod = smoothstep(0.25, 1.2, fwidth(fp.x));
  molten = mix(molten, 0.3 * centre + 0.05, lod);

  float pulse = 0.65 + 0.35 * snoise(vec3(fp * vec2(0.18, 0.5), t * 0.15));
  vec3 hot = mix(uLava, uLavaHot, smoothstep(0.35, 1.0, molten * pulse));
  vec3 crust = mix(uBasalt, uObsidianEdge, 0.4 + 0.3 * plateHeat) * 0.7;
  // Plates still carry heat from below, strongest near the seams.
  crust += uMagma * (0.25 + 0.6 * exp(-cells.y * 12.0)) * centre;

  vec3 color = mix(crust, hot * (1.5 + 2.6 * pulse) * uLavaIntensity, molten);
  gl_FragColor = vec4(safeHdr(applyFog(color, vWorldPos)), 1.0);
  // Only active without post-processing (direct to screen); no-ops into render targets.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
