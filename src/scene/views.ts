/**
 * Page views (Phase 4): every content page has its own framing of the scene.
 * Names, scene state and cost caps live here, Three.js-free, so the boot script
 * and the DOM side can import them; the camera frames are in camera-path.ts.
 *
 * Content pages are atmosphere, not the main event: every view is darker and
 * calmer than the home story's chapters so the page's content leads.
 */
import type { ChapterState } from './chapters';

export const PAGE_VIEWS = [
  'work',
  'case',
  'services',
  'about',
  'lab',
  'contact',
  'notfound',
] as const;

export type PageView = (typeof PAGE_VIEWS)[number];

export const isPageView = (value: unknown): value is PageView =>
  typeof value === 'string' && (PAGE_VIEWS as readonly string[]).includes(value);

/**
 * Highest resolution scale on each page (High and Medium render live there).
 * The controller still lowers it further under load.
 */
export const VIEW_SCALE_CAP: Record<PageView, number> = {
  work: 0.75,
  case: 0.7,
  services: 0.75,
  about: 0.75,
  lab: 0.8,
  contact: 0.75,
  notfound: 0.7,
};

const view = (
  faceHeat: [number, number, number, number],
  emberDensity: number,
  lavaIntensity: number,
  fissureGain: number,
  glow: number,
  coreTemp: number,
): ChapterState => ({ faceHeat, emberDensity, lavaIntensity, fissureGain, glow, coreTemp });

/** faceHeat is front, right, back, left. */
export const VIEW_STATES: Record<PageView, ChapterState> = {
  // Face I's side, from far off: that face holds a little heat.
  work: view([0.1, 0, 0, 0.6], 0.35, 0.85, 0.9, 0.7, 1180),
  // Close on an edge: mostly darkness, one thin vein.
  case: view([0.25, 0.35, 0, 0], 0.25, 0.6, 0.7, 0.55, 1190),
  // From the channel: the lava leads, the stone stays calm.
  services: view([0.2, 0, 0, 0.25], 0.4, 1.2, 0.9, 0.8, 1200),
  // Distant, from the ridge: a small stone on the plain.
  about: view([0.2, 0, 0, 0.2], 0.3, 0.9, 1, 0.5, 1170),
  // Up the right face into the ember column.
  lab: view([0, 0.7, 0, 0], 0.75, 0.8, 0.85, 0.75, 1225),
  // The front face and its core vein: warm, the brightest page view.
  contact: view([0.8, 0.1, 0, 0.1], 0.5, 1, 1.3, 1, 1250),
  // Far beyond the edge of the plain.
  notfound: view([0.1, 0, 0, 0.1], 0.2, 0.7, 0.8, 0.45, 1150),
};
