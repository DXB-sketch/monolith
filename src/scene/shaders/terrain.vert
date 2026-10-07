// Prepended in TS: precision, noise.glsl, atmosphere.glsl (for per-vertex fog).
attribute float aLava;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vLava;

#ifdef VERTEX_FOG
varying vec4 vFog;
#endif

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLava = aLava;
#ifdef VERTEX_FOG
  vFog = fogTerm(vWorldPos);
#endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
