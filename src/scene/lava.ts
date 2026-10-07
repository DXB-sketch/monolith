import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, type Texture } from 'three';
import type { Channel } from './channel';
import { smoothstep } from './noise';
import type { TierSettings } from './quality';
import { terrainHeight } from './ground';
import { CELLS_PER_TILE } from './textures';
import type { SceneModule, SceneState } from './types';
import { FRAGMENT_PRELUDE, type SharedUniforms } from './uniforms';
import vertexShader from './shaders/lava.vert?raw';
import fragmentShader from './shaders/lava.frag?raw';

/** How far the ribbon extends past the molten half-width, tucked under the banks. */
const OVERHANG = 1.35;
const ACROSS = 6;

/** A ribbon mesh along the channel, following the ground just below the banks. */
function buildRibbon(channel: Channel) {
  const { samples } = channel;
  const cols = ACROSS + 1;
  const count = samples.length * cols;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const widths = new Float32Array(count);

  samples.forEach((s, j) => {
    const nx = -s.tz;
    const nz = s.tx;
    const r = Math.hypot(s.x, s.z);
    // Far away the terrain grid is coarse: lift the surface so it never sinks from view.
    const lift = smoothstep(40, 260, r) * 0.9;
    for (let i = 0; i < cols; i++) {
      const v = (i / ACROSS) * 2 - 1;
      const off = v * s.halfWidth * OVERHANG;
      const x = s.x + nx * off;
      const z = s.z + nz * off;
      const y = terrainHeight(s.x, s.z) - 0.24 + lift;
      const k = j * cols + i;
      positions.set([x, y, z], k * 3);
      uvs.set([s.s, v * OVERHANG], k * 2);
      widths[k] = s.halfWidth;
    }
  });

  const index: number[] = [];
  for (let j = 0; j < samples.length - 1; j++) {
    for (let i = 0; i < ACROSS; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('aHalfWidth', new BufferAttribute(widths, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

export interface LavaModule extends SceneModule {
  /** 0..1: the flow brightens from dark as the layer appears. */
  setFade(value: number): void;
}

export function createLava(
  shared: SharedUniforms,
  channel: Channel,
  tier: TierSettings,
  textures: { noise: Texture; cells: Texture },
): LavaModule {
  const geometry = buildRibbon(channel);
  const uniforms = {
    ...shared,
    uLavaIntensity: { value: 1 },
    uFade: { value: 1 },
    uNoise: { value: textures.noise },
    uCells: { value: textures.cells },
  };
  const defines: Record<string, number> = { CELLS_PER_TILE: CELLS_PER_TILE };
  if (tier.bakedDetail) defines.BAKED_DETAIL = 1;
  if (tier.vertexFog) defines.VERTEX_FOG = 1;
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: FRAGMENT_PRELUDE + vertexShader,
    fragmentShader: FRAGMENT_PRELUDE + fragmentShader,
    defines,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'lava';

  return {
    object: mesh,
    setFade(value) {
      uniforms.uFade.value = value;
    },
    update(state: SceneState) {
      uniforms.uLavaIntensity.value = state.lavaIntensity;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
