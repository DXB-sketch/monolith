/**
 * The /potential gate (Phase 6): checks the device before the 3D story runs.
 * Loaded only on /potential (PotentialGate.astro).
 *
 *   1. Cheap signals first: reduced motion, save-data, or 3D switched off for
 *      the visit (?tier=poster). Any of these fails at once, before anything
 *      is downloaded.
 *   2. The GPU check (detectTier). The poster or Lite fails: the showcase is
 *      only worth showing at Medium or High.
 *   3. The scene starts on the persistent canvas behind the panel, at the
 *      detected tier and the Arrival view, its controller held at full scale.
 *   4. Two seconds of frame times once every layer is in. Pass: median and
 *      95th percentile within the thresholds in quality.ts. High failing gets
 *      one more try at Medium.
 *   5. Pass: "Enter the stone" (scene-boot's enterExperience). Fail: the scene
 *      is torn down, the reason is shown, and the way back is the primary button.
 *
 * `?tier=high|medium|lite` (tests, captures) passes at that tier without the
 * benchmark. Every status change is announced in a polite live region.
 */
import {
  detectTier,
  detectTierFast,
  GATE_BENCHMARK_MS,
  GATE_TIERS,
  isSceneTier,
  judgeFrames,
  prefersReducedMotion,
  saveData,
  type SceneTier,
} from '../scene/quality';
import { mark, withTimeout } from './diagnostics';
import {
  endTrial,
  enterExperience,
  getExperience,
  measureTrial,
  runTrial,
  type ExperienceState,
} from './scene-boot';

type Row = 'graphics' | 'loading' | 'framerate';
type Status = 'waiting' | 'running' | 'passed' | 'failed' | 'skipped';
type State = 'idle' | 'checking' | 'passed' | 'failed' | 'leaving' | 'entered';

/** The GPU check's own limit (scene-boot uses the same for the 3D pipeline). */
const DETECT_TIMEOUT_MS = 4000;
/** Measuring may stall (a hidden tab pauses rendering); past this, it fails. */
const MEASURE_TIMEOUT_MS = GATE_BENCHMARK_MS + 8000;
/** Matches the panel's opacity transition (--dur-slow). */
const LEAVE_MS = 700;

class GateFailure extends Error {
  constructor(
    readonly row: Row,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fps = (ms: number) => Math.max(1, Math.round(1000 / ms));

/** Plain English for why the GPU check ruled the scene out. */
function graphicsReason(reason: string): string {
  if (/no WebGL2|probe threw/i.test(reason))
    return 'Your browser doesn’t offer WebGL 2, the graphics support this scene needs.';
  if (/software renderer/i.test(reason))
    return 'Your browser is drawing graphics without the graphics card, which is far too slow for this scene.';
  return 'Your device’s graphics are better suited to lighter scenes than this one.';
}

export function mountGate(root: HTMLElement) {
  const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const enter = q<HTMLButtonElement>('[data-gate-enter]')!;
  const runAgain = q<HTMLButtonElement>('[data-gate-run]')!;
  const back = q<HTMLAnchorElement>('[data-gate-back]')!;
  const stay = q<HTMLAnchorElement>('[data-gate-stay]')!;
  const result = q<HTMLElement>('[data-gate-result]')!;
  const reasonEl = q<HTMLElement>('[data-gate-reason]')!;
  const live = q<HTMLElement>('[data-gate-live]')!;
  const progress = q<HTMLElement>('[data-gate-progress]')!;
  let token = 0;
  let progressRaf = 0;

  const setState = (state: State) => (root.dataset.state = state);
  const announce = (message: string) => {
    // Cleared first so a repeated message is still read.
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = message));
  };
  const row = (name: Row, status: Status, text: string) => {
    const el = q<HTMLElement>(`[data-check="${name}"]`);
    if (!el) return;
    el.dataset.status = status;
    const label = el.querySelector('[data-check-status]');
    if (label) label.textContent = text;
  };
  const setProgress = (value: number) =>
    progress.style.setProperty('--progress', String(Math.min(1, Math.max(0, value))));

  const animateProgress = (duration: number) => {
    cancelAnimationFrame(progressRaf);
    const start = performance.now();
    const step = (now: number) => {
      setProgress((now - start) / duration);
      if (now - start < duration) progressRaf = requestAnimationFrame(step);
    };
    progressRaf = requestAnimationFrame(step);
  };

  const reset = () => {
    cancelAnimationFrame(progressRaf);
    setProgress(0);
    (['graphics', 'loading', 'framerate'] as Row[]).forEach((name) =>
      row(name, 'waiting', 'Waiting'),
    );
    result.hidden = true;
    enter.hidden = false;
    enter.disabled = true;
    runAgain.hidden = true;
    back.hidden = true;
    stay.hidden = false;
  };

  const fail = (failure: GateFailure, current: number) => {
    if (current !== token) return;
    cancelAnimationFrame(progressRaf);
    endTrial(`gate: ${failure.message}`);
    row(failure.row, 'failed', 'Not passed');
    reasonEl.textContent = failure.message;
    result.hidden = false;
    enter.hidden = true;
    stay.hidden = true;
    back.hidden = false;
    setState('failed');
    announce(`Your device is better suited to the 2D site. ${failure.message}`);
  };

  const pass = (current: number) => {
    if (current !== token) return;
    enter.disabled = false;
    setState('passed');
    announce('Your device passed the check. Enter the stone when you’re ready.');
  };

  /** One tier: start the scene behind the panel, then (unless forced) measure it. */
  const tryTier = async (tier: SceneTier, measure: boolean, current: number) => {
    row('loading', 'running', tier === 'high' ? 'Loading' : 'Loading a lighter version');
    row('framerate', 'waiting', 'Waiting');
    setProgress(0);
    const trial = runTrial(tier);
    try {
      await trial.built;
    } catch {
      throw new GateFailure('loading', 'The 3D scene couldn’t start on this device.');
    }
    if (current !== token) return null;
    row('loading', 'passed', 'Loaded');
    if (!measure) {
      row('framerate', 'skipped', 'Skipped: tier forced');
      return { pass: true };
    }
    row('framerate', 'running', 'Measuring');
    announce('Scene loaded. Measuring the frame rate.');
    animateProgress(GATE_BENCHMARK_MS);
    let measured: Awaited<ReturnType<typeof measureTrial>>;
    try {
      measured = await Promise.race([
        measureTrial(GATE_BENCHMARK_MS),
        trial.failed,
        sleep(MEASURE_TIMEOUT_MS).then(() => {
          throw new Error('timed out');
        }),
      ]);
    } catch {
      throw new GateFailure('framerate', 'The scene stopped before the frame-rate test finished.');
    }
    if (current !== token) return null;
    setProgress(1);
    const verdict = judgeFrames(measured.samples, measured.gpu);
    mark(
      'gate verdict',
      `${tier}: ${verdict.pass ? 'pass' : 'fail'}, median ${verdict.median.toFixed(1)} ms, ` +
        `p95 ${verdict.p95.toFixed(1)} ms, gpu ${verdict.gpu?.toFixed(1) ?? 'n/a'} ms, ${verdict.frames} frames`,
    );
    const rate = fps(Math.max(verdict.median, verdict.gpu ?? 0));
    row('framerate', verdict.pass ? 'passed' : 'failed', `About ${rate} fps`);
    return { pass: verdict.pass, rate };
  };

  const run = async () => {
    const current = ++token;
    reset();
    setState('checking');
    row('graphics', 'running', 'Checking');
    announce('Checking your device.');
    try {
      // 1. Cheap signals: nothing is downloaded when these rule the scene out.
      if (prefersReducedMotion())
        throw new GateFailure(
          'graphics',
          'Your device is set to reduce motion, and this scene is all motion.',
        );
      if (saveData())
        throw new GateFailure(
          'graphics',
          'Data saver is on, and the 3D scene is a large download.',
        );
      const fast = detectTierFast();
      if (fast?.tier === 'poster')
        throw new GateFailure('graphics', '3D has been switched off for this visit.');
      const forced = fast && isSceneTier(fast.tier) ? fast.tier : null;

      // 2. The GPU check.
      let tier: SceneTier;
      if (forced) {
        tier = forced;
      } else {
        let detected: Awaited<ReturnType<typeof detectTier>>;
        try {
          detected = await withTimeout(detectTier(), DETECT_TIMEOUT_MS, 'graphics check');
        } catch {
          throw new GateFailure('graphics', 'The graphics check didn’t finish in time.');
        }
        if (current !== token) return;
        if (detected.tier === 'poster')
          throw new GateFailure('graphics', graphicsReason(detected.reason));
        if (detected.tier === 'lite')
          throw new GateFailure(
            'graphics',
            'Your device’s graphics are better suited to lighter scenes than this one.',
          );
        tier = detected.tier;
      }
      row('graphics', 'passed', forced ? 'Forced' : 'Supported');

      // 3–5. Load and measure; High gets one more try at Medium.
      const tiers = forced ? [forced] : GATE_TIERS.slice(GATE_TIERS.indexOf(tier));
      let rate = 0;
      for (const candidate of tiers) {
        const outcome = await tryTier(candidate, !forced, current);
        if (!outcome || current !== token) return;
        if (outcome.pass) return pass(current);
        rate = outcome.rate ?? 0;
        if (candidate !== tiers[tiers.length - 1])
          announce('A little slow. Trying a lighter version of the scene.');
      }
      throw new GateFailure(
        'framerate',
        `It ran at about ${rate} frames a second here, and this scene needs about 50.`,
      );
    } catch (error) {
      if (error instanceof GateFailure) fail(error, current);
      else fail(new GateFailure('loading', 'The check couldn’t finish.'), current);
    }
  };

  enter.addEventListener('click', () => {
    if (enter.disabled || root.dataset.state !== 'passed') return;
    setState('leaving');
    announce('Entering the 3D story.');
    // The panel fades, then the story takes the page from the top.
    window.setTimeout(() => {
      if (root.dataset.state !== 'leaving' || !root.isConnected) return;
      root.hidden = true;
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (!enterExperience()) {
        root.hidden = false;
        void run();
        return;
      }
      setState('entered');
      document.getElementById('hero-title')?.focus({ preventScroll: true });
    }, LEAVE_MS);
  });

  runAgain.addEventListener('click', () => void run());

  // "Back to 2D" from the nav while here: the panel returns, ready to check again on request.
  const onExperience = (event: Event) => {
    const { entered } = (event as CustomEvent<ExperienceState>).detail;
    if (entered || !root.isConnected) return;
    token++;
    reset();
    root.hidden = false;
    enter.hidden = true;
    runAgain.hidden = false;
    setState('idle');
  };
  document.addEventListener('monolith:experience', onExperience);
  document.addEventListener(
    'astro:before-swap',
    () => {
      token++;
      cancelAnimationFrame(progressRaf);
      document.removeEventListener('monolith:experience', onExperience);
    },
    { once: true },
  );

  // Entered already (remembered): the story runs, the gate stays hidden.
  if (getExperience().entered) {
    root.hidden = true;
    setState('entered');
    return;
  }
  // The visitor came here to see it: the check starts once the page has painted.
  requestAnimationFrame(() => setTimeout(() => void run(), 0));
}
