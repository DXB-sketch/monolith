// ── Obsidian surface for the baked tiers ──────────────────────────────────
// The High shader's lighting terms (afterglow diffuse, reflected dusk sky,
// GGX highlight, rim) without the per-pixel conchoidal ripples, and with the
// lava channel's light baked per vertex instead of six point lights.
// Medium evaluates it per pixel; Lite per vertex.
// Needs noise.glsl and atmosphere.glsl.

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

// Ash dust settled near the base (0..1). Object-space point.
float obsidianDust(vec3 p) {
  return smoothstep(1.6, 0.0, p.y + snoise(p * 1.6) * 0.5) * 0.85;
}

// p: object space; worldPos, N: world space. lavaLight: baked channel light.
vec3 obsidianLight(vec3 p, vec3 worldPos, vec3 N, float dust, float lavaLight, out float fres) {
  vec3 V = normalize(cameraPosition - worldPos);
  float NdotV = clamp(dot(N, V), 1e-3, 1.0);
  vec3 R = reflect(-V, N);
  float rough = mix(0.07, 0.4, dust) + 0.02;

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

  fres = 0.05 + 0.95 * pow(1.0 - NdotV, 5.0);
  vec3 env = environment(R, baseGlow);
  env = mix(env, mix(uMagma, uEmber, 0.3) * 0.5, smoothstep(0.1, 0.4, rough));
  // 0.78: the High shader's ripple shading (0.55..1) on average.
  vec3 spec = env * fres * mix(1.0, 0.35, dust) * 0.78;
  spec += sunCol * ggx(max(dot(N, H), 0.0), max(rough, 0.12)) * NdotL * fres * 0.6;

  vec3 sunFlat = normalize(vec3(L.x, 0.0, L.z));
  float rim = pow(1.0 - NdotV, 6.0) * smoothstep(-0.1, 0.7, dot(N, sunFlat));
  spec += sunCol * rim * 0.35;

  // Lava channel light on the lower stone, and a broad warm sheen from it.
  float lava = lavaLight * uLavaGlow;
  diffuse += albedo * uLava * lava * 3.0;
  spec += uLava * lava * fres * 1.5;
  return diffuse + spec;
}
