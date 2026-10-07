/**
 * Scene boot: decides the quality tier, keeps the poster in charge until the
 * WebGL scene has rendered a frame, and owns the scene's lifecycle.
 *
 * This file is in the initial bundle, so it never imports Three.js. The scene
 * is a separate chunk, executed only for the live tiers (High, Medium, Lite) on
 * pages that mark a scene region with `data-scene-anchor`.
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
  FISSURE_ATLAS_URL,
  forcedTier,
  isSceneTier,
  prefersReducedMotion,
  readTierCache,
  sceneStillPossible,
  TIER_SETTINGS,
  writeTierCache,
  type QualityTier,
} from '../scene/quality';
import type { SceneHandle, StoryMap } from '../scene/index';
import type { StoryBridge, StoryController, StoryMode } from './story';

/** Upper bounds for each boot step, so no path can hang. */
const TIER_TIMEOUT_MS = 4000;
const STORY_CHUNK_TIMEOUT_MS = 20000;
const SCENE_CHUNK_TIMEOUT_MS = 30000;
const SCENE_SETUP_TIMEOUT_MS = 45000;
const FIRST_FRAME_TIMEOUT_MS = 8000;
const CONTEXT_RESTORE_TIMEOUT_MS = 10000;
/** After `load`, how long the GPU check may run before the scene chunk is prefetched. */
const PREFETCH_DELAY_MS = 1000;
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

let tier: QualityTier = 'poster';
/** True until the GPU has been checked (after first paint, on scene pages only). */
let pending = true;
let detecting = false;
let prefetched = false;
/** Why the tier is what it is, for the poster's recorded reason. */
let tierReason = '';
let posterReasonRecorded = false;

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

function sync() {
  const el = stage();
  const active = Boolean(anchor) && anchorVisible;
  el?.classList.toggle('is-dormant', !active);
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
  if (pending) return 'pending';
  return tier === 'poster' ? 'lite' : 'full';
}

// ── Tier ──────────────────────────────────────────────────────────────────

/**
 * The single place the tier changes. Starts or stops the scene and re-modes the
 * story. `fromScene`: the running scene already switched itself (in place).
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
  } else if (handle || sceneLoading) {
    teardownScene(`tier ${next}: ${reason}`);
  } else {
    recordPosterTier();
  }
  if (next === 'poster') document.dispatchEvent(new CustomEvent('monolith:poster'));
  story?.setMode(storyMode());
}

/** On a scene page whose tier rules the scene out, say why the poster is showing (once). */
function recordPosterTier() {
  if (!anchor || pending || isSceneTier(tier) || posterReasonRecorded) return;
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
}

function setWash(amount: number, css: string) {
  const layer = washLayer();
  if (!layer) return;
  layer.style.backgroundColor = css;
  layer.style.opacity = amount > 0 ? String(amount) : '0';
}

function onFirstFrame() {
  firstFrameSeen = true;
  clearTimeout(firstFrameTimer);
  mark('first frame');
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
    teardownScene(`no frame rendered within ${FIRST_FRAME_TIMEOUT_MS}ms of starting`);
  }, FIRST_FRAME_TIMEOUT_MS);
}

/**
 * Back to the poster. The context is kept by default (renderer.dispose() already
 * frees the GPU resources), so a later tier change can still rebuild on this canvas.
 */
function teardownScene(reason: string, { loseContext = false } = {}) {
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
  // Let the canvas fade back to the poster before releasing the GPU resources.
  if (current) setTimeout(() => current.dispose({ loseContext }), CROSSFADE_MS + 100);
}

function onContextLost() {
  error('WebGL context lost: showing the poster');
  stage()?.classList.remove('is-live');
  firstFrameSeen = false;
  clearTimeout(firstFrameTimer);
  clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(() => {
    sceneBlocked = 'context lost';
    teardownScene(`GPU context lost and not restored within ${CONTEXT_RESTORE_TIMEOUT_MS}ms`);
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
  if (handle || sceneLoading || sceneBlocked || !anchor || pending || !isSceneTier(tier)) return;
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

    const cache = readTierCache();
    const setup = mod.createScene(target, {
      tier,
      startScale: cache?.scale,
      ceiling: cache?.ceiling,
      upgraded: cache?.upgraded,
      atlas,
      fixedTier: forcedTier() !== null || KEEP_TIER,
      fixedScale: FIXED_SCALE,
      onFirstFrame,
      onPhase: (name, detail) => mark(name, detail),
      onIssue: (message) => error(message),
      onDecision: (message) => info(`scene: ${message}`),
      onSettle: (settled) =>
        writeTierCache({
          tier: settled.tier,
          scale: settled.scale,
          ceiling: settled.ceiling,
          upgraded: settled.upgraded,
        }),
      onTierChange: (next, reason) => setTier(next, reason, isSceneTier(next)),
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

// ── Pages ─────────────────────────────────────────────────────────────────

/** Called on first load and after every ClientRouter navigation. */
function onPage() {
  applyRootState();
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
      detect();
      recordPosterTier();
      void ensureScene();
    }
    sync();
  }
  void mountStory();
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

  // Cheap rules first, then this session's memory (so returning home doesn't
  // probe the GPU again); otherwise the GPU check runs after first paint.
  const fast = detectTierFast();
  const cached = fast ? null : readTierCache();
  if (fast) setTier(fast.tier, fast.reason);
  else if (cached) setTier(cached.tier, `remembered this session: ${cached.reason}`);
  else mark('tier provisional', 'pending the GPU check');
  applyRootState();

  document.fonts?.ready.then(() => mark('fonts ready'));
  document.addEventListener('astro:after-swap', () => applyRootState());
  document.addEventListener('astro:page-load', onPage);
  // Kill the home story's triggers and scroll listeners before the page is swapped.
  document.addEventListener('astro:before-swap', (event) => {
    stampIncoming(event);
    unmountStory();
  });
  document.addEventListener('visibilitychange', sync);

  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    if (prefersReducedMotion()) setTier('poster', 'reduced motion switched on');
  });

  bindPointer();
  onPage();
  setSceneStats(() =>
    handle ? { gpu: handle.gpuTimings()?.ms ?? null, lines: handle.stats() } : null,
  );

  // ?debug: inspect boot state and simulate tier changes from tests or the console.
  if (DEBUG) {
    (window as unknown as { __monolith?: object }).__monolith = {
      state: () => ({
        tier: pending ? 'pending' : tier,
        story: story?.mode ?? null,
        scene: handle ? handle.description : null,
        firstFrame: firstFrameSeen,
        cameraProgress: handle?.cameraProgress ?? null,
        queuedProgress,
        blocked: sceneBlocked || null,
      }),
      setTier: (next: QualityTier) => setTier(next, 'set from ?debug'),
      diagnostics: getDiagnostics,
    };
  }
}
