/**
 * The camera's journey around the monolith.
 *
 * Chapters 00–04 are an orbit in one direction (front-left → left face → back
 * face → right face → front again). Interpolating positions with a spline
 * through orbit keyframes cuts inside the circle between points and can clip
 * the stone, so the orbit is interpolated in cylindrical coordinates around the
 * monolith (angle, radius, height) with the target and field of view blended
 * separately. Only the Chapter 04 dive into the core fissure uses a spline.
 *
 * Each chapter has a landscape and a portrait framing, blended by aspect ratio.
 * Landscape frames put the stone on the opposite side from that chapter's copy;
 * portrait frames raise it above the copy, which flows at the bottom.
 *
 * Phase 4 adds a view per content page (VIEW_FRAMES) and glides between any
 * two framings (story chapters or page views): the same cylindrical
 * interpolation, taking the short way round, with a higher arc for long moves.
 *
 * Pure maths (no DOM, no shaders) so it can be tested headlessly.
 */
import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  CORE_POINT_WORLD,
  FRONT_NORMAL_WORLD,
  MONOLITH,
  MONOLITH_MATRIX,
  MONOLITH_ROTATION,
} from './dimensions';
import { terrainHeight } from './ground';
import { smootherstep, type StoryPosition } from './story-map';
import type { PageView } from './views';

export interface OrbitFrame {
  /** Angle around the monolith's vertical axis, radians (0 = +z). Decreases through the story. */
  theta: number;
  radius: number;
  /** Camera height above y = 0 (raised further if the ground is higher). */
  height: number;
  /** Look-at height. */
  targetHeight: number;
  /** Look-at offset along the camera's right vector: positive puts the stone left of centre. */
  lateral: number;
  /** Look-at offset along the camera's horizontal forward vector. */
  depth: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface ChapterFrame {
  landscape: OrbitFrame;
  portrait: OrbitFrame;
}

export interface CameraPose {
  position: Vector3;
  target: Vector3;
  fov: number;
  /** Distance from the camera to the monolith's surface, metres. */
  clearance: number;
  /** Progress along the dive spline 0..1 (1 = inside the core fissure). */
  dive: number;
}

/** Closest the camera may come to the stone while orbiting, metres. */
export const MIN_ORBIT_CLEARANCE = 6;
/** Closest the camera may come during the dive: just in front of the core vein. */
export const MIN_DIVE_CLEARANCE = 0.3;
/** Keep the camera at least this far above the ground. */
const GROUND_CLEARANCE = 1;

const PI = Math.PI;
const ROT = MONOLITH_ROTATION.y;
/** World angle of each face's outward normal, unwrapped for a one-way orbit. */
export const FACE_ANGLE = {
  front: ROT,
  left: ROT - PI / 2,
  back: ROT - PI,
  right: ROT - (3 * PI) / 2,
  frontAgain: ROT - 2 * PI,
} as const;

const orbit = (
  theta: number,
  radius: number,
  height: number,
  targetHeight: number,
  lateral: number,
  fov: number,
  depth = 0,
): OrbitFrame => ({ theta, radius, height, targetHeight, lateral, depth, fov });

/** Express an authored position/target pair as an orbit frame (used for Chapter 00). */
function orbitFromCartesian(
  p: [number, number, number],
  t: [number, number, number],
  fov: number,
): OrbitFrame {
  const theta = Math.atan2(p[0], p[2]);
  const rightX = Math.cos(theta);
  const rightZ = -Math.sin(theta);
  const fwdX = -Math.sin(theta);
  const fwdZ = -Math.cos(theta);
  return orbit(
    theta,
    Math.hypot(p[0], p[2]),
    p[1],
    t[1],
    t[0] * rightX + t[2] * rightZ,
    fov,
    t[0] * fwdX + t[2] * fwdZ,
  );
}

export const CHAPTER_FRAMES: [
  ChapterFrame,
  ChapterFrame,
  ChapterFrame,
  ChapterFrame,
  ChapterFrame,
] = [
  // 00 — Arrival: wide and low, front-left. Unchanged from Phase 1.
  {
    landscape: orbitFromCartesian([-6.5, 2.1, 42], [5.6, 7.2, 0], 34),
    portrait: orbitFromCartesian([-5, 2.3, 50], [-0.2, 0.6, 0], 46),
  },
  // 01 — Face I: the left face, closer. Copy on the left, so the stone sits right.
  {
    landscape: orbit(FACE_ANGLE.left + 0.24, 21, 4.4, 8.8, -3.6, 36),
    portrait: orbit(FACE_ANGLE.left + 0.24, 30, 3.2, 3.6, 0, 50),
  },
  // 02 — Face II: the back face. Copy on the right, so the stone sits left.
  {
    landscape: orbit(FACE_ANGLE.back + 0.16, 26, 2.8, 7.6, 4.4, 36),
    portrait: orbit(FACE_ANGLE.back + 0.16, 36, 2.6, 2.8, 0, 50),
  },
  // 03 — The Lab: the right face, camera low and tilting up the ember column.
  {
    landscape: orbit(FACE_ANGLE.right + 0.18, 22, 1.3, 12.5, -3.8, 42),
    portrait: orbit(FACE_ANGLE.right + 0.18, 32, 1.4, 8.5, 0, 54),
  },
  // 04 — The Core: back to the front face, higher and closer. Copy on the right.
  {
    landscape: orbit(FACE_ANGLE.frontAgain, 30, 4, 8.2, 4.6, 34),
    portrait: orbit(FACE_ANGLE.frontAgain, 40, 3.2, 3.4, 0, 46),
  },
];

/**
 * One view per content page, each in landscape and portrait. Landscape keeps
 * the stone away from the text column (which sits left on every content page);
 * portrait, where text runs full width, keeps the stone small and high.
 */
export const VIEW_FRAMES: Record<PageView, ChapterFrame> = {
  // Work index: a wide shot from Face I's side, the stone small and to the right.
  work: {
    landscape: orbit(FACE_ANGLE.left + 0.42, 78, 6, 10, -22, 34),
    portrait: orbit(FACE_ANGLE.left + 0.42, 100, 6, -9, 0, 48),
  },
  // Case study: close and low on the front-right edge; mostly darkness, one vein at the side.
  case: {
    landscape: orbit(ROT + 1.3, 10.5, 1.1, 9.5, -5.6, 40),
    portrait: orbit(ROT + 1.3, 13, 1, 14, -3.4, 54),
  },
  // Services: standing over the lava channel, looking up the flow toward the stone.
  services: {
    landscape: orbit(-0.44, 45, 2.4, 5.5, -9, 36),
    portrait: orbit(-0.44, 60, 7, 12, 0, 50),
  },
  // About: far out on the ridge line, the stone small on the plain, the peaks behind.
  about: {
    landscape: orbit(0.22, 175, 14, 9, -34, 30),
    portrait: orbit(0.22, 200, 16, -16, 0, 44),
  },
  // Lab: low against the right face, looking up into the ember column.
  lab: {
    landscape: orbit(FACE_ANGLE.right + 2 * PI + 0.12, 13, 0.6, 18, -5, 50),
    portrait: orbit(FACE_ANGLE.right + 2 * PI + 0.12, 15, 0.6, 21, 0, 60),
  },
  // Contact: the front face, close to the core vein, sitting behind the form (left).
  contact: {
    landscape: orbit(ROT - 0.12, 13, 7.2, 8.4, 5.2, 40),
    portrait: orbit(ROT - 0.12, 32, 6, -2, 0, 50),
  },
  // 404: from beyond the far edge of the plain; the ground falls away in front.
  notfound: {
    landscape: orbit(0.1, 300, 26, -2, -44, 32),
    portrait: orbit(0.1, 320, 30, -24, 0, 46),
  },
};

const lerp = MathUtils.lerp;

/** 0 for portrait, 1 for landscape, blended in between. */
export function landscapeWeight(aspect: number) {
  return MathUtils.smoothstep(aspect, 0.65, 1.45);
}

function blendFrames(a: OrbitFrame, b: OrbitFrame, t: number, out: OrbitFrame) {
  out.theta = lerp(a.theta, b.theta, t);
  out.radius = lerp(a.radius, b.radius, t);
  out.height = lerp(a.height, b.height, t);
  out.targetHeight = lerp(a.targetHeight, b.targetHeight, t);
  out.lateral = lerp(a.lateral, b.lateral, t);
  out.depth = lerp(a.depth, b.depth, t);
  out.fov = lerp(a.fov, b.fov, t);
  return out;
}

const scratchA = orbit(0, 0, 0, 0, 0, 0);
const scratchB = orbit(0, 0, 0, 0, 0, 0);

/** The orbit frame for a chapter position 0..4, at this aspect ratio. */
export function orbitAt(
  chapter: number,
  aspect: number,
  out: OrbitFrame = orbit(0, 0, 0, 0, 0, 0),
) {
  const c = MathUtils.clamp(chapter, 0, 4);
  const i = Math.min(3, Math.floor(c));
  const t = c - i;
  const w = landscapeWeight(aspect);
  const from = CHAPTER_FRAMES[i]!;
  const to = CHAPTER_FRAMES[i + 1]!;
  blendFrames(from.portrait, from.landscape, w, scratchA);
  blendFrames(to.portrait, to.landscape, w, scratchB);
  return blendFrames(scratchA, scratchB, t, out);
}

/** The orbit frame for a page view, at this aspect ratio. */
export function viewAt(view: PageView, aspect: number, out: OrbitFrame = orbit(0, 0, 0, 0, 0, 0)) {
  const frame = VIEW_FRAMES[view];
  return blendFrames(frame.portrait, frame.landscape, landscapeWeight(aspect), out);
}

export function createFrame(): OrbitFrame {
  return orbit(0, 0, 0, 0, 0, 0);
}

export function copyFrame(from: OrbitFrame, out: OrbitFrame) {
  return blendFrames(from, from, 0, out);
}

/** Shortest signed angle from a to b, radians. */
function angleBetween(a: number, b: number) {
  const d = (b - a) % (2 * PI);
  return d > PI ? d - 2 * PI : d < -PI ? d + 2 * PI : d;
}

/** How long a glide between two frames takes: longer for longer moves, never over 850 ms. */
export function glideDuration(from: OrbitFrame, to: OrbitFrame) {
  const turn = Math.abs(angleBetween(from.theta, to.theta)) / PI;
  const reach = Math.abs(to.radius - from.radius) / 150;
  return Math.round(550 + 300 * MathUtils.clamp(turn + reach, 0, 1));
}

/**
 * A frame partway through a glide (t eased 0..1), the short way round. Long
 * moves (a big turn or a big change of distance) rise on a higher, wider arc,
 * so the motion stays readable and the camera passes well clear of the stone.
 */
export function glideFrame(from: OrbitFrame, to: OrbitFrame, t: number, out: OrbitFrame) {
  const turn = angleBetween(from.theta, to.theta);
  blendFrames(from, to, t, out);
  out.theta = from.theta + turn * t;
  const arc =
    (MathUtils.clamp(Math.abs(turn) / PI, 0, 1) * 10 +
      MathUtils.clamp(Math.abs(to.radius - from.radius) / 80, 0, 1) * 4) *
    Math.sin(PI * t);
  out.height += arc;
  out.radius += arc * 0.8;
  out.targetHeight += arc * 0.5;
  return out;
}

/** Camera pose for an orbit frame (a page view or a glide), with the usual clearances. */
export function poseFromFrame(frame: OrbitFrame, out: CameraPose): CameraPose {
  placeOrbit(frame, out.position, out.target);
  out.fov = frame.fov;
  out.dive = 0;
  out.clearance = clearanceFrom(out.position);
  return out;
}

const inverse = MONOLITH_MATRIX.clone().invert();
const local = new Vector3();

/** Distance from a world point to the monolith's (untapered) box. */
export function clearanceFrom(point: Vector3) {
  local.copy(point).applyMatrix4(inverse);
  const dx = Math.max(Math.abs(local.x) - MONOLITH.width / 2, 0);
  const dy = Math.max(-local.y, local.y - MONOLITH.height, 0);
  const dz = Math.max(Math.abs(local.z) - MONOLITH.depth / 2, 0);
  return Math.hypot(dx, dy, dz);
}

function placeOrbit(f: OrbitFrame, position: Vector3, target: Vector3) {
  const s = Math.sin(f.theta);
  const c = Math.cos(f.theta);
  let radius = f.radius;
  position.set(s * radius, f.height, c * radius);
  // Never closer than the minimum: push outward along the radius if needed.
  for (let k = 0; k < 8 && clearanceFrom(position) < MIN_ORBIT_CLEARANCE; k++) {
    radius += MIN_ORBIT_CLEARANCE - clearanceFrom(position) + 0.05;
    position.set(s * radius, f.height, c * radius);
  }
  position.y = Math.max(position.y, terrainHeight(position.x, position.z) + GROUND_CLEARANCE);
  target.set(c * f.lateral - s * f.depth, f.targetHeight, -s * f.lateral - c * f.depth);
}

// The dive: a spline from the Core framing into the core vein.
const diveCurve = new CatmullRomCurve3(
  [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
  false,
  'centripetal',
);
const coreRight = new Vector3().crossVectors(new Vector3(0, 1, 0), FRONT_NORMAL_WORLD).normalize();
const diveTarget = new Vector3();
const scratchUp = new Vector3();
const orbitTarget = new Vector3();
const orbitFrame = orbit(0, 0, 0, 0, 0, 0);

/**
 * Camera pose for a story position. `aspect` picks the landscape/portrait blend.
 */
export function cameraAt(position: StoryPosition, aspect: number, out: CameraPose): CameraPose {
  orbitAt(position.chapter, aspect, orbitFrame);
  placeOrbit(orbitFrame, out.position, orbitTarget);
  out.target.copy(orbitTarget);
  out.fov = orbitFrame.fov;
  out.dive = 0;

  if (position.dive > 0) {
    // The camera reaches the vein at the wash peak (dive phase 0.5) and stays there.
    const q = smootherstep(position.dive / 0.5);
    const n = FRONT_NORMAL_WORLD;
    const pts = diveCurve.points;
    pts[0]!.copy(out.position);
    pts[1]!
      .copy(CORE_POINT_WORLD)
      .addScaledVector(n, 11)
      .addScaledVector(coreRight, 0.9)
      .add(scratchUp.set(0, -0.4, 0));
    pts[2]!.copy(CORE_POINT_WORLD).addScaledVector(n, 3).addScaledVector(coreRight, 0.2);
    pts[3]!.copy(CORE_POINT_WORLD).addScaledVector(n, MIN_DIVE_CLEARANCE + 0.12);
    diveCurve.getPoint(q, out.position);
    diveTarget.copy(CORE_POINT_WORLD).addScaledVector(n, -1);
    out.target.lerpVectors(orbitTarget, diveTarget, smootherstep(q * 1.4));
    // Narrow the view slightly for intensity.
    out.fov = orbitFrame.fov * lerp(1, 0.72, q);
    out.dive = q;
  }

  out.clearance = clearanceFrom(out.position);
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

export function createPose(): CameraPose {
  return { position: new Vector3(), target: new Vector3(), fov: 34, clearance: 40, dive: 0 };
}
