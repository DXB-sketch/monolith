// Matte basalt ground and the distant volcanic plugs.
// Prepended in TS: precision, noise.glsl, atmosphere.glsl.
// BAKED_DETAIL (Medium, Lite): ground detail and bank cracks from tiling
// textures instead of per-pixel simplex and Voronoi noise.

uniform float uFade; // 0..1: the ground rises out of the haze as its layer appears

#ifdef BAKED_DETAIL
uniform sampler2D uNoise; // seamless noise: 4 / 8 / 16 / 32 cycles per tile in r / g / b / a
uniform sampler2D uCells; // seamless Voronoi: r = border distance × 2
#endif

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vLava;

#ifdef VERTEX_FOG
varying vec4 vFog;
#endif

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
#ifdef BAKED_DETAIL
  float n1 = texture2D(uNoise, p.xz * (0.35 / 4.0)).r * 2.0 - 1.0;
  float n2 = (texture2D(uNoise, p.xz * (2.2 / 8.0)).g * 2.0 - 1.0) * detailFade;
  float n3 = (texture2D(uNoise, p.xz * (9.0 / 16.0)).b * 2.0 - 1.0) * (1.0 - smoothstep(10.0, 45.0, dist));
#else
  float n1 = snoise(vec3(p.xz * 0.35, 1.0));
  float n2 = snoise(vec3(p.xz * 2.2, 4.0)) * detailFade;
  float n3 = snoise(vec3(p.xz * 9.0, 7.0)) * (1.0 - smoothstep(10.0, 45.0, dist));
#endif

  // Bump the normal a little with the fine noise (cheap, analytic-free).
  N = normalize(N + vec3(n2 * 0.12 + n3 * 0.06, 0.0, n2 * 0.1 - n3 * 0.05));

  vec3 albedo = mix(uBasalt, uObsidianEdge, 0.35 + 0.25 * n1 + 0.15 * n2);
  albedo = mix(albedo, uAsh * 0.08, smoothstep(0.35, 0.8, n1) * 0.35);

  float ambientUp = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uMagma * 0.2, uObsidianEdge * 0.55, ambientUp);
  vec3 color = albedo * (ambient + sunCol * max(dot(N, L), 0.0) * 0.55);

  // Lava light: a tight hot pool beside the channel and a broad warm wash.
  float lavaDist = max(vLava, 0.0); // see safeHdr(): never trust an extrapolated varying
  float glowNear = exp(-lavaDist / 1.8) * uLavaGlow;
  float glowFar = exp(-lavaDist / 9.0) * uLavaGlow;
  color += albedo * uLava * (glowNear * 5.0 + glowFar * 0.6);
  // Faint warm sheen on the rock facing the lava.
  color += uLava * glowNear * 0.05 * pow(1.0 - max(dot(N, V), 0.0), 2.0);

  // Hot cracks in the banks right beside the flow.
  float bank = 1.0 - smoothstep(0.0, 1.3, lavaDist);
#ifdef BAKED_DETAIL
  float border = texture2D(uCells, p.xz * (1.6 / float(CELLS_PER_TILE))).r * 0.5;
  float crack = 1.0 - smoothstep(0.02, 0.06, border);
#else
  vec4 vo = voronoi2(p.xz * 1.6);
  float crack = 1.0 - smoothstep(0.02, 0.06, vo.y);
#endif
  color += mix(uLava, uLavaHot, 0.3) * crack * bank * bank * 2.5 * uLavaGlow;

  // The monolith's fissures light the ground at its feet; contact shadow beneath.
  float r = length(p.xz);
  color += albedo * uLava * exp(-r / 3.5) * 1.6;
  color *= mix(0.45, 1.0, smoothstep(2.6, 5.5, r));
#endif

#ifdef VERTEX_FOG
  color = mix(color, vFog.rgb, vFog.a);
#else
  color = applyFog(color, p);
#endif
  // Rising out of the haze behind it while the layer fades in.
  if (uFade < 1.0) color = mix(skyColor(normalize(p - cameraPosition)), color, uFade);

  gl_FragColor = vec4(safeHdr(color), 1.0);
  // Only active without post-processing (direct to screen); no-ops into render targets.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
