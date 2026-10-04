/**
 * Ground height, shared by the terrain mesh, the lava ribbon, embers and the
 * camera's terrain clearance. Shader-free so pure maths can import it.
 */
import { createNoise2, fbm, ridged, smoothstep } from './noise';

const nLumps = createNoise2(3);
const nFine = createNoise2(5);
const nRoll = createNoise2(11);
const nRidge = createNoise2(23);

/** Depth the channel is carved into the ground, metres. */
export const CHANNEL_DEPTH = 0.65;

/**
 * Ground height before the channel is carved. Flat around the monolith and the
 * camera's sightline, rising into low basalt ridges toward the horizon.
 */
export function terrainHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const lumps = fbm(nLumps, x * 0.11, z * 0.11, 4) * 0.35 + fbm(nFine, x * 0.5, z * 0.5, 2) * 0.06;
  const rolling = fbm(nRoll, x * 0.018, z * 0.018, 4) * 5 * smoothstep(12, 80, r);
  const ridges = ridged(nRidge, x * 0.008 + 3, z * 0.008 - 2, 5) * 16 * smoothstep(70, 280, r);
  const far = ridged(nRidge, x * 0.0035 + 9, z * 0.0035, 4) * 38 * smoothstep(300, 750, r);
  let h = lumps + rolling + ridges + far;

  // Keep the foreground and the camera's line of sight low.
  const front = smoothstep(-25, 12, z) * (1 - smoothstep(35, 90, Math.abs(x)));
  h *= 1 - front * 0.8;
  // A level pad around the base of the stone.
  h *= smoothstep(3.5, 10, r) * 0.85 + 0.15;
  return h;
}
