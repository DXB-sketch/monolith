// Prepended in TS: precision, noise.glsl, atmosphere.glsl (for per-vertex fog).
attribute float aHalfWidth;

varying vec2 vUv;
varying float vHalfWidth;
varying vec3 vWorldPos;

#ifdef VERTEX_FOG
varying vec4 vFog;
#endif

void main() {
  vUv = uv;
  vHalfWidth = aHalfWidth;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
#ifdef VERTEX_FOG
  vFog = fogTerm(vWorldPos);
#endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
