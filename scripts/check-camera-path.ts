/**
 * Headless check of the camera journey (npm run check:camera).
 *
 * Samples the whole story at several aspect ratios and fails if the camera ever
 * comes closer to the monolith than the orbit or dive minimum, drops below the
 * ground clearance, or jumps between neighbouring samples.
 */
import {
  cameraAt,
  createPose,
  MIN_DIVE_CLEARANCE,
  MIN_ORBIT_CLEARANCE,
} from '../src/scene/camera-path';
import { terrainHeight } from '../src/scene/ground';
import { DEFAULT_STORY_MAP, storyPosition } from '../src/scene/story-map';

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
process.exit(failed ? 1 : 0);
