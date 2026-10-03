varying vec3 vDir;

void main() {
  // The dome follows the camera, so only the direction matters.
  vDir = position;
  vec4 world = modelMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  gl_Position.z = gl_Position.w * 0.99999; // pin to the far plane
}
