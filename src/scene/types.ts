import type { Object3D, Vector3, Vector4 } from 'three';

/**
 * Per-frame state the scene modules read. Phase 2 drives these from the
 * scroll story; in Phase 1 they hold the Chapter 00 values.
 */
export interface SceneState {
  /** Seconds since the scene started, excluding paused time. */
  time: number;
  /** Seconds since the previous frame. */
  delta: number;
  /** Heat per monolith face (front, right, back, left), 0..1. */
  faceHeat: Vector4;
  /** World-space point the pointer is heating, and its strength 0..1. */
  pointerPoint: Vector3;
  pointerHeat: number;
  /** Ember density 0..1 (fraction of the particle pool that is alive). */
  emberDensity: number;
  /** Lava brightness multiplier. */
  lavaIntensity: number;
}

/**
 * Every scene element follows this shape, so a procedural mesh can later be
 * swapped for a GLB from public/models without touching the rest of the scene.
 */
export interface SceneModule {
  object: Object3D;
  update(state: SceneState): void;
  dispose(): void;
}
