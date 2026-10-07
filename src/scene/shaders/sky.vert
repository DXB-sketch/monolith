// Prepended in TS: precision, noise.glsl, atmosphere.glsl.
varying vec3 vDir;
#ifdef LITE_SKY
varying vec3 vColor;
#endif

void main() {
  // The dome follows the camera, so only the direction matters.
  vDir = position;
#ifdef LITE_SKY
  vColor = skyColor(normalize(position));
#endif
  vec4 world = modelMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  gl_Position.z = gl_Position.w * 0.99999; // pin to the far plane
}
