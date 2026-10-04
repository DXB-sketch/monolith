/**
 * Monolith dimensions and placement. Shader-free so pure maths (camera path,
 * tests) can import it without pulling in GLSL.
 */
import { Euler, Matrix4, Vector3 } from 'three';

/** Proportions from SCENE_SPEC: width : height : depth = 1 : 3.2 : 0.5. */
export const MONOLITH = {
  width: 5,
  height: 16,
  depth: 2.5,
  /** Sunk slightly into the ground so it reads as planted, not placed. */
  sink: 0.35,
} as const;

/** A lean of about 1.5 degrees and a slight turn, so it feels found rather than placed. */
export const MONOLITH_ROTATION = new Euler(0.014, 0.06, -0.022, 'YXZ');

/** Local → world transform of the monolith (matches the mesh's matrixWorld). */
export const MONOLITH_MATRIX = new Matrix4()
  .makeRotationFromEuler(MONOLITH_ROTATION)
  .setPosition(0, -MONOLITH.sink, 0);

/**
 * The core point (object space, on the front face around mid-height). The shader
 * guarantees a bright, wide vein here, and Chapter 04 dives into it.
 */
export const CORE_POINT_LOCAL = new Vector3(0.35, 8.4, MONOLITH.depth / 2);

/** World-space core point and the front face's outward normal. */
export const CORE_POINT_WORLD = CORE_POINT_LOCAL.clone().applyMatrix4(MONOLITH_MATRIX);
export const FRONT_NORMAL_WORLD = new Vector3(0, 0, 1).applyEuler(MONOLITH_ROTATION).normalize();
