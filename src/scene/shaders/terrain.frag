// Matte basalt ground and the distant volcanic plugs.
// Prepended in TS: precision, noise.glsl, atmosphere.glsl.

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vLava;

void main() {
  vec3 N = normalize(vNormal + vec3(0.0, 1e-4, 0.0));
  vec3 p = vWorldPos;
  vec3 V = normalize(cameraPosition - p);
  vec3 L = normalize(uSunDir);
  vec3 sunCol = mix(uEmber, uLava, 0.5) * 1.6 * uGlow;

#ifdef PEAKS
  // Far silhouettes: almost flat, a faint warm rim where the afterglow grazes them.
  vec3 albedo = uBasalt * 0.9;
  vec3 color = albedo * (uMagma * 0.5 + sunCol * max(dot(N, L), 0.0) * 0.4);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(normalize(N.xz + 1e-4), normalize(L.xz)), 0.0);
  color += sunCol * rim * 0.12;
#else
  float dist = length(p - cameraPosition);
  // Fine basalt texture, faded out with distance to avoid shimmer.
  float detailFade = 1.0 - smoothstep(40.0, 160.0, dist);
  float n1 = snoise(vec3(p.xz * 0.35, 1.0));
  float n2 = snoise(vec3(p.xz * 2.2, 4.0)) * detailFade;
  float n3 = snoise(vec3(p.xz * 9.0, 7.0)) * (1.0 - smoothstep(10.0, 45.0, dist));

  // Bump the normal a little with the fine noise (cheap, analytic-free).
  N = normalize(N + vec3(n2 * 0.12 + n3 * 0.06, 0.0, n2 * 0.1 - n3 * 0.05));

  vec3 albedo = mix(uBasalt, uObsidianEdge, 0.35 + 0.25 * n1 + 0.15 * n2);
  albedo = mix(albedo, uAsh * 0.08, smoothstep(0.35, 0.8, n1) * 0.35);

  float ambientUp = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uMagma * 0.2, uObsidianEdge * 0.55, ambientUp);
  vec3 color = albedo * (ambient + sunCol * max(dot(N, L), 0.0) * 0.55);

  // Lava light: a tight hot pool beside the channel and a broad warm wash.
  float lavaDist = max(vLava, 0.0); // see safeHdr(): never trust an extrapolated varying
  float glowNear = exp(-lavaDist / 1.8);
  float glowFar = exp(-lavaDist / 9.0);
  color += albedo * uLava * (glowNear * 5.0 + glowFar * 0.6);
  // Faint warm sheen on the rock facing the lava.
  color += uLava * glowNear * 0.05 * pow(1.0 - max(dot(N, V), 0.0), 2.0);

  // Hot cracks in the banks right beside the flow.
  float bank = 1.0 - smoothstep(0.0, 1.3, lavaDist);
  vec4 vo = voronoi2(p.xz * 1.6);
  float crack = 1.0 - smoothstep(0.02, 0.06, vo.y);
  color += mix(uLava, uLavaHot, 0.3) * crack * bank * bank * 2.5;

  // The monolith's fissures light the ground at its feet; contact shadow beneath.
  float r = length(p.xz);
  color += albedo * uLava * exp(-r / 3.5) * 1.6;
  color *= mix(0.45, 1.0, smoothstep(2.6, 5.5, r));
#endif

  gl_FragColor = vec4(safeHdr(applyFog(color, p)), 1.0);
  // Only active without post-processing (direct to screen); no-ops into render targets.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
