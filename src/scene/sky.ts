import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import type { SceneModule } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/sky.vert?raw';
import fragmentShader from './shaders/sky.frag?raw';

export const SKY_RADIUS = 2400;

export function createSky(shared: SharedUniforms): SceneModule {
  const geometry = new SphereGeometry(SKY_RADIUS, 48, 24);
  const material = new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader,
    fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
    side: BackSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  return {
    object: mesh,
    update() {},
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
