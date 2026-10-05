// Dusk sky: basalt overhead, warm charcoal, magma, and an ember band at the
// horizon. Low-contrast drifting smoke near the horizon; a few faint stars.
// Prepended in TS: precision, noise.glsl, atmosphere.glsl.

varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  vec3 color = skyColor(dir);
  float h = max(dir.y, 0.0);

  // Smoke and ash: noise projected onto a plane above the horizon, drifting.
  vec2 plane = dir.xz / (h + 0.07);
  float drift = uTime * 0.006;
  float smoke = fbm3(vec3(plane * vec2(0.22, 0.5) + vec2(drift, 0.0), uTime * 0.004));
  float band = exp(-h * 11.0) * smoothstep(-0.03, 0.02, dir.y);
  color *= 1.0 + smoke * 0.45 * band;
  color += uEmber * max(smoke, 0.0) * band * 0.05;

  // A handful of faint stars, high up only.
  vec3 cell = floor(dir * 90.0);
  vec3 jitter = hash33(cell);
  if (jitter.x > 0.996 && dir.y > 0.38) {
    vec3 star = normalize((cell + 0.25 + jitter * 0.5) / 90.0);
    float d = length(dir - star) * 90.0;
    float twinkle = 0.7 + 0.3 * sin(uTime * (0.6 + jitter.y) + jitter.z * 30.0);
    color += uBone * 0.4 * smoothstep(0.09, 0.0, d) * twinkle * smoothstep(0.38, 0.6, dir.y);
  }

  gl_FragColor = vec4(safeHdr(color), 1.0);
  // Only active without post-processing (direct to screen); no-ops into render targets.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
