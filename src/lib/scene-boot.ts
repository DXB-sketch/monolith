/**
 * Scene boot: decides the quality tier, keeps the poster in charge until the
 * WebGL scene has rendered a frame, and owns the scene's lifecycle.
 *
 * This file is in the initial bundle, so it never imports Three.js. The scene
 * is a separate chunk loaded with a dynamic import after first paint, and only
 * for the High and Medium tiers on pages that mark a scene region with
 * `data-scene-anchor`.
 */
import {
  detectTier,
  detectTierFast,
  prefersReducedMotion,
  type QualityTier,
  type SceneTier,
} from '../scene/quality';
import type { SceneHandle } from '../scene/index';

let tier: QualityTier = 'off';
/** True until the GPU has been probed (deferred until a scene page has painted). */
let pending = true;
let handle: SceneHandle | null = null;
let loading = false;
let anchor: Element | null = null;
let anchorVisible = false;
let observer: IntersectionObserver | null = null;
let started = false;

const html = document.documentElement;
const stage = () => document.querySelector<HTMLElement>('[data-scene-stage]');
const canvas = () => document.querySelector<HTMLCanvasElement>('[data-scene-canvas]');
const isSceneTier = (t: QualityTier): t is SceneTier => t === 'high' || t === 'medium';

/** ClientRouter replaces <html> attributes on navigation, so state is re-applied after swaps. */
function applyRootState() {
  html.classList.add('js');
  if (pending) delete html.dataset.tier;
  else html.dataset.tier = tier;
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

function teardown(nextTier: QualityTier) {
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
    if (pending) {
      tier = await detectTier();
      pending = false;
      applyRootState();
    }
    const target = canvas();
    if (!target || !isSceneTier(tier)) {
      loading = false;
      return;
    }
    try {
      const { createScene } = await import('../scene/index');
      handle = await createScene(target, {
        tier,
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
      sync();
    } catch (error) {
      console.warn('[monolith] Scene unavailable, keeping the poster.', error);
      teardown('low');
    } finally {
      loading = false;
    }
  });
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
  if (fast) {
    tier = fast;
    pending = false;
  }
  applyRootState();

  document.addEventListener('astro:after-swap', applyRootState);
  document.addEventListener('astro:page-load', onPage);
  document.addEventListener('visibilitychange', sync);

  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    if (prefersReducedMotion()) teardown('off');
  });

  bindPointer();
  onPage();
}
