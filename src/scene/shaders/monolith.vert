// Baked tiers prepend noise.glsl, atmosphere.glsl and obsidian.glsl (see monolith.ts).
attribute vec2 aAtlas;

varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

#ifdef BAKED_FISSURES
attribute float aLavaLight; // the lava channel's light, baked per vertex
varying vec2 vAtlas;
varying vec2 vCore;         // x: core vein wobble, y: core vein width factor
varying float vDust;
varying float vLavaLight;
#endif

#ifdef VERTEX_LIGHTING
varying vec3 vSurface;
varying float vFres;
#endif

#ifdef VERTEX_FOG
varying vec4 vFog;
#endif

void main() {
  vObjPos = position;
  vObjNormal = normal;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

#ifdef BAKED_FISSURES
  vec3 p = position;
  vAtlas = aAtlas;
  vLavaLight = aLavaLight;
  // The core vein's jagged line and width noise vary slowly: per vertex is enough.
  vCore.x = snoise(vec3(p.y * 0.9, 0.0, 3.0)) * 0.32 + snoise(vec3(p.y * 3.6, 1.0, 5.0)) * 0.08;
  vCore.y = 0.7 + 0.6 * smoothstep(-0.5, 0.8, snoise(p * 0.9 + 41.0));
  vDust = obsidianDust(p);
#endif

#ifdef VERTEX_LIGHTING
  vSurface = obsidianLight(p, vWorldPos, vWorldNormal, vDust, aLavaLight, vFres);
#endif

#ifdef VERTEX_FOG
  vFog = fogTerm(vWorldPos);
#endif

  gl_Position = projectionMatrix * viewMatrix * world;
}
