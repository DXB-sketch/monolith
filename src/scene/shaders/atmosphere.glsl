// ── Atmosphere: dusk sky gradient and horizon-tinted fog ───────────────────
// Every material shares these uniforms (one object, referenced everywhere), so
// distant geometry fades into exactly the colour of the sky behind it.
// Colours come from palette.ts, in linear space.

uniform vec3 uBasalt;
uniform vec3 uObsidian;
uniform vec3 uObsidianEdge;
uniform vec3 uMagma;
uniform vec3 uLava;
uniform vec3 uLavaHot;
uniform vec3 uEmber;
uniform vec3 uAsh;
uniform vec3 uBone;
uniform vec3 uSunDir;      // toward the afterglow, behind the monolith
uniform float uTime;
uniform float uFogDensity;
uniform float uGlow;       // overall horizon glow strength
uniform float uLavaGlow;   // 0..1: the lava layer's light (fades in with it)

// Sky radiance for a view direction.
vec3 skyColor(vec3 dir) {
  float y = dir.y;
  vec2 az = normalize(dir.xz + 1e-5);
  vec2 sunAz = normalize(uSunDir.xz);
  float toward = dot(az, sunAz) * 0.5 + 0.5;        // 0 opposite the glow, 1 into it
  float h = max(y, 0.0);

  vec3 zenith = uBasalt * 0.45;
  vec3 charcoal = mix(uBasalt, uObsidianEdge, 0.55);
  vec3 low = mix(uMagma, uObsidianEdge, 0.3);

  vec3 c = mix(low, charcoal, smoothstep(0.0, 0.12, h));
  c = mix(c, zenith, smoothstep(0.1, 0.45, h));

  // Horizon band: a thin ember line everywhere, much stronger toward the afterglow.
  float band = exp(-h * 26.0);
  float bandStrength = mix(0.18, 1.0, pow(toward, 3.0));
  c += uEmber * band * bandStrength * 0.75 * uGlow;

  // Afterglow core: a broad warm bloom low over the horizon.
  float glow = pow(toward, 12.0) * exp(-h * 11.0);
  c += uLava * glow * 0.4 * uGlow;
  float core = pow(toward, 60.0) * exp(-h * 30.0);
  c += uLavaHot * core * 0.4 * uGlow;

  // Below the horizon: dark ground haze.
  float below = smoothstep(0.0, -0.08, y);
  c = mix(c, mix(uMagma, uBasalt, 0.5) * 0.6, below);
  return c;
}

// Cap HDR output. With MSAA, varyings are evaluated at the pixel centre, which can
// sit outside thin triangles; extrapolated values can overflow the half-float
// target to Inf, which bloom then smears across the screen.
vec3 safeHdr(vec3 c) {
  return clamp(c, vec3(0.0), vec3(48.0));
}

// Exponential height fog that blends toward the sky colour in the view direction.
// xyz: fog colour, w: amount. Split out so Lite can evaluate it per vertex.
vec4 fogTerm(vec3 worldPos) {
  vec3 toFrag = worldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 dir = toFrag / max(dist, 1e-4);
  float heightFalloff = exp(-max(worldPos.y, 0.0) * 0.012);
  float amount = 1.0 - exp(-dist * uFogDensity * heightFalloff);
  vec3 fogDir = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.6 + 0.02, dir.z));
  return vec4(skyColor(fogDir), clamp(amount, 0.0, 0.9));
}

vec3 applyFog(vec3 color, vec3 worldPos) {
  vec4 fog = fogTerm(worldPos);
  return mix(color, fog.rgb, fog.a);
}
