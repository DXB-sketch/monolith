// Obsidian monolith: glossy black glass with conchoidal ripples, and magma
// light leaking through a few branching fissures.
// Prepended in TS: precision, noise.glsl, atmosphere.glsl, #defines; the High
// tier adds fissure-field.glsl (veins computed per pixel), the baked tiers
// (Medium, Lite) add obsidian.glsl and read the veins from the fissure atlas.

uniform vec4 uFaceHeat;          // front (+z), right (+x), back (-z), left (-x)
uniform vec3 uPointer;           // world-space heat point
uniform float uPointerHeat;      // 0..1, smoothed on the CPU
uniform float uPointerRadius;    // metres
uniform float uFissureGain;
uniform float uHeight;
uniform vec3 uCorePoint;         // object space, on the front face: the vein Chapter 04 dives into
uniform float uCoreOpen;         // 0..1, the core vein widens and brightens as the camera arrives
uniform float uFade;             // 0..1: the fissure glow ignites from dark as the layer appears
uniform float uExtras;           // 1: optional detail (hairline crazing); 0 when the frame budget is tight

varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

// Heat from the chapter's face and the pointer, at this fragment.
float faceHeatAt(vec3 on) {
  vec4 faceW = pow(max(vec4(on.z, on.x, -on.z, -on.x), 0.0), vec4(2.0));
  return dot(faceW, uFaceHeat) / max(dot(faceW, vec4(1.0)), 1e-3);
}

float pointerHeatAt() {
  float pd = length(vWorldPos - uPointer) / uPointerRadius;
  return uPointerHeat * exp(-pd * pd);
}

// Several incommensurate sine frequencies, so the glow never beats obviously.
float fissurePulse(float phase) {
  float t = uTime;
  return 0.74 + 0.15 * sin(t * 0.52 + phase)
              + 0.07 * sin(t * 1.37 + phase * 1.9)
              + 0.05 * sin(t * 0.21 + phase * 0.7);
}

#ifdef BAKED_FISSURES
// ══ Medium and Lite: veins from the baked atlas ═══════════════════════════

uniform sampler2D uAtlas;
uniform float uAtlasReady;       // 0 until the atlas has loaded (or if it failed)

varying vec2 vAtlas;
varying vec2 vCore;
varying float vDust;
varying float vLavaLight;

#ifdef VERTEX_LIGHTING
varying vec3 vSurface;
varying float vFres;
#endif

#ifdef VERTEX_FOG
varying vec4 vFog;
#endif

void main() {
  vec3 p = vObjPos;
  vec3 on = normalize(vObjNormal);
  float faceHeat = faceHeatAt(on);
  float pointerHeat = pointerHeatAt();
  float heat = clamp(faceHeat * 0.6 + pointerHeat, 0.0, 1.5);

  // ── Surface ───────────────────────────────────────────────────────────
  float fres;
#ifdef VERTEX_LIGHTING
  vec3 surface = vSurface;
  fres = vFres;
#else
  vec3 surface = obsidianLight(p, vWorldPos, normalize(vWorldNormal), vDust, vLavaLight, fres);
#endif
  // The pointer warms what the stone reflects.
  surface += (uLava * 0.12 + uMagma * 0.6) * pointerHeat * fres * mix(1.0, 0.35, vDust);

  // ── Fissures: the atlas stores edge distances, strength and phase ─────
  // r: main vein edge distance, g: branch edge distance (both sqrt-encoded,
  // -0.04..0.56 m), b: vein strength, a: pulse phase.
  vec4 field = texture2D(uAtlas, vAtlas);
  float e = field.r * field.r * 0.6 - 0.04;
  float eb = field.g * field.g * 0.6 - 0.04;
  float phase = (field.a * 2.0 - 1.0) * 6.2831;
  // Heat brightens the veins and extends their fading ends, and widens them.
  float veins = clamp(field.b * uAtlasReady * (1.0 + heat * 0.5), 0.0, 1.0);
  float widen = heat * 0.007;

  float core = (1.0 - smoothstep(0.0, fwidth(e) * 1.5 + 0.003, e - widen)) * veins;
  float dMain = max(e + 0.02, 0.0);
#ifdef FAKE_BLOOM
  // No bloom to soften it: the halo comes from a coarser mip of the same
  // fields, so it spreads smoothly (and over the breaks along a vein, as
  // bloom would) instead of tracing every gap.
  vec4 soft = texture2D(uAtlas, vAtlas, 3.0);
  float softMain = max(soft.r * soft.r * 0.6 - 0.02, 0.0);
  float softVeins = clamp(soft.b * uAtlasReady * (1.0 + heat * 0.5), 0.0, 1.0);
  float halo = exp(-softMain / 0.1) * softVeins;
#else
  float halo = exp(-dMain / 0.1) * veins;
#endif

  // Branches grow only near the main veins.
  float brMask = (1.0 - smoothstep(0.1, 0.9 + heat * 0.3, dMain)) * veins;
  float brCore = 1.0 - smoothstep(0.0, fwidth(eb) * 1.5 + 0.002, eb - widen * 0.45);
  core = max(core, brCore * brMask * 0.45);
  halo += exp(-max(eb + 0.008, 0.0) / 0.035) * brMask * 0.3;

  // The core vein on the front face (analytic, as on High): the dive's target.
  float front = smoothstep(0.6, 0.9, on.z);
  vec2 cp = p.xy - uCorePoint.xy;
  // Per vertex is enough from a distance; in the dive, close up, per pixel.
  float wob = vCore.x;
  if (uCoreOpen > 0.0)
    wob = snoise(vec3(p.y * 0.9, 0.0, 3.0)) * 0.32 + snoise(vec3(p.y * 3.6, 1.0, 5.0)) * 0.08;
  float dCore = abs(cp.x - wob);
  float reach = 2.6 + uCoreOpen * 3.0;
  float coreSpan = 1.0 - smoothstep(reach * 0.35, reach, abs(cp.y));
  float coreW = mix(0.008, 0.035, coreSpan) * vCore.y * (1.0 + uCoreOpen * 9.0);
  float coreLine = (1.0 - smoothstep(coreW, coreW + fwidth(dCore) * 1.5 + 0.003, dCore)) * coreSpan * front;
  core = max(core, coreLine);
  float coreHalo = exp(-dCore / (0.08 + uCoreOpen * 0.9)) * coreSpan * front;
  halo = max(halo, coreHalo);

  // ── Emission ──────────────────────────────────────────────────────────
  float pulse = fissurePulse(phase);
  float flow = 0.5 + 0.5 * smoothstep(-0.7, 0.9, sin(p.y * 0.55 - uTime * 0.45 + phase * 1.7) * 0.85);
  float hotter = mix(1.25, 0.75, smoothstep(0.0, uHeight, p.y));
  float intensity = pulse * flow * hotter * (1.0 + faceHeat * 0.9 + pointerHeat * 2.4) * uFissureGain;

  vec3 coreCol = mix(uLava, uLavaHot, 0.8) * core * 10.0;
  vec3 haloCol = mix(uEmber, uLava, 0.65) * halo * 1.6;
  vec3 emission = (coreCol + haloCol) * intensity;

#ifdef FAKE_BLOOM
  // No bloom pass on Lite: soft glow around the veins stands in for it, a
  // tight hot one and a broad warm one (as bloom's small and large mips).
  float tight = exp(-dMain / 0.05) * veins + exp(-dCore / (0.08 + uCoreOpen * 0.6)) * coreSpan * front;
  float broad = exp(-softMain / 0.25) * softVeins * 0.35 + exp(-dCore / (0.3 + uCoreOpen * 2.0)) * coreSpan * front * 0.5;
  emission += (mix(uLava, uLavaHot, 0.35) * tight * 0.7 + mix(uEmber, uLava, 0.55) * broad * 0.3) * intensity;
  // Without bloom's added light the cores read dimmer: lift them to match.
  emission += coreCol * 0.3 * intensity;
#endif

  // No atlas (still loading, or failed): a flat inner glow, never a blank stone.
  emission += mix(uMagma, uLava, 0.3) * (1.0 - uAtlasReady) * 0.05 * pulse * hotter * uFissureGain;

  // A faint warmth in the glass around the pointer, as if heated from inside.
  emission += (uMagma * 1.4 + uLava * 0.06) * pointerHeat * (0.5 + 0.5 * halo);
  emission *= uFade;

  vec3 color = surface * (1.0 - clamp(core, 0.0, 1.0)) + emission;

#ifdef VERTEX_FOG
  color = mix(color, vFog.rgb, vFog.a);
#else
  color = applyFog(color, vWorldPos);
#endif
  gl_FragColor = vec4(safeHdr(color), 1.0);
  // Only active without post-processing (direct to screen); no-ops into render targets.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}

#else
// ══ High: veins computed per pixel ════════════════════════════════════════

uniform vec4 uLavaLights[LAVA_LIGHTS]; // xyz world position, w intensity

// Magma veins. Returns x = bright core, y = soft halo.
vec2 fissures(vec3 p, float heat, float front) {
  vec3 q = fissureWarp(p);

  // Main veins: exact Voronoi borders, masked so only a few survive.
  float dMain = fissureMainDistance(q);
  float veins = smoothstep(-0.12, 0.3, fissureRegion(p) + heat * 0.1);
  veins *= fissureAlong(p);

  float width = fissureWidth(p);
  width *= 1.0 + heat * 0.35;
  float aa = fwidth(dMain);
  float core = (1.0 - smoothstep(width, width + aa * 1.5 + 0.003, dMain)) * veins;
  float halo = exp(-dMain / (0.05 + width * 2.5)) * veins;

#if FISSURE_OCTAVES > 1
  // Branches: smaller cracks that only grow off the main veins.
  float dBr = fissureBranchDistance(q);
  float nearMain = 1.0 - smoothstep(0.1, 0.9 + heat * 0.3, dMain);
  float brMask = nearMain * veins * fissureBranchGate(p);
  float brW = width * 0.45;
  float brCore = 1.0 - smoothstep(brW, brW + fwidth(dBr) * 1.5 + 0.002, dBr);
  core = max(core, brCore * brMask * 0.45);
  halo += exp(-dBr / 0.035) * brMask * 0.3;
#endif

#if FISSURE_OCTAVES > 2
  // Hairline crazing right beside the hottest veins (an optional extra).
  if (uExtras > 0.5) {
    float dMi = fissureCrazeDistance(q);
    float nearHot = (1.0 - smoothstep(0.03, 0.35, dMain)) * veins;
    float miCore = 1.0 - smoothstep(0.003, 0.003 + fwidth(dMi) * 1.5 + 0.0015, dMi);
    core = max(core, miCore * nearHot * 0.35);
  }
#endif

  // The core vein: always present on the front face, wide and bright, so the
  // Chapter 04 dive always has a fissure to enter. A jagged, mostly vertical
  // line through uCorePoint that tapers at both ends.
  vec2 cp = p.xy - uCorePoint.xy;
  float wob = snoise(vec3(p.y * 0.9, 0.0, 3.0)) * 0.32 + snoise(vec3(p.y * 3.6, 1.0, 5.0)) * 0.08;
  float dCore = abs(cp.x - wob);
  float reach = 2.6 + uCoreOpen * 3.0;
  float coreSpan = 1.0 - smoothstep(reach * 0.35, reach, abs(cp.y));
  float coreW = mix(0.008, 0.035, coreSpan) * (0.7 + 0.6 * smoothstep(-0.5, 0.8, snoise(p * 0.9 + 41.0)));
  coreW *= 1.0 + uCoreOpen * 9.0;
  float coreLine = (1.0 - smoothstep(coreW, coreW + fwidth(dCore) * 1.5 + 0.003, dCore)) * coreSpan * front;
  core = max(core, coreLine);
  halo = max(halo, exp(-dCore / (0.08 + uCoreOpen * 0.9)) * coreSpan * front);

  return vec2(core, halo);
}

// Environment seen in a reflection: the dusk sky above, dark ground with lava glow below.
vec3 environment(vec3 r, float baseGlow) {
  vec3 ground = uBasalt * 0.35 + uLava * 0.08 * baseGlow;
  return mix(ground, skyColor(r), smoothstep(-0.04, 0.06, r.y));
}

float ggx(float NdotH, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * d * d);
}

void main() {
  vec3 p = vObjPos;

  // ── Heat inputs ────────────────────────────────────────────────────────
  vec3 on = normalize(vObjNormal);
  float faceHeat = faceHeatAt(on);
  float pointerHeat = pointerHeatAt();
  float heat = clamp(faceHeat * 0.6 + pointerHeat, 0.0, 1.5);

  // ── Surface normal: conchoidal ripples as a screen-space bump ─────────
  vec3 N = normalize(vWorldNormal);
  float rn = snoise(p * 0.3 + 7.0);
  float rippleAmp = smoothstep(-0.2, 0.8, snoise(p * 0.2 + 1.5));
  float ripple = sin(rn * 16.0 + snoise(p * 1.2) * 1.5) * rippleAmp * 0.0045;
  float grain = snoise(p * 7.0) * 0.0012;
  float bump = ripple + grain;
  vec3 dpdx = dFdx(vWorldPos);
  vec3 dpdy = dFdy(vWorldPos);
  float dhx = dFdx(bump);
  float dhy = dFdy(bump);
  vec3 r1 = cross(dpdy, N);
  vec3 r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  N = normalize(abs(det) * N - grad);

  vec3 V = normalize(cameraPosition - vWorldPos);
  float NdotV = clamp(dot(N, V), 1e-3, 1.0);
  vec3 R = reflect(-V, N);

  // Fine ash dust settles near the base and dulls the gloss.
  float dust = smoothstep(1.6, 0.0, p.y + snoise(p * 1.6) * 0.5) * 0.85;
  float rough = mix(0.07, 0.4, dust) + abs(snoise(p * 0.9)) * 0.04;

  // ── Lighting ──────────────────────────────────────────────────────────
  vec3 albedo = mix(uObsidian * 0.55, uAsh * 0.07, dust);
  float ao = mix(0.3, 1.0, smoothstep(0.0, 1.8, p.y));
  float baseGlow = exp(-p.y * 0.6);

  vec3 sunCol = mix(uEmber, uLava, 0.55) * 2.2 * uGlow;
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float NdotL = max(dot(N, L), 0.0);

  vec3 diffuse = albedo * (
    mix(uMagma * 0.35, uObsidianEdge * 0.6, N.y * 0.5 + 0.5) * ao +
    sunCol * NdotL * 0.6
  );

  float F0 = 0.05;
  float fres = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
  vec3 env = environment(R, baseGlow);
  // Rough reflections lose the sharp horizon: blend toward its average.
  env = mix(env, mix(uMagma, uEmber, 0.3) * 0.5, smoothstep(0.1, 0.4, rough));
  // The pointer warms what the stone reflects.
  env = mix(env, env + uLava * 0.12 + uMagma * 0.6, pointerHeat);
  vec3 spec = env * fres * mix(1.0, 0.35, dust) * (0.55 + 0.45 * smoothstep(-0.01, 0.01, ripple));
  spec += sunCol * ggx(max(dot(N, H), 0.0), max(rough, 0.12)) * NdotL * fres * 0.6;

  // Rim: the afterglow catching the silhouette.
  vec3 sunFlat = normalize(vec3(L.x, 0.0, L.z));
  float rim = pow(1.0 - NdotV, 6.0) * smoothstep(-0.1, 0.7, dot(N, sunFlat));
  spec += sunCol * rim * 0.35;

  // Lava channel light on the lower stone.
  for (int i = 0; i < LAVA_LIGHTS; i++) {
    vec3 toL = uLavaLights[i].xyz - vWorldPos;
    float d2 = dot(toL, toL);
    vec3 Ll = toL * inversesqrt(d2);
    float atten = uLavaLights[i].w * uLavaGlow / (1.0 + d2 * 0.12);
    diffuse += albedo * uLava * max(dot(N, Ll), 0.0) * atten * 3.0;
    float sl = pow(max(dot(R, Ll), 0.0), 40.0);
    spec += uLava * sl * atten * fres * 6.0;
  }

  // ── Fissures ──────────────────────────────────────────────────────────
  vec2 f = fissures(p, heat, smoothstep(0.6, 0.9, on.z));
  float phase = fissurePhase(p);
  float t = uTime;
  float pulse = fissurePulse(phase);
  float flow = 0.5 + 0.5 * smoothstep(-0.7, 0.9,
    snoise(vec3(p.x * 0.9, p.y * 0.32 - t * 0.08, p.z * 0.9)));
  float hotter = mix(1.25, 0.75, smoothstep(0.0, uHeight, p.y));
  float intensity = pulse * flow * hotter * (1.0 + faceHeat * 0.9 + pointerHeat * 2.4) * uFissureGain;

  vec3 coreCol = mix(uLava, uLavaHot, 0.8) * f.x * 10.0;
  vec3 haloCol = mix(uEmber, uLava, 0.65) * f.y * 1.6;
  vec3 emission = (coreCol + haloCol) * intensity;

  // A faint warmth in the glass around the pointer, as if heated from inside.
  emission += (uMagma * 1.4 + uLava * 0.06) * pointerHeat * (0.5 + 0.5 * f.y + 0.4 * abs(ripple) * 100.0);
  emission *= uFade;

  // The crack itself replaces the glass surface.
  vec3 color = (diffuse + spec) * (1.0 - clamp(f.x, 0.0, 1.0)) + emission;

  gl_FragColor = vec4(safeHdr(applyFog(color, vWorldPos)), 1.0);
  // Only active without post-processing (direct to screen); no-ops into render targets.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
#endif
