/**
 * Scene boot: decides the experience mode and the quality tier, keeps the
 * poster in charge until the WebGL scene has rendered a frame, and owns the
 * scene's lifecycle.
 *
 * Phase 6: the experience mode sits above the tiers. '2d' is the default
 * everywhere and runs no WebGL at all: no GPU check, no worker, no scene chunk
 * (not even prefetched), no fissure atlas, no canvas context. The tier stays
 * the poster with the reason `experience-2d`. '3d' is entered only from the
 * /potential gate (src/lib/gate.ts), which benchmarks the device first through
 * runTrial(); then everything below runs exactly as before. The choice is
 * remembered in localStorage (only ever as '3d', after a passed gate), and
 * "Back to 2D" (the nav) leaves it again without a reload. `?tier=high|medium|lite`
 * forces 3D at that tier for tests and captures; `?tier=poster` forces 2D.
 * Reduced motion and save-data always mean 2D.
 *
 * This file is in the initial bundle, so it never imports Three.js. The scene
 * is a separate chunk, executed only for the live tiers (High, Medium, Lite):
 * on the home page while its story region (`data-scene-anchor`) is on screen,
 * and on content pages, which name their own view of the stone
 * (`main[data-scene-view]`, Phase 4) and render it lighter (a resolution cap;
 * Lite holds a still frame once the camera has arrived).
 *
 * The tier is reactive state. It starts from cheap signals or this session's
 * memory (or "pending" while the GPU is checked after first paint) and can
 * change later: the GPU check resolving, the scene stepping a tier up or down
 * in place, a lost GPU context, reduced motion being switched on, or a failed
 * setup. Every change goes through setTier(), which starts or stops the scene
 * and switches the scroll story's mode in place.
 *
 * Nothing here can wait forever: every asynchronous step has a timeout, and
 * every path ends in the live scene or the poster with a recorded reason
 * (see the ?fps overlay, or ?debug in the console).
 */
import {
  error,
  fallback,
  getDiagnostics,
  info,
  mark,
  setSceneStats,
  withTimeout,
} from './diagnostics';
import {
  detectTier,
  detectTierFast,
  experienceRuledOut,
  FISSURE_ATLAS_URL,
  forcedTier,
  isSceneTier,
  prefersReducedMotion,
  readTierCache,
  sceneStillPossible,
  storedExperience,
  storeExperience,
  TIER_SETTINGS,
  writeTierCache,
  type Experience,
  type QualityTier,
  type SceneTier,
} from '../scene/quality';
import type { SceneHandle, StoryMap } from '../scene/index';
import { isPageView, VIEW_SCALE_CAP, type PageView } from '../scene/views';
import type { StoryBridge, StoryController, StoryMode } from './story';
import type { RevealController } from './reveal';
import { onLeave, posterReason, track } from './analytics';

/** Upper bounds for each boot step, so no path can hang. */
const TIER_TIMEOUT_MS = 4000;
const STORY_CHUNK_TIMEOUT_MS = 20000;
const SCENE_CHUNK_TIMEOUT_MS = 30000;
const SCENE_SETUP_TIMEOUT_MS = 45000;
const FIRST_FRAME_TIMEOUT_MS = 8000;
const CONTEXT_RESTORE_TIMEOUT_MS = 10000;
/** After `load`, how long the GPU check may run before the scene chunk is prefetched. */
const PREFETCH_DELAY_MS = 1000;
/** After the first frame, how long before the visit's tier counts as settled (analytics). */
const TIER_SETTLE_MS = 5000;
/** Matches --dur-fade: the canvas's cross-fade over the poster. */
const CROSSFADE_MS = 1200;

/**
 * The scene chunk's URL, written in at build time by the `scene-chunk-url` Vite
 * plugin (astro.config.mjs), so it can be prefetched without being executed.
 * Left as the placeholder in dev, where prefetching is skipped.
 */
const SCENE_CHUNK_URL: string = '__MONOLITH_SCENE_CHUNK__';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
/** Test hook (?debug&delayscene=5000): hold the scene import back to test late arrival. */
const DELAY_SCENE_MS = DEBUG ? Number(params.get('delayscene') ?? 0) : 0;
/** Test hook (?debug&keeptier): never change tier, without forcing one. */
const KEEP_TIER = DEBUG && params.has('keeptier');
/** Test hook (?scale=0.75): hold the resolution scale. */
const FIXED_SCALE = params.has('scale') ? Number(params.get('scale')) || undefined : undefined;
/** ?fps: time each scene layer on the GPU for the overlay. */
const GPU_TIMING = params.has('fps');

let experience: Experience = '2d';
/** The visitor entered 3D through the gate (this visit, or remembered). */
let entered = false;
/** This page has the gate (/potential) and the visitor hasn't entered: the scene waits for it. */
let gated = false;
/** The gate's check, while it runs (and once passed, until "Enter the stone"). */
let trial: Trial | null = null;

let tier: QualityTier = 'poster';
/** True until the GPU has been checked (after first paint, on scene pages only). */
let pending = true;
let detecting = false;
let prefetched = false;
/** Why the tier is what it is, for the poster's recorded reason. */
let tierReason = '';
let posterReasonRecorded = false;
/** Why the live scene last gave way to the poster (failed setup, no frame, lost context). */
let teardownReason = '';
let tierReported = false;

let handle: SceneHandle | null = null;
/** Bumped whenever an in-flight scene load must be abandoned. */
let sceneToken = 0;
let sceneLoading = false;
/** Set when the scene failed for good this visit; it is not retried. */
let sceneBlocked = '';
let firstFrameSeen = false;
let firstFrameTimer = 0;
let restoreTimer = 0;
let atlasFetch: Promise<Blob> | null = null;

let anchor: Element | null = null;
let anchorVisible = false;
/** This page's view of the stone (content pages), or null (home, story). */
let pageView: PageView | null = null;
/** How the current page was reached: a link, back/forward, or the first load. */
let navigationType: 'initial' | 'push' | 'replace' | 'traverse' = 'initial';
let observer: IntersectionObserver | null = null;
let started = false;

// Queued for the scene: it may not exist yet when the story first reports.
let queuedProgress: number | null = null;
let queuedMap: StoryMap | null = null;

let story: StoryController | null = null;
let storyRoot: Element | null = null;
let storyToken = 0;

const html = document.documentElement;
const stage = () => document.querySelector<HTMLElement>('[data-scene-stage]');
const canvas = () => document.querySelector<HTMLCanvasElement>('[data-scene-canvas]');
const washLayer = () => document.querySelector<HTMLElement>('[data-scene-wash]');
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ClientRouter replaces <html> attributes with the incoming page's on navigation.
 * The state is stamped onto the incoming document before the swap, so there is
 * never a moment without `js` (which would, for example, make ClientRouter's
 * scroll restoration smooth and interruptible), and re-applied after it.
 */
function applyRootState(root: HTMLElement = html) {
  root.classList.add('js');
  if (pending) delete root.dataset.tier;
  else root.dataset.tier = tier;
  root.dataset.experience = experience;
  root.toggleAttribute('data-entered', entered);
}

function stampIncoming(event: Event) {
  const next = (event as Event & { newDocument?: Document }).newDocument;
  if (next) applyRootState(next.documentElement);
}

/** Run after the browser has painted the HTML, preferably when idle. */
function afterFirstPaint(task: () => void) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout: 1200 });
      else task();
    }, 0);
  });
}

/** The scene has somewhere to be: the story (/potential), or a content page's view. */
const sceneWanted = () => Boolean(pageView) || Boolean(anchor);
/** The gate's check renders behind the gate panel, whether or not the story is on screen yet. */
const sceneActive = () =>
  Boolean(pageView) || (Boolean(anchor) && (anchorVisible || Boolean(trial)));
/** WebGL may run: 3D mode (and not on a gate still waiting), or the gate's own check. */
const sceneAllowed = () => Boolean(trial) || (experience === '3d' && !gated);

function sync() {
  const el = stage();
  const active = sceneActive();
  el?.classList.toggle('is-dormant', !active);
  el?.classList.toggle('is-view', Boolean(pageView));
  if (!handle) return;
  if (active && !document.hidden) handle.resume();
  else handle.pause();
}

/**
 * Live tiers get the full story (camera, Lenis); the poster gets native scroll
 * with simple reveals, and reduced motion the static story.
 */
function storyMode(): StoryMode {
  if (prefersReducedMotion()) return 'static';
  // Behind the gate the story stays as poster visitors see it, even while the check runs.
  if (trial || gated) return 'lite';
  if (pending) return 'pending';
  return tier === 'poster' ? 'lite' : 'full';
}

// ── Tier ──────────────────────────────────────────────────────────────────

/**
 * The single place the tier changes. Starts or stops the scene and re-modes the
 * story. `fromScene`: the running scene decided (it has already switched itself
 * in place, or gave up for the poster); remembered for this session.
 */
function setTier(next: QualityTier, reason: string, fromScene = false) {
  const wasPending = pending;
  if (!wasPending && next === tier) return;
  tier = next;
  pending = false;
  tierReason = reason;
  applyRootState();
  mark(wasPending ? 'tier final' : 'tier changed', `${next}: ${reason}`);
  if (fromScene) writeTierCache({ tier: next, reason });

  if (isSceneTier(next)) {
    if (!fromScene) void ensureScene();
    // Lite holds stills on content pages; the tiers above it keep rendering.
    else handle?.setHoldWhenIdle(Boolean(pageView) && next === 'lite');
  } else if (handle || sceneLoading) {
    teardownScene(`tier ${next}: ${reason}`);
  } else {
    recordPosterTier();
  }
  if (next === 'poster') {
    // 3D mode whose device (or scene) ends on the poster: back to 2D, so the nav says so too.
    if (experience === '3d' && !gated && !trial) leaveExperience(reason);
    document.dispatchEvent(new CustomEvent('monolith:poster'));
    reportTier();
  }
  story?.setMode(storyMode());
}

/** On a scene page whose tier rules the scene out, say why the poster is showing (once). */
function recordPosterTier() {
  if (!sceneWanted() || pending || isSceneTier(tier) || posterReasonRecorded) return;
  posterReasonRecorded = true;
  fallback(`poster: tier ${tier} (${tierReason})`);
}

/** The deferred GPU check, after first paint, with the scene chunk prefetching alongside. */
function detect() {
  if (!pending || detecting) return;
  detecting = true;
  afterFirstPaint(async () => {
    schedulePrefetch();
    mark('tier check started');
    try {
      const result = await withTimeout(detectTier(), TIER_TIMEOUT_MS, 'tier detection');
      if (pending) setTier(result.tier, result.reason);
    } catch (e) {
      // Unknown is never weak: an unanswered GPU check still gets the lightest live tier.
      if (pending) setTier('lite', `tier detection failed (${errorText(e)}): trying lite`);
    }
  });
}

/**
 * If the GPU check is still running a second after the page has loaded (a
 * slow WebGPU adapter, a software renderer), fetch the scene chunk alongside it
 * so the two overlap. On real GPUs the check is done long before: a live tier
 * is importing the chunk anyway, and the poster downloads nothing. Waiting this
 * long keeps the prefetch away from LCP (measured: prefetching at first paint,
 * even at idle priority, pushed Lighthouse LCP from 1.7–2.1 s to 2.2–2.9 s, and
 * prefetching right at `load` still did on fast loads).
 */
function schedulePrefetch() {
  const later = () => setTimeout(prefetchScene, PREFETCH_DELAY_MS);
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}

/**
 * Fetch (but don't execute) the scene chunk. `rel="prefetch"` is idle priority
 * (`modulepreload` was fetched at high priority whatever its fetchpriority), and
 * the later import() is served from the prefetch cache. Skipped when cheap
 * signals already rule the scene out (save-data, reduced motion), once the tier
 * has settled, and in dev.
 */
function prefetchScene() {
  if (prefetched || !pending || !sceneStillPossible() || SCENE_CHUNK_URL.startsWith('__')) return;
  prefetched = true;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'script';
  link.href = SCENE_CHUNK_URL;
  document.head.appendChild(link);
  mark('scene chunk prefetch');
}

// ── Analytics ─────────────────────────────────────────────────────────────

/**
 * `scene_tier`, once per visit: what the visitor actually got. Sent when the
 * poster is decided, a few seconds after the live scene's first frame (so an
 * early step down in place counts), or when the page is first hidden.
 * `live: false` with a live tier means the scene hadn't rendered yet (the
 * visitor left first); the poster carries a short reason category.
 */
function reportTier() {
  if (tierReported) return;
  tierReported = true;
  if (pending) return track('scene_tier', { tier: 'pending', live: false });
  const live = Boolean(handle && firstFrameSeen);
  if (live) return track('scene_tier', { tier: handle!.tier, live });
  if (isSceneTier(tier) && !sceneBlocked) return track('scene_tier', { tier, live });
  track('scene_tier', {
    tier: 'poster',
    live,
    reason: posterReason(sceneBlocked ? teardownReason : tierReason),
  });
}

// ── Scene ─────────────────────────────────────────────────────────────────

/** The scroll story talks to the scene only through this bridge: always the current handle. */
const bridge: StoryBridge = {
  setProgress(p, immediate = false) {
    queuedProgress = p;
    handle?.setProgress(p, immediate);
  },
  setStoryMap(map) {
    queuedMap = map;
    handle?.setStoryMap(map);
  },
};

/** A scene that arrives late starts exactly where the page already is. */
function flushQueue() {
  if (!handle) return;
  if (queuedMap) handle.setStoryMap(queuedMap);
  if (queuedProgress !== null) handle.setProgress(queuedProgress, true);
  applyView(true);
}

/**
 * Point the camera at this page's view (or back at the story) and set the
 * page's cost: content pages render at a capped resolution, and Lite holds a
 * still frame there. The camera glides unless the move should be instant:
 * the first load, back/forward (restore, don't replay), reduced motion.
 */
function applyView(immediate = false) {
  if (!handle) return;
  const instant =
    immediate ||
    navigationType === 'initial' ||
    navigationType === 'traverse' ||
    prefersReducedMotion();
  handle.setView(pageView, { immediate: instant });
  handle.setScaleCap(pageView ? VIEW_SCALE_CAP[pageView] : 1);
  handle.setHoldWhenIdle(Boolean(pageView) && handle.tier === 'lite');
}

function setWash(amount: number, css: string) {
  const layer = washLayer();
  if (!layer) return;
  layer.style.backgroundColor = css;
  layer.style.opacity = amount > 0 ? String(amount) : '0';
}

function onFirstFrame() {
  firstFrameSeen = true;
  trial?.firstFrame();
  clearTimeout(firstFrameTimer);
  mark('first frame');
  teardownReason = '';
  setTimeout(reportTier, TIER_SETTLE_MS);
  stage()?.classList.add('is-live');
  // The intro (first visit) can open now: L1 is on screen.
  document.dispatchEvent(new CustomEvent('monolith:scene-ready'));
  setTimeout(() => mark('poster cross-fade done'), CROSSFADE_MS);
  story?.requestRefresh();
}

/** The scene must show a frame soon after it starts running, or the poster stays. */
function armFirstFrameCheck() {
  clearTimeout(firstFrameTimer);
  firstFrameTimer = window.setTimeout(() => {
    if (firstFrameSeen || !handle) return;
    // Not running (tab hidden, scrolled past the story): nothing to judge yet.
    if (document.hidden || !anchorVisible) return armFirstFrameCheck();
    sceneBlocked = 'no first frame';
    const reason = `no frame rendered within ${FIRST_FRAME_TIMEOUT_MS}ms of starting`;
    writeTierCache({ tier: 'poster', reason });
    teardownScene(reason);
  }, FIRST_FRAME_TIMEOUT_MS);
}

/**
 * Back to the poster. The context is kept by default (renderer.dispose() already
 * frees the GPU resources), so a later tier change can still rebuild on this canvas.
 */
function teardownScene(reason: string, { loseContext = false, immediate = false } = {}) {
  trial?.fail(reason);
  sceneToken++;
  atlasFetch = null;
  sceneLoading = false;
  clearTimeout(firstFrameTimer);
  clearTimeout(restoreTimer);
  const current = handle;
  handle = null;
  firstFrameSeen = false;
  stage()?.classList.remove('is-live');
  setWash(0, '');
  fallback(`poster: ${reason}`);
  teardownReason = reason;
  if (sceneBlocked) reportTier();
  // Let the canvas fade back to the poster before releasing the GPU resources
  // (at once when another scene is about to start on the same canvas).
  if (current && immediate) current.dispose({ loseContext });
  else if (current) setTimeout(() => current.dispose({ loseContext }), CROSSFADE_MS + 100);
}

function onContextLost() {
  error('WebGL context lost: showing the poster');
  stage()?.classList.remove('is-live');
  firstFrameSeen = false;
  clearTimeout(firstFrameTimer);
  clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(() => {
    sceneBlocked = 'context lost';
    const reason = `GPU context lost and not restored within ${CONTEXT_RESTORE_TIMEOUT_MS}ms`;
    writeTierCache({ tier: 'poster', reason });
    teardownScene(reason);
  }, CONTEXT_RESTORE_TIMEOUT_MS);
}

function onContextRestored() {
  clearTimeout(restoreTimer);
  info('WebGL context restored: rebuilding the scene');
  const old = handle;
  handle = null;
  sceneToken++;
  sceneLoading = false;
  // Keep the restored context: the rebuilt scene uses the same canvas.
  old?.dispose({ loseContext: false });
  void ensureScene();
}

/**
 * The fissure atlas (Medium, Lite), fetched alongside the scene chunk rather
 * than after it. The scene decodes it; a failed fetch leaves the flat glow.
 */
function fetchAtlas(): Promise<Blob> | undefined {
  if (!isSceneTier(tier) || !TIER_SETTINGS[tier].bakedFissures) return undefined;
  atlasFetch ??= fetch(FISSURE_ATLAS_URL).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mark('fissure atlas downloaded');
    return response.blob();
  });
  return atlasFetch;
}

async function ensureScene() {
  if (
    handle ||
    sceneLoading ||
    sceneBlocked ||
    !sceneAllowed() ||
    !sceneWanted() ||
    pending ||
    !isSceneTier(tier)
  )
    return;
  const target = canvas();
  if (!target) return;
  const token = ++sceneToken;
  sceneLoading = true;
  try {
    mark('scene chunk requested');
    const atlas = fetchAtlas();
    // Unhandled until the scene picks it up; never an unhandled rejection.
    atlas?.catch(() => {});
    if (DELAY_SCENE_MS > 0) await sleep(DELAY_SCENE_MS);
    const mod = await withTimeout(
      import('../scene/index'),
      SCENE_CHUNK_TIMEOUT_MS,
      'scene chunk load',
    );
    mark('scene chunk loaded');
    if (token !== sceneToken || !isSceneTier(tier)) return;

    // The gate's check runs at full scale, never above the tier being tested.
    const cache = trial ? null : readTierCache();
    const setup = mod.createScene(target, {
      tier,
      startScale: trial ? 1 : cache?.scale,
      ceiling: trial ? trial.tier : cache?.ceiling,
      upgraded: cache?.upgraded,
      atlas,
      fixedTier: forcedTier() !== null || KEEP_TIER,
      fixedScale: FIXED_SCALE,
      onFirstFrame,
      onPhase: (name, detail) => {
        mark(name, detail);
        if (name === 'L6 extras') trial?.built();
      },
      onIssue: (message) => error(message),
      onDecision: (message) => info(`scene: ${message}`),
      onSettle: (settled) =>
        writeTierCache({
          tier: settled.tier,
          scale: settled.scale,
          ceiling: settled.ceiling,
          upgraded: settled.upgraded,
        }),
      onTierChange: (next, reason) => setTier(next, reason, true),
      onContextLost,
      onContextRestored,
      onWash: setWash,
      gpuTiming: GPU_TIMING,
    });
    let created: SceneHandle;
    try {
      created = await withTimeout(setup, SCENE_SETUP_TIMEOUT_MS, 'scene setup');
    } catch (e) {
      // A setup that finishes after its timeout is released straight away.
      setup.then(
        (late) => late.dispose(),
        () => {},
      );
      throw e;
    }
    if (token !== sceneToken || !isSceneTier(tier)) {
      created.dispose();
      return;
    }
    handle = created;
    if (trial) created.holdController(true);
    info(`scene running: ${created.description}`);
    flushQueue();
    armFirstFrameCheck();
    sync();
  } catch (e) {
    if (token !== sceneToken) return;
    sceneBlocked = errorText(e);
    // Remembered for this session: returning home doesn't retry a failed context.
    writeTierCache({ tier: 'poster', reason: `scene unavailable: ${sceneBlocked}` });
    teardownScene(`scene unavailable: ${sceneBlocked}`);
  } finally {
    if (token === sceneToken) sceneLoading = false;
  }
}

// ── Story ─────────────────────────────────────────────────────────────────

/**
 * Mount the home page's scroll story as soon as its chunk is ready, in whatever
 * mode the current tier allows (it never waits for the GPU check); later tier
 * changes switch the mode in place. The chunk is requested after first paint so
 * it doesn't compete with the fonts the hero text needs for LCP.
 */
async function mountStory() {
  const root = document.querySelector<HTMLElement>('[data-story]');
  if (!root || storyRoot === root) return;
  storyRoot = root;
  const token = ++storyToken;
  await new Promise<void>((resolve) => afterFirstPaint(resolve));
  if (token !== storyToken) return;
  try {
    const mod = await withTimeout(import('./story'), STORY_CHUNK_TIMEOUT_MS, 'story chunk load');
    mark('story chunk loaded');
    if (token !== storyToken || !root.isConnected) return;
    const controller = await mod.mountStory(root, { mode: storyMode(), scene: bridge });
    if (token !== storyToken || !root.isConnected) {
      controller.unmount();
      return;
    }
    story = controller;
    countTriggers ??= mod.triggerCount;
    mark('story mounted', controller.mode);
    // The tier may have settled while the story was mounting.
    controller.setMode(storyMode());
    if (firstFrameSeen) controller.requestRefresh();
  } catch (e) {
    if (token === storyToken) error(`scroll story unavailable: ${errorText(e)}`);
  }
}

function unmountStory() {
  storyToken++;
  story?.unmount();
  story = null;
  storyRoot = null;
  queuedProgress = null;
}

// ── Content-page reveals ──────────────────────────────────────────────────

let pageReveals: RevealController | null = null;
let revealToken = 0;

/**
 * Content pages (anything without the home story) reveal their `[data-reveal]`
 * blocks with the same rules as the story. GSAP is only fetched when the page
 * has some, after first paint, and never with reduced motion. Scrolling stays
 * native (Lenis belongs to the home story).
 */
async function mountPageReveals() {
  const root = document.querySelector<HTMLElement>('main');
  if (!root || root.querySelector('[data-story]') || prefersReducedMotion()) return;
  if (!root.querySelector('[data-reveal]')) return;
  const token = ++revealToken;
  await new Promise<void>((resolve) => afterFirstPaint(resolve));
  if (token !== revealToken || !root.isConnected) return;
  try {
    const mod = await withTimeout(import('./reveal'), STORY_CHUNK_TIMEOUT_MS, 'reveal chunk load');
    if (token !== revealToken || !root.isConnected || prefersReducedMotion()) return;
    // The poster tier gets simple fades; anything else (or not yet known) the full reveals.
    const created = await mod.mountReveals(root, !pending && tier === 'poster' ? 'lite' : 'full');
    if (token !== revealToken || !root.isConnected) {
      created.destroy();
      return;
    }
    pageReveals = created;
    countTriggers ??= mod.triggerCount;
  } catch (e) {
    error(`reveals unavailable: ${errorText(e)}`);
  }
}

function unmountPageReveals() {
  revealToken++;
  pageReveals?.destroy();
  pageReveals = null;
}

/** ?debug: live ScrollTriggers on this page (set once GSAP has loaded). */
let countTriggers: (() => number) | null = null;

// ── Experience mode and the gate's check ──────────────────────────────────

/** First frame to the end of the build-up (L2–L6 fade in one after another). */
const TRIAL_BUILD_TIMEOUT_MS = 8000;
/** Chunk, setup and first frame together. */
const TRIAL_START_TIMEOUT_MS = SCENE_CHUNK_TIMEOUT_MS + FIRST_FRAME_TIMEOUT_MS;

interface Trial {
  tier: SceneTier;
  firstFrame(): void;
  built(): void;
  fail(reason: string): void;
}

export interface TrialHandle {
  tier: SceneTier;
  /** Resolves on the scene's first frame; rejects with the reason it couldn't start. */
  started: Promise<void>;
  /** Resolves once every layer is in (or after a timeout); rejects if it never started. */
  built: Promise<void>;
  /** Rejects if the scene is torn down while the check is still going. */
  failed: Promise<never>;
}

export interface ExperienceState {
  experience: Experience;
  entered: boolean;
}

function announceExperience() {
  applyRootState();
  document.dispatchEvent(
    new CustomEvent<ExperienceState>('monolith:experience', { detail: { experience, entered } }),
  );
}

export const getExperience = (): ExperienceState => ({ experience, entered });

/**
 * The 3D pipeline as it always worked: cheap rules, this session's memory,
 * otherwise the GPU check after first paint.
 */
function start3d() {
  const fast = detectTierFast();
  const cached = fast ? null : readTierCache();
  if (fast) setTier(fast.tier, fast.reason);
  else if (cached) setTier(cached.tier, `remembered this session: ${cached.reason}`);
  else {
    pending = true;
    detecting = false;
    mark('tier provisional', 'pending the GPU check');
    applyRootState();
  }
}

/** 3D mode can't continue (the device ended on the poster): back to 2D. */
function leaveExperience(reason: string) {
  experience = '2d';
  entered = false;
  // Reduced motion switched on doesn't forget the choice: it overrides it while it lasts.
  if (!/reduced motion/.test(reason)) storeExperience('2d');
  info(`3D mode left: ${reason}`);
  announceExperience();
}

/**
 * The gate's check at one tier: the scene starts behind the gate panel at the
 * Arrival view, with its controller held at full scale (src/lib/gate.ts
 * measures it with measureTrial()). Any running scene or check is replaced.
 */
export function runTrial(next: SceneTier): TrialHandle {
  endTrial('check restarted');
  let onFrame!: () => void;
  let onBuilt!: () => void;
  let rejectStart!: (error: Error) => void;
  let rejectFailed!: (error: Error) => void;
  const started = new Promise<void>((resolve, reject) => {
    onFrame = resolve;
    rejectStart = reject;
  });
  const done = new Promise<void>((resolve) => (onBuilt = resolve));
  const failed = new Promise<never>((_, reject) => (rejectFailed = reject));
  failed.catch(() => {});
  started.catch(() => {});
  const current: Trial = {
    tier: next,
    firstFrame: onFrame,
    built: onBuilt,
    fail: (reason) => {
      rejectStart(new Error(reason));
      rejectFailed(new Error(reason));
    },
  };
  trial = current;
  sceneBlocked = '';
  mark('gate check', next);
  setTier(next, `gate check at ${next}`);
  void ensureScene();
  story?.setMode(storyMode());
  sync();
  const timeout = window.setTimeout(() => {
    if (trial === current && !firstFrameSeen)
      teardownScene(`no frame within ${TRIAL_START_TIMEOUT_MS / 1000} s`, { immediate: true });
  }, TRIAL_START_TIMEOUT_MS);
  const clear = () => clearTimeout(timeout);
  started.then(clear, clear);
  const built = started.then(() =>
    Promise.race([
      done,
      sleep(TRIAL_BUILD_TIMEOUT_MS).then(() => mark('gate check', 'build-up timed out')),
    ]).then(() => {}),
  );
  built.catch(() => {});
  return { tier: next, started, built, failed };
}

/** The running check's frame intervals (ms) over `durationMs`, and the GPU's frame time if known. */
export async function measureTrial(
  durationMs: number,
): Promise<{ samples: number[]; gpu: number | null }> {
  const current = handle;
  if (!trial || !current) throw new Error('the check is not running');
  const samples = await current.measureFrames(durationMs);
  return { samples, gpu: current.gpuTimings()?.ms.frame ?? null };
}

/** Stop the check (failed, abandoned or restarted): back to the poster, still in 2D. */
export function endTrial(reason: string) {
  if (!trial) return;
  trial = null;
  if (handle || sceneLoading) teardownScene(reason, { immediate: true });
  setTier('poster', experience === '3d' && !gated ? reason : 'experience-2d');
  story?.setMode(storyMode());
  sync();
}

/** "Enter the stone": the check passed, so 3D mode starts here and is remembered. */
export function enterExperience(): boolean {
  const current = trial;
  if (!current || !handle || !firstFrameSeen) return false;
  trial = null;
  experience = '3d';
  entered = true;
  gated = false;
  storeExperience('3d');
  writeTierCache({
    tier: current.tier,
    reason: `passed the gate at ${current.tier}`,
    ceiling: current.tier,
  });
  handle.holdController(false);
  mark('3D mode entered', current.tier);
  announceExperience();
  story?.setMode(storyMode());
  story?.requestRefresh();
  sync();
  return true;
}

/** "Back to 2D": the scene stops, the choice is forgotten, the page stays as it is. */
export function exitExperience() {
  if (trial) endTrial('back to 2D');
  experience = '2d';
  entered = false;
  storeExperience('2d');
  gated = Boolean(document.querySelector('[data-gate]'));
  if (handle || sceneLoading) teardownScene('back to 2D');
  pending = false;
  setTier('poster', 'experience-2d');
  mark('3D mode left', 'back to 2D');
  announceExperience();
  story?.setMode(storyMode());
  sync();
}

// ── Pages ─────────────────────────────────────────────────────────────────

let navigatingTimer = 0;
let resumeTimer = 0;

/** Called on first load and after every ClientRouter navigation. */
function onPage() {
  const wasGated = gated;
  gated = Boolean(document.querySelector('[data-gate]')) && !entered;
  if (gated && experience === '3d' && !trial && (isSceneTier(tier) || pending)) {
    // Forced 3D (tests) reaching the gate: the scene waits for the gate like anyone's.
    if (handle || sceneLoading) teardownScene('awaiting the gate');
    pending = false;
    setTier('poster', 'awaiting the gate');
  } else if (wasGated && !gated && experience === '3d' && tierReason === 'awaiting the gate') {
    start3d();
  }
  applyRootState();
  // The stone's dip during a page change lifts as the new page settles.
  clearTimeout(resumeTimer);
  clearTimeout(navigatingTimer);
  navigatingTimer = window.setTimeout(() => stage()?.classList.remove('is-navigating'), 260);
  const declared = document.querySelector<HTMLElement>('main')?.dataset.sceneView;
  pageView = isPageView(declared) ? declared : null;
  const next = document.querySelector('[data-scene-anchor]');
  if (next !== anchor || !observer) {
    observer?.disconnect();
    observer = null;
    anchor = next;
    anchorVisible = false;
    if (anchor) {
      observer = new IntersectionObserver(
        (entries) => {
          anchorVisible = entries.some((entry) => entry.isIntersecting);
          sync();
        },
        { threshold: 0 },
      );
      observer.observe(anchor);
    }
  }
  if (sceneWanted()) {
    detect();
    recordPosterTier();
    void ensureScene();
  }
  applyView();
  sync();
  void mountStory();
  void mountPageReveals();
}

function bindPointer() {
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!handle || event.pointerType !== 'mouse' || !fine.matches) return;
      handle.setPointer(
        (event.clientX / window.innerWidth) * 2 - 1,
        -((event.clientY / window.innerHeight) * 2 - 1),
      );
    },
    { passive: true },
  );
  // Pointer left the window: move it far away so the stone cools.
  document.documentElement.addEventListener('pointerleave', () => handle?.setPointer(4, 4));
}

export function initSceneBoot() {
  if (started) return;
  started = true;
  mark('boot start');

  // The experience first. 2D (the default) settles the poster at once and runs
  // no WebGL code at all. 3D (entered at the gate, or forced with ?tier=) runs
  // the tier pipeline: cheap rules first, then this session's memory (so a new
  // page doesn't probe the GPU again); otherwise the GPU check after first paint.
  const ruledOut = experienceRuledOut();
  const forced = forcedTier();
  entered = !ruledOut && forced !== 'poster' && storedExperience() === '3d';
  experience = !ruledOut && (entered || isSceneTier(forced)) ? '3d' : '2d';
  gated = Boolean(document.querySelector('[data-gate]')) && !entered;
  if (experience === '3d' && !gated) start3d();
  else if (experience === '3d') setTier('poster', 'awaiting the gate');
  else
    setTier('poster', ruledOut ?? (forced === 'poster' ? 'forced with ?tier=' : 'experience-2d'));
  applyRootState();

  document.fonts?.ready.then(() => mark('fonts ready'));
  document.addEventListener('astro:after-swap', () => applyRootState());
  document.addEventListener('astro:page-load', onPage);
  document.addEventListener('astro:before-preparation', (event) => {
    navigationType = (event as Event & { navigationType: typeof navigationType }).navigationType;
    clearTimeout(navigatingTimer);
    stage()?.classList.add('is-navigating');
    // The new page never waits for the scene: rendering pauses (under the dip)
    // while the page is fetched and swapped, so a heavy frame can't hold up the
    // view transition's snapshot. onPage() resumes it; the timer is a safety
    // net for a navigation that is abandoned before it swaps.
    handle?.pause();
    clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(sync, 3000);
  });
  // Kill the story's triggers and scroll listeners before the page is swapped.
  document.addEventListener('astro:before-swap', (event) => {
    // Leaving the gate mid-check (or passed but not entered): the check ends here.
    endTrial('left the page during the check');
    stampIncoming(event);
    unmountStory();
    unmountPageReveals();
    // The new page arrives through a brief heat shimmer (High, Medium); back and
    // forward restore at once instead, and reduced motion never shimmers.
    if (navigationType !== 'traverse' && !prefersReducedMotion()) handle?.shimmer();
  });
  document.addEventListener('visibilitychange', sync);
  // The contact form's success: the core vein flares (High, Medium and Lite).
  document.addEventListener('monolith:flare', () => {
    if (!prefersReducedMotion()) handle?.flare();
  });

  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    if (!prefersReducedMotion()) return;
    pageReveals?.finish();
    endTrial('reduced motion switched on');
    setTier('poster', 'reduced motion switched on');
  });

  bindPointer();
  onLeave(reportTier);
  onPage();
  setSceneStats(() =>
    handle ? { gpu: handle.gpuTimings()?.ms ?? null, lines: handle.stats() } : null,
  );

  // ?debug: inspect boot state and simulate tier changes from tests or the console.
  if (DEBUG) {
    (window as unknown as { __monolith?: object }).__monolith = {
      state: () => ({
        tier: pending ? 'pending' : tier,
        experience,
        entered,
        gated,
        trial: trial?.tier ?? null,
        story: story?.mode ?? null,
        scene: handle ? handle.description : null,
        firstFrame: firstFrameSeen,
        cameraProgress: handle?.cameraProgress ?? null,
        queuedProgress,
        blocked: sceneBlocked || null,
        page: location.pathname,
        view: pageView,
        holding: handle?.holding ?? null,
        gliding: handle?.gliding ?? null,
        triggers: countTriggers?.() ?? 0,
        reveals: pageReveals?.pending ?? null,
      }),
      setTier: (next: QualityTier) => setTier(next, 'set from ?debug'),
      diagnostics: getDiagnostics,
    };
  }
}
