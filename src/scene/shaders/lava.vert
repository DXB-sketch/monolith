attribute float aHalfWidth;

varying vec2 vUv;
varying float vHalfWidth;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vHalfWidth = aHalfWidth;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
