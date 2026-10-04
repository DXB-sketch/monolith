/**
 * How scroll progress through the home story maps to chapters and the dive.
 * Pure maths, no Three.js: the scene and the DOM scroll code both import it,
 * so the camera, the scene state and the HUD agree on where the story is.
 *
 * Progress p runs 0..1 over the story container: 0 with its top at the top of
 * the viewport, 1 with its bottom at the bottom of the viewport, which is the
 * moment the plain section starts to appear.
 */

export interface StoryMap {
  /**
   * Progress at which each chapter's content is centred (00..04). The camera
   * holds a chapter's framing around its anchor and travels between anchors.
   */
  chapters: [number, number, number, number, number];
  /** The Chapter 04 dive, after the services summary has been read. */
  dive: {
    /** The camera leaves the Core framing and descends toward the core fissure. */
    start: number;
    /** It is inside the fissure: the wash is at its molten peak. */
    peak: number;
    /** The wash has cooled to magma: the closing CTA may appear from here. */
    magma: number;
    /** Solid basalt, exactly where the plain section begins. */
    end: number;
  };
}

/** Equal spacing, used until the real section positions are measured. */
export const DEFAULT_STORY_MAP: StoryMap = {
  chapters: [0, 0.18, 0.36, 0.54, 0.7],
  dive: { start: 0.78, peak: 0.87, magma: 0.92, end: 1 },
};

/** Fraction of each chapter-to-chapter gap during which the camera holds still. */
const HOLD = 0.18;

export interface StoryPosition {
  /** Chapter position 0..4, eased, with holds at whole numbers. */
  chapter: number;
  /** Dive phase 0..1: 0.5 = peak, 0.75 = cooled to magma, 1 = basalt. */
  dive: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Ken Perlin's smootherstep: zero velocity and acceleration at both ends. */
export const smootherstep = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function storyPosition(
  p: number,
  map: StoryMap,
  out: StoryPosition = { chapter: 0, dive: 0 },
) {
  const a = map.chapters;
  const { start, peak, magma, end } = map.dive;
  out.dive = 0;

  if (p <= a[0]) {
    out.chapter = 0;
    return out;
  }
  for (let i = 0; i < 4; i++) {
    const from = a[i]!;
    const to = a[i + 1]!;
    if (p < to) {
      const s = (p - from) / Math.max(to - from, 1e-6);
      out.chapter = i + smootherstep((s - HOLD) / (1 - 2 * HOLD));
      return out;
    }
  }
  out.chapter = 4;
  if (p <= start) return out;
  // Piecewise-linear dive phase so each landmark lands on a fixed value.
  if (p < peak) out.dive = 0.5 * clamp01((p - start) / Math.max(peak - start, 1e-6));
  else if (p < magma) out.dive = 0.5 + 0.25 * clamp01((p - peak) / Math.max(magma - peak, 1e-6));
  else out.dive = 0.75 + 0.25 * clamp01((p - magma) / Math.max(end - magma, 1e-6));
  return out;
}

/** The chapter whose content is nearest the current position (for the HUD). */
export function activeChapter(position: StoryPosition) {
  return Math.min(4, Math.round(position.chapter));
}
