attribute float aLava;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vLava;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLava = aLava;
  gl_Position = projectionMatrix * viewMatrix * world;
}
