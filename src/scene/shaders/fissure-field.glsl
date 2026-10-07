// ── Fissure field ─────────────────────────────────────────────────────────
// The raw fields behind the monolith's magma veins, at an object-space point,
// before heat is applied. Shared by the High shader (evaluated per pixel) and
// the build-time atlas bake (scripts/bake-fissures.ts), so the baked tiers
// show exactly the same veins.
// Needs noise.glsl.

const float FISSURE_S1 = 0.34; // main vein cell scale
const float FISSURE_S2 = 1.25; // branch cell scale
const float FISSURE_S3 = 3.6;  // hairline crazing cell scale

// Domain-warped, vertically stretched coordinates the veins are cut in.
vec3 fissureWarp(vec3 p) {
  // Stretch vertically so the veins mostly run up and down the slab.
  vec3 sp = p * vec3(1.0, 0.6, 1.0);
  vec3 warp = vec3(snoise(sp * 0.3), snoise(sp * 0.3 + 19.1), snoise(sp * 0.3 + 41.7));
  vec3 q = sp + warp * 0.75;
  // Fine jitter makes the lines jagged, like rock rather than cells.
  q += vec3(snoise(p * 2.7), snoise(p * 2.7 + 7.3), snoise(p * 2.7 + 13.9)) * 0.04;
  return q;
}

// Distance (m) to the nearest main vein: exact Voronoi borders.
float fissureMainDistance(vec3 q) {
  return voronoiBorder3(q * FISSURE_S1 + 3.1) / FISSURE_S1;
}

// Low-frequency region noise: only a few veins survive where it is high.
float fissureRegion(vec3 p) {
  return snoise(p * vec3(0.17, 0.085, 0.17) + vec3(4.2, 1.3, 7.7));
}

// Breaks and brightness changes along each vein (0..1).
float fissureAlong(vec3 p) {
  return smoothstep(-0.65, -0.15, snoise(p * vec3(0.8, 0.5, 0.8) + 23.0));
}

// Main vein half-width (m), before heat.
float fissureWidth(vec3 p) {
  return mix(0.006, 0.04, smoothstep(-0.5, 0.9, snoise(p * 0.6 + 5.0)));
}

// Distance (m) to the nearest branch crack.
float fissureBranchDistance(vec3 q) {
  return voronoiEdge3(q * FISSURE_S2 + 11.0) / FISSURE_S2;
}

// Where branches may grow (0..1), before the near-main-vein mask.
float fissureBranchGate(vec3 p) {
  return smoothstep(-0.1, 0.5, snoise(p * 1.4 + 3.3));
}

// Distance (m) to the hairline crazing (High only).
float fissureCrazeDistance(vec3 q) {
  return voronoiEdge3(q * FISSURE_S3 + 29.0) / FISSURE_S3;
}

// Pulse phase, radians: neighbouring veins beat out of step.
float fissurePhase(vec3 p) {
  return snoise(p * 0.18 + 2.0) * 6.2831;
}
