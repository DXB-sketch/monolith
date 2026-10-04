import { MathUtils, Vector3 } from 'three';

/**
 * Camera keyframes per chapter. Phase 1 only defines Chapter 00 (Arrival); Phase 2
 * adds the other four and interpolates between them with setProgress().
 *
 * Each frame has a landscape and a portrait composition. Landscape puts the
 * monolith just left of centre with the hero copy to its right; portrait raises
 * it above the copy, which sits at the bottom of the screen.
 */
export interface Framing {
  position: Vector3;
  target: Vector3;
  /** Vertical field of view, degrees. */
  fov: number;
}

interface ChapterFrame {
  landscape: Framing;
  portrait: Framing;
}

const frame = (p: [number, number, number], t: [number, number, number], fov: number) => ({
  position: new Vector3(...p),
  target: new Vector3(...t),
  fov,
});

export const CHAPTER_FRAMES: ChapterFrame[] = [
  // 00 — Arrival: wide, low, in front of the stone.
  {
    landscape: frame([-6.5, 2.1, 42], [5.6, 7.2, 0], 34),
    portrait: frame([-5, 2.3, 50], [-0.2, 0.6, 0], 46),
  },
];

const scratch = { position: new Vector3(), target: new Vector3(), fov: 0 };

/** Blend the landscape and portrait compositions by aspect ratio. */
export function framingFor(chapter: number, aspect: number, out: Framing = scratch): Framing {
  const f = CHAPTER_FRAMES[MathUtils.clamp(chapter, 0, CHAPTER_FRAMES.length - 1)]!;
  const t = MathUtils.smoothstep(aspect, 0.65, 1.45);
  out.position.lerpVectors(f.portrait.position, f.landscape.position, t);
  out.target.lerpVectors(f.portrait.target, f.landscape.target, t);
  out.fov = MathUtils.lerp(f.portrait.fov, f.landscape.fov, t);
  return out;
}

/** Very slow idle drift: a breathing camera, never a moving one. */
export function idleOffset(time: number, out = new Vector3()) {
  return out.set(
    Math.sin(time * 0.071) * 0.55 + Math.sin(time * 0.031) * 0.25,
    Math.sin(time * 0.053 + 1.3) * 0.12,
    Math.sin(time * 0.043 + 0.7) * 0.4,
  );
}
