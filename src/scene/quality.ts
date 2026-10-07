/**
 * Quality tiers (Phase 2.5). This module must stay tiny and must never import
 * Three.js: it runs in the initial bundle to decide whether the scene loads at all.
 *
 *   high    discrete GPUs, Apple M-series: the full procedural scene
 *   medium  strong integrated GPUs, recent flagship phones: baked fissure
 *           field, lighter post-processing
 *   lite    any other hardware-accelerated WebGL2 device: everything baked, no
 *           post-processing chain, reduced resolution, 30 fps
 *   poster  only reduced motion, save-data, no WebGL2, a software renderer, a
 *           failed WebGL context, or Lite unable to hold ~24 fps at half resolution
 *
 * A device has to prove it is too weak to get the poster: unknown signals are
 * unknown, never weak. The running scene adjusts from there (resolution first,
 * then extras, then one tier at a time; upgrades too).
 */
import { setSignal, withTimeout } from '../lib/diagnostics';

export type QualityTier = 'high' | 'medium' | 'lite' | 'poster';
export type SceneTier = Exclude<QualityTier, 'poster'>;

export interface TierSettings {
  /** Device pixel ratio cap (the resolution scale applies on top). */
  dpr: number;
  /** Monolith box subdivisions (x, y, z). */
  monolithSegments: [number, number, number];
  /** Terrain grid resolution per side (denser near the stone). */
  terrainSegments: number;
  embers: number;
  /** Fissures read from the baked atlas instead of computed per pixel. */
  bakedFissures: boolean;
  /** High only: fissure noise octaves (main veins, branches, hairline crazing). */
  fissureOctaves: 2 | 3;
  /** Monolith surface lighting per vertex instead of per pixel. */
  vertexLighting: boolean;
  /** Fog evaluated per vertex instead of per pixel. */
  vertexFog: boolean;
  /** Lava crust, ground detail and bank cracks from small tiling textures. */
  bakedDetail: boolean;
  /** Sky gradient per vertex, one smoke layer. */
  liteSky: boolean;
  /** Post-processing chain: full (bloom, MSAA), light (cheaper bloom), none (Lite). */
  post: 'full' | 'light' | 'none';
  bloomLevels: number;
  /** Bloom's internal resolution, relative to the canvas. */
  bloomResolution: number;
  /** Multisampling on the main render target. */
  msaa: number;
  /** Soft emissive halos and glow sprites stand in for bloom (no post chain). */
  fakeBloom: boolean;
  /** The frame rate the resolution controller holds (and Lite is capped at). */
  fps: 60 | 30;
}

export const TIER_SETTINGS: Record<SceneTier, TierSettings> = {
  high: {
    dpr: 2,
    monolithSegments: [40, 128, 20],
    terrainSegments: 288,
    embers: 2000,
    bakedFissures: false,
    fissureOctaves: 3,
    vertexLighting: false,
    vertexFog: false,
    bakedDetail: false,
    liteSky: false,
    post: 'full',
    bloomLevels: 8,
    bloomResolution: 0.5,
    msaa: 4,
    fakeBloom: false,
    fps: 60,
  },
  medium: {
    dpr: 1.5,
    monolithSegments: [20, 64, 10],
    terrainSegments: 160,
    embers: 600,
    bakedFissures: true,
    fissureOctaves: 2,
    vertexLighting: false,
    vertexFog: false,
    bakedDetail: true,
    liteSky: false,
    post: 'light',
    bloomLevels: 5,
    bloomResolution: 0.35,
    msaa: 0,
    fakeBloom: false,
    fps: 60,
  },
  lite: {
    dpr: 1.25,
    monolithSegments: [16, 48, 8],
    terrainSegments: 112,
    embers: 200,
    bakedFissures: true,
    fissureOctaves: 2,
    vertexLighting: true,
    vertexFog: true,
    bakedDetail: true,
    liteSky: true,
    post: 'none',
    bloomLevels: 0,
    bloomResolution: 0,
    msaa: 0,
    fakeBloom: true,
    fps: 30,
  },
};

export const SCENE_TIERS: SceneTier[] = ['lite', 'medium', 'high'];

/** The baked fissure atlas (scripts/bake-fissures.ts): fetched alongside the scene chunk. */
export const FISSURE_ATLAS_URL = '/textures/fissures-planes.avif';

export function lowerTier(tier: SceneTier): SceneTier | null {
  return SCENE_TIERS[SCENE_TIERS.indexOf(tier) - 1] ?? null;
}

export function higherTier(tier: SceneTier): SceneTier | null {
  return SCENE_TIERS[SCENE_TIERS.indexOf(tier) + 1] ?? null;
}

export const isSceneTier = (tier: QualityTier | null | undefined): tier is SceneTier =>
  tier === 'high' || tier === 'medium' || tier === 'lite';

interface NavigatorHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

interface GpuInfo {
  /** WebGL2 is available. */
  available: boolean;
  /** Software rendering (SwiftShader, llvmpipe, Microsoft Basic Render Driver…). */
  software: boolean;
  /** Renderer string or WebGPU vendor/architecture, for classification. */
  renderer: string;
  source: 'webgpu' | 'webgl';
}

interface WebGpuAdapter {
  isFallbackAdapter?: boolean;
  info?: {
    vendor?: string;
    architecture?: string;
    description?: string;
    isFallbackAdapter?: boolean;
  };
}

interface WebGpu {
  requestAdapter(options?: { powerPreference?: string }): Promise<WebGpuAdapter | null>;
}

/** `requestAdapter()` never resolves on some mobile browsers: give it this long. */
export const WEBGPU_TIMEOUT_MS = 1500;
/** The worker's WebGL probe; past this, the main thread tries. */
const WEBGL_WORKER_TIMEOUT_MS = 2000;

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
/** Discrete GPUs and Apple M-series. */
const HIGH_GPU =
  /nvidia|geforce|quadro|\brtx\b|\bgtx\b|radeon\s*(\(tm\)\s*)?(rx|pro|vii|r9)\b|arc\(tm\)\s*a\d{3}|\barc a\d{3}|apple m\d/i;
/** Strong integrated GPUs and recent flagship phone GPUs. */
const MEDIUM_GPU =
  /iris\(r\)\s*xe|iris xe|intel\(r\) arc\(tm\) graphics|radeon\s*(\(tm\)\s*)?\d{3}m|adreno\s*(\(tm\)\s*)?(7\d\d|8\d\d)|mali-g7[1-9]|mali-g7\d\d|mali-g9\d\d|immortalis|xclipse/i;

const touchDevice = () => matchMedia('(pointer: coarse)').matches;

/**
 * WebGPU's adapter, asynchronously (no main-thread cost). Only decisive
 * answers are used: a software fallback adapter, NVIDIA, or Apple silicon on
 * a Mac. Anything else (absent, null, timed out, ambiguous) returns null and
 * the WebGL renderer string decides.
 */
async function probeWebGpu(): Promise<GpuInfo | null> {
  const gpu = (navigator as Navigator & { gpu?: WebGpu }).gpu;
  if (!gpu) return null;
  try {
    const adapter = await withTimeout(
      gpu.requestAdapter({ powerPreference: 'high-performance' }),
      WEBGPU_TIMEOUT_MS,
      'WebGPU adapter request',
    );
    if (!adapter) return null;
    const info = adapter.info ?? {};
    const renderer = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
    if (info.isFallbackAdapter ?? adapter.isFallbackAdapter)
      return { available: true, software: true, renderer, source: 'webgpu' };
    if (/nvidia/i.test(info.vendor ?? '') || (/apple/i.test(info.vendor ?? '') && !touchDevice()))
      return { available: true, software: false, renderer, source: 'webgpu' };
    return null;
  } catch {
    return null;
  }
}

/** Synchronous WebGL2 probe. Blocks briefly while the context is created. */
function probeWebGlHere(): GpuInfo {
  try {
    const canvas = document.createElement('canvas');
    // No failIfMajorPerformanceCaveat: it makes creation several times slower, and
    // software renderers are caught by name below.
    const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl) return { available: false, software: false, renderer: '(no WebGL2)', source: 'webgl' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { available: true, software: SOFTWARE_GPU.test(renderer), renderer, source: 'webgl' };
  } catch {
    return { available: false, software: false, renderer: '(WebGL2 probe threw)', source: 'webgl' };
  }
}

/** Runs in a worker: a WebGL2 context on an OffscreenCanvas, its renderer string. */
const WORKER_PROBE = `onmessage = () => {
  let renderer = null;
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { powerPreference: 'high-performance' });
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) {}
  postMessage(renderer);
};`;

/**
 * The WebGL2 probe, off the main thread where the browser allows it: creating
 * a context can block for tens of milliseconds on a GPU, and for seconds on a
 * software renderer. Falls back to the main thread if the worker can't create
 * one (no OffscreenCanvas WebGL in older Safari), which proves nothing.
 */
async function probeWebGl(): Promise<GpuInfo> {
  if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
    let worker: Worker | null = null;
    let url = '';
    try {
      url = URL.createObjectURL(new Blob([WORKER_PROBE], { type: 'text/javascript' }));
      worker = new Worker(url);
      const renderer = await withTimeout(
        new Promise<string | null>((resolve, reject) => {
          worker!.onmessage = (event) => resolve(event.data as string | null);
          worker!.onerror = () => reject(new Error('worker failed'));
          worker!.postMessage(0);
        }),
        WEBGL_WORKER_TIMEOUT_MS,
        'WebGL probe (worker)',
      );
      if (renderer !== null)
        return {
          available: true,
          software: SOFTWARE_GPU.test(renderer),
          renderer,
          source: 'webgl',
        };
    } catch {
      // Fall through to the main-thread probe.
    } finally {
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
    }
  }
  return probeWebGlHere();
}

/** Legacy names from Phase 1–2 still work: low and off both mean the poster. */
const FORCED: Record<string, QualityTier> = {
  high: 'high',
  medium: 'medium',
  lite: 'lite',
  poster: 'poster',
  low: 'poster',
  off: 'poster',
};

/** Read a forced tier from `?tier=` for testing and poster capture. */
export function forcedTier(): QualityTier | null {
  const value = new URLSearchParams(location.search).get('tier');
  return (value && FORCED[value]) || null;
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function saveData(): boolean {
  return (navigator as NavigatorHints).connection?.saveData === true;
}

/**
 * Cheap, synchronous rules only: forced tier, reduced motion, save-data.
 * Returns a final tier when these settle it, or null when the GPU decides.
 * Safe to call before first paint.
 */
export function detectTierFast(): { tier: QualityTier; reason: string } | null {
  const forced = forcedTier();
  if (prefersReducedMotion()) return { tier: 'poster', reason: 'prefers-reduced-motion' };
  if (forced) return { tier: forced, reason: 'forced with ?tier=' };
  if (saveData()) return { tier: 'poster', reason: 'save-data' };
  return null;
}

/** Whether a live scene is still possible: decides if the scene chunk is worth prefetching. */
export function sceneStillPossible(): boolean {
  const fast = detectTierFast();
  return fast === null || isSceneTier(fast.tier);
}

// ── Session cache ────────────────────────────────────────────────────────

const CACHE_KEY = 'monolith:tier';
const CACHE_VERSION = 2;

/**
 * What this tab remembers (sessionStorage), so returning home doesn't probe
 * again:
 *   tier     the settled tier
 *   reason   why (shown in the ?fps overlay)
 *   ceiling  the highest tier this session may still try: lowered when a
 *            tier fails, so the scene never upgrades back into it
 *   upgraded tiers already reached by an upgrade (each only once per session)
 *   scale    the last resolution scale, to start from
 *   gpu      the renderer string the decision was based on
 * Ignored when ?tier= forces a tier, and overridden by reduced motion and
 * save-data. Dropped when CACHE_VERSION changes or the tab closes.
 */
export interface TierCache {
  v: number;
  tier: QualityTier;
  reason: string;
  ceiling: SceneTier | 'poster';
  upgraded: SceneTier[];
  scale: number;
  gpu: string;
}

export function readTierCache(): TierCache | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as TierCache;
    if (cache.v !== CACHE_VERSION || !(cache.tier in FORCED)) return null;
    return cache;
  } catch {
    return null;
  }
}

export function writeTierCache(patch: Partial<Omit<TierCache, 'v'>>) {
  if (forcedTier()) return;
  try {
    const current = readTierCache();
    const next: TierCache = {
      v: CACHE_VERSION,
      tier: 'lite',
      reason: '',
      ceiling: 'high',
      upgraded: [],
      scale: 1,
      gpu: '',
      ...current,
      ...patch,
    };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode, quotas): the next visit simply probes again.
  }
}

// ── The decision ─────────────────────────────────────────────────────────

/** Tier from a renderer string. Unclassified hardware gets Lite, never the poster. */
function classify(renderer: string): SceneTier {
  if (HIGH_GPU.test(renderer)) return 'high';
  // Apple silicon: "Apple M1" in Chrome; Safari only says "Apple GPU". On a
  // Mac (no touch) that is M-series or a recent AMD Mac: High. iPhones and
  // iPads start on Lite and upgrade if they hold the frame budget.
  if (/apple/i.test(renderer) && !touchDevice()) return 'high';
  if (MEDIUM_GPU.test(renderer)) return 'medium';
  return 'lite';
}

/**
 * The full decision: cheap rules, then the session cache, then the GPU.
 * WebGPU's adapter first (asynchronous; 1.5 s timeout), then a WebGL2 probe
 * in a worker (main thread only where workers can't create a context).
 * Call it after first paint, and only on pages that show the scene. Every
 * signal read is recorded for the ?fps overlay.
 */
export async function detectTier(): Promise<{ tier: QualityTier; reason: string }> {
  const nav = navigator as NavigatorHints;
  const coarse = touchDevice();
  setSignal(
    'device memory',
    typeof nav.deviceMemory === 'number' ? `${nav.deviceMemory} GB` : 'unknown',
  );
  setSignal(
    'cores',
    navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'unknown',
  );
  setSignal('dpr', String(window.devicePixelRatio || 1));
  setSignal('screen', `${screen.width}×${screen.height}${coarse ? ' touch' : ''}`);

  const fast = detectTierFast();
  if (fast) return fast;

  const cached = readTierCache();
  if (cached) {
    setSignal('gpu', `${cached.gpu || '(cached)'} (from this session)`);
    return { tier: cached.tier, reason: `remembered this session: ${cached.reason}` };
  }

  const gpu = (await probeWebGpu()) ?? (await probeWebGl());
  setSignal('gpu', `${gpu.source}: ${gpu.renderer || '(not reported)'}`);
  let result: { tier: QualityTier; reason: string };
  if (!gpu.available) result = { tier: 'poster', reason: 'no WebGL2' };
  else if (gpu.software) result = { tier: 'poster', reason: `software renderer (${gpu.renderer})` };
  else {
    const tier = classify(gpu.renderer);
    result = { tier, reason: `${gpu.renderer || 'unclassified GPU'} → ${tier}` };
  }
  writeTierCache({ tier: result.tier, reason: result.reason, gpu: gpu.renderer });
  return result;
}
