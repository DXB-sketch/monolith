/**
 * Scene boot: decides the quality tier, keeps the poster in charge until the
 * WebGL scene has rendered a frame, and owns the scene's lifecycle.
 *
 * This file is in the initial bundle, so it never imports Three.js. The scene
 * is a separate chunk loaded with a dynamic import after first paint, and only
 * for the High and Medium tiers on pages that mark a scene region with
 * `data-scene-anchor`.
 *
 * It also mounts the home page's scroll story (another lazy chunk) and passes
 * its progress to the scene. The scene loads after first paint, so the latest
 * progress and story map are queued and applied the moment it exists.
 */
import {
  detectTier,
  detectTierFast,
  forcedTier,
  prefersReducedMotion,
  type QualityTier,
  type SceneTier,
} from '../scene/quality';
import type { SceneHandle, StoryMap } from '../scene/index';
import type { StoryBridge, StoryMode } from './story';

let tier: QualityTier = 'off';
/** True until the GPU has been probed (deferred until a scene page has painted). */
let pending = true;
let handle: SceneHandle | null = null;
let loading = false;
let anchor: Element | null = null;
let anchorVisible = false;
let observer: IntersectionObserver | null = null;
let started = false;

// Queued for the scene: it may not exist yet when the story first reports.
let queuedProgress: number | null = null;
let queuedMap: StoryMap | null = null;

let resolveTier: (tier: QualityTier) => void = () => {};
/** Resolves once the tier is final (after the deferred GPU check, if one runs). */
const tierKnown = new Promise<QualityTier>((resolve) => (resolveTier = resolve));

let story: { unmount(): void } | null = null;
let storyRoot: Element | null = null;

const html = document.documentElement;
const stage = () => document.querySelector<HTMLElement>('[data-scene-stage]');
const canvas = () => document.querySelector<HTMLCanvasElement>('[data-scene-canvas]');
const isSceneTier = (t: QualityTier): t is SceneTier => t === 'high' || t === 'medium';

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

function settleTier(next: QualityTier) {
  tier = next;
  pending = false;
  applyRootState();
  resolveTier(next);
}

/** The scroll story talks to the scene only through this bridge. */
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

function teardown(nextTier: QualityTier) {
  resolveTier(nextTier);
  tier = nextTier;
  pending = false;
  applyRootState();
  const current = handle;
  handle = null;
  stage()?.classList.remove('is-live');
  // Let the canvas fade back to the poster before releasing the GPU resources.
  if (current) setTimeout(() => current.dispose(), 1300);
}

function load() {
  if (handle || loading) return;
  if (!pending && !isSceneTier(tier)) return;
  loading = true;
  afterFirstPaint(async () => {
    if (pending) settleTier(await detectTier());
    const target = canvas();
    if (!target || !isSceneTier(tier)) {
      loading = false;
      return;
    }
    try {
      const { createScene } = await import('../scene/index');
      handle = await createScene(target, {
        tier,
        fixedTier: forcedTier() !== null,
        onFirstFrame: () => stage()?.classList.add('is-live'),
        onTierChange: (next) => {
          if (isSceneTier(next)) {
            tier = next;
            applyRootState();
          } else {
            teardown(next);
          }
        },
      });
      // Reduced motion may have been switched on while the chunk was loading.
      if (!isSceneTier(tier)) teardown(tier);
      flushQueue();
      sync();
    } catch (error) {
      console.warn('[monolith] Scene unavailable, keeping the poster.', error);
      teardown('low');
    } finally {
      loading = false;
    }
  });
}

function storyMode(): StoryMode {
  if (prefersReducedMotion() || tier === 'off') return 'static';
  return tier === 'low' ? 'lite' : 'full';
}

/** Mount the home page's scroll story once the tier is known. */
async function mountStory() {
  const root = document.querySelector<HTMLElement>('[data-story]');
  if (!root || storyRoot === root) return;
  storyRoot = root;
  await tierKnown;
  if (storyRoot !== root || !root.isConnected) return;
  const { mountStory: mount } = await import('./story');
  if (storyRoot !== root || !root.isConnected) return;
  story = await mount(root, { mode: storyMode(), scene: bridge });
  // Navigated away while mounting: undo straight away.
  if (storyRoot !== root) unmountStory();
}

function unmountStory() {
  story?.unmount();
  story = null;
  storyRoot = null;
  queuedProgress = null;
}

/** Called on first load and after every ClientRouter navigation. */
function onPage() {
  applyRootState();
  const next = document.querySelector('[data-scene-anchor]');
  if (next === anchor && observer) return;

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
    load();
  }
  sync();
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

  const fast = detectTierFast();
  if (fast) settleTier(fast);
  applyRootState();

  document.addEventListener('astro:after-swap', () => applyRootState());
  document.addEventListener('astro:page-load', onPage);
  // Kill the home story's triggers and scroll listeners before the page is swapped.
  document.addEventListener('astro:before-swap', (event) => {
    stampIncoming(event);
    unmountStory();
  });
  document.addEventListener('visibilitychange', sync);

  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    if (prefersReducedMotion()) teardown('off');
    // Remount the story in the mode that now applies.
    if (storyRoot) {
      unmountStory();
      void mountStory();
    }
  });

  bindPointer();
  onPage();
}
