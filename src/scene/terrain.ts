import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, type Texture } from 'three';
import type { Channel } from './channel';
import { CHANNEL_DEPTH, terrainHeight } from './ground';
import { smoothstep } from './noise';
import type { TierSettings } from './quality';
import type { SceneModule } from './types';
import { CELLS_PER_TILE } from './textures';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/terrain.vert?raw';
import fragmentShader from './shaders/terrain.frag?raw';

export { terrainHeight, CHANNEL_DEPTH } from './ground';

/**
 * Grid denser near the monolith: u in [-1, 1] maps with a power curve. The linear
 * term keeps a minimum spacing; without it the cells at u = 0 collapse to
 * millimetres, the triangles degenerate and their normals become NaN.
 */
function axis(u: number, negExtent: number, posExtent: number) {
  const a = Math.abs(u);
  const m = 0.06 * a + 0.94 * a ** 2.2;
  return u < 0 ? -m * negExtent : m * posExtent;
}

function buildGround(segments: number, channel: Channel) {
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const lava = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = axis((j / segments) * 2 - 1, 1100, 220);
    for (let i = 0; i < n; i++) {
      const x = axis((i / segments) * 2 - 1, 1100, 1100);
      const hit = channel.query(x, z);
      let y = terrainHeight(x, z);
      // Carve the channel: a soft-sided trough under the lava ribbon.
      y -= CHANNEL_DEPTH * (1 - smoothstep(hit.halfWidth * 0.6, hit.halfWidth * 1.7, hit.distance));
      const k = j * n + i;
      positions.set([x, y, z], k * 3);
      // Distance to the molten surface edge, for the glow term in the shader.
      lava[k] = Math.max(0, hit.distance - hit.halfWidth * 0.8);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aLava', new BufferAttribute(lava, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface TerrainModule extends SceneModule {
  /** 0..1: the ground rises out of the haze as the layer appears. */
  setFade(value: number): void;
}

export function createTerrain(
  shared: SharedUniforms,
  tier: TierSettings,
  channel: Channel,
  textures: { noise: Texture; cells: Texture },
): TerrainModule {
  const geometry = buildGround(tier.terrainSegments, channel);
  const defines: Record<string, number> = { CELLS_PER_TILE: CELLS_PER_TILE };
  if (tier.bakedDetail) defines.BAKED_DETAIL = 1;
  if (tier.vertexFog) defines.VERTEX_FOG = 1;
  const uniforms = {
    ...shared,
    uFade: { value: 1 },
    uNoise: { value: textures.noise },
    uCells: { value: textures.cells },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: FRAGMENT_PRELUDE + vertexShader,
    fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
    defines,
  });
  const ground = new Mesh(geometry, material);
  ground.name = 'terrain';

  return {
    object: ground,
    setFade(value) {
      uniforms.uFade.value = value;
    },
    update() {},
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
