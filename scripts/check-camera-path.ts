/**
 * Headless check of the camera journey (npm run check:camera).
 *
 * Samples the whole story at several aspect ratios and fails if the camera ever
 * comes closer to the monolith than the orbit or dive minimum, drops below the
 * ground clearance, or jumps between neighbouring samples.
 *
 * Phase 4: also every page view (with the 404's drift at its extremes), and a
 * glide between every pair of framings (story chapters and page views, both
 * ways): the same clearances, and no jump (a step more than 1.5× the mean of
 * its two neighbours: a smooth glide changes speed gradually).
 */
import {
  cameraAt,
  copyFrame,
  createFrame,
  createPose,
  glideDuration,
  glideFrame,
  MIN_DIVE_CLEARANCE,
  MIN_ORBIT_CLEARANCE,
  orbitAt,
  poseFromFrame,
  viewAt,
  type OrbitFrame,
} from '../src/scene/camera-path';
import { terrainHeight } from '../src/scene/ground';
import { DEFAULT_STORY_MAP, storyPosition } from '../src/scene/story-map';
import { PAGE_VIEWS } from '../src/scene/views';

const SAMPLES = 4000;
/** Largest allowed camera move per 1/4000 of the story, metres. */
const MAX_STEP = 0.5;
const ASPECTS = {
  'desktop 16:9': 16 / 9,
  'laptop 16:10': 1.6,
  'tablet 4:3': 4 / 3,
  'phone 390×844': 390 / 844,
};

let failed = false;
for (const [name, aspect] of Object.entries(ASPECTS)) {
  const pose = createPose();
  let minOrbit = Infinity;
  let minDive = Infinity;
  let minGround = Infinity;
  let maxStep = 0;
  let prevX = NaN;
  let prevY = NaN;
  let prevZ = NaN;
  for (let i = 0; i <= SAMPLES; i++) {
    cameraAt(storyPosition(i / SAMPLES, DEFAULT_STORY_MAP), aspect, pose);
    const { x, y, z } = pose.position;
    if (pose.dive === 0) minOrbit = Math.min(minOrbit, pose.clearance);
    else minDive = Math.min(minDive, pose.clearance);
    minGround = Math.min(minGround, y - terrainHeight(x, z));
    if (i > 0) maxStep = Math.max(maxStep, Math.hypot(x - prevX, y - prevY, z - prevZ));
    prevX = x;
    prevY = y;
    prevZ = z;
  }
  const ok =
    minOrbit >= MIN_ORBIT_CLEARANCE &&
    minDive >= MIN_DIVE_CLEARANCE &&
    minGround >= 0.9 &&
    maxStep <= MAX_STEP;
  failed ||= !ok;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(14)} orbit ≥ ${minOrbit.toFixed(2)} m · dive ≥ ${minDive.toFixed(2)} m · above ground ≥ ${minGround.toFixed(2)} m · max step ${maxStep.toFixed(3)} m`,
  );
}
// ── Page views and glides (Phase 4) ─────────────────────────────────────
const GLIDE_SAMPLES = 240;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

for (const [name, aspect] of Object.entries(ASPECTS)) {
  const pose = createPose();
  const frames: [string, OrbitFrame][] = [];
  for (let c = 0; c <= 4; c++) frames.push([`ch0${c}`, orbitAt(c, aspect)]);
  for (const view of PAGE_VIEWS) {
    const frame = viewAt(view, aspect);
    frames.push([view, frame]);
    if (view === 'notfound') {
      // The 404's slow drift, at its extremes.
      for (const [dt, dh] of [
        [0.035, 1.6],
        [-0.035, -1.6],
      ] as const) {
        const drifted = copyFrame(frame, createFrame());
        drifted.theta += dt;
        drifted.height += dh;
        frames.push([`notfound(drift ${dt > 0 ? '+' : '-'})`, drifted]);
      }
    }
  }

  let minView = Infinity;
  let minViewGround = Infinity;
  for (const [, frame] of frames) {
    poseFromFrame(frame, pose);
    minView = Math.min(minView, pose.clearance);
    minViewGround = Math.min(
      minViewGround,
      pose.position.y - terrainHeight(pose.position.x, pose.position.z),
    );
  }

  let minGlide = Infinity;
  let minGlideGround = Infinity;
  let worstJump = 0;
  let worstPair = '';
  let longest = 0;
  const out = createFrame();
  for (const [fromName, from] of frames) {
    for (const [toName, to] of frames) {
      if (from === to) continue;
      longest = Math.max(longest, glideDuration(from, to));
      const steps: number[] = [];
      let prevX = NaN;
      let prevY = NaN;
      let prevZ = NaN;
      for (let i = 0; i <= GLIDE_SAMPLES; i++) {
        glideFrame(from, to, ease(i / GLIDE_SAMPLES), out);
        poseFromFrame(out, pose);
        const { x, y, z } = pose.position;
        minGlide = Math.min(minGlide, pose.clearance);
        minGlideGround = Math.min(minGlideGround, y - terrainHeight(x, z));
        if (i > 0) steps.push(Math.hypot(x - prevX, y - prevY, z - prevZ));
        prevX = x;
        prevY = y;
        prevZ = z;
      }
      let jump = 0;
      for (let i = 1; i < steps.length - 1; i++) {
        const around = (steps[i - 1]! + steps[i + 1]!) / 2;
        // Ignore the near-stationary ends of the ease.
        if (around > 0.02) jump = Math.max(jump, steps[i]! / around);
      }
      if (jump > worstJump) {
        worstJump = jump;
        worstPair = `${fromName} → ${toName}`;
      }
    }
  }
  const ok =
    minView >= MIN_ORBIT_CLEARANCE &&
    minViewGround >= 0.9 &&
    minGlide >= MIN_ORBIT_CLEARANCE &&
    minGlideGround >= 0.9 &&
    worstJump <= 1.5 &&
    longest <= 850;
  failed ||= !ok;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(14)} views ≥ ${minView.toFixed(2)} m (ground ≥ ${minViewGround.toFixed(2)} m) · ` +
      `${frames.length * (frames.length - 1)} glides ≥ ${minGlide.toFixed(2)} m (ground ≥ ${minGlideGround.toFixed(2)} m) · ` +
      `worst step ${worstJump.toFixed(2)}× its neighbours (${worstPair}) · longest ${longest} ms`,
  );
}

process.exit(failed ? 1 : 0);
