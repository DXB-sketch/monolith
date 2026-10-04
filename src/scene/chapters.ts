/**
 * Per-chapter scene state, blended continuously by the story position.
 * Three.js-free so the DOM side (the HUD core temperature) can import it.
 */
import type { StoryPosition } from './story-map';

export interface ChapterState {
  /** Fissure heat per face: front (+z), right (+x), back (−z), left (−x). */
  faceHeat: [number, number, number, number];
  emberDensity: number;
  lavaIntensity: number;
  fissureGain: number;
  /** Horizon glow, relative to the Chapter 00 base. */
  glow: number;
  /** Decorative HUD reading, °C. */
  coreTemp: number;
}

export const CHAPTER_STATES: [
  ChapterState,
  ChapterState,
  ChapterState,
  ChapterState,
  ChapterState,
] = [
  // 00 — Arrival
  {
    faceHeat: [0.2, 0, 0, 0.2],
    emberDensity: 0.55,
    lavaIntensity: 1,
    fissureGain: 1,
    glow: 1,
    coreTemp: 1160,
  },
  // 01 — Face I (left face)
  {
    faceHeat: [0, 0, 0, 1],
    emberDensity: 0.55,
    lavaIntensity: 1,
    fissureGain: 1.1,
    glow: 1,
    coreTemp: 1180,
  },
  // 02 — Face II (back face): the lava rivers intensify
  {
    faceHeat: [0, 0, 1, 0],
    emberDensity: 0.6,
    lavaIntensity: 1.35,
    fissureGain: 1.1,
    glow: 1.1,
    coreTemp: 1200,
  },
  // 03 — The Lab (right face): the ember column rises
  {
    faceHeat: [0, 1, 0, 0],
    emberDensity: 0.9,
    lavaIntensity: 1.1,
    fissureGain: 1.15,
    glow: 1,
    coreTemp: 1225,
  },
  // 04 — The Core (front face); fissure gain keeps rising through the dive
  {
    faceHeat: [1, 0.3, 0, 0.3],
    emberDensity: 0.7,
    lavaIntensity: 1.2,
    fissureGain: 1.6,
    glow: 1.25,
    coreTemp: 1250,
  },
];

/** Fissure gain at the bottom of the dive, as the camera enters the core vein. */
export const DIVE_FISSURE_GAIN = 2.8;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function blendChapterState(position: StoryPosition, out: ChapterState): ChapterState {
  const c = Math.min(4, Math.max(0, position.chapter));
  const i = Math.min(3, Math.floor(c));
  const t = c - i;
  const a = CHAPTER_STATES[i]!;
  const b = CHAPTER_STATES[i + 1]!;
  for (let k = 0; k < 4; k++) out.faceHeat[k] = lerp(a.faceHeat[k]!, b.faceHeat[k]!, t);
  out.emberDensity = lerp(a.emberDensity, b.emberDensity, t);
  out.lavaIntensity = lerp(a.lavaIntensity, b.lavaIntensity, t);
  out.fissureGain = lerp(a.fissureGain, b.fissureGain, t);
  out.glow = lerp(a.glow, b.glow, t);
  out.coreTemp = lerp(a.coreTemp, b.coreTemp, t);
  // "1.6 rising": keep heating the core through the descent, up to the peak.
  if (position.dive > 0) {
    out.fissureGain = lerp(out.fissureGain, DIVE_FISSURE_GAIN, Math.min(1, position.dive / 0.5));
  }
  return out;
}

export function createChapterState(): ChapterState {
  return { ...CHAPTER_STATES[0], faceHeat: [...CHAPTER_STATES[0].faceHeat] };
}
