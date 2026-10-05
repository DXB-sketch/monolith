/**
 * Quality tiers (SCENE_SPEC.md). This module must stay tiny and must never import
 * Three.js: it runs in the initial bundle to decide whether the scene loads at all.
 */
import { setSignal, withTimeout } from '../lib/diagnostics';

export type QualityTier = 'high' | 'medium' | 'low' | 'off';
export type SceneTier = Extract<QualityTier, 'high' | 'medium'>;

export interface TierSettings {
  /** Device pixel ratio cap. */
  dpr: number;
  /** Monolith box subdivisions (x, y, z). */
  monolithSegments: [number, number, number];
  /** Terrain grid resolution per side. */
  terrainSegments: number;
  embers: number;
  /** Fissure noise octaves (main veins, branches, micro cracks). */
  fissureOctaves: 2 | 3;
  /** Heat-haze distortion: reserved for Phase 4, High only. */
  haze: boolean;
  /** Bloom mip levels. */
  bloomLevels: number;
  /** Multisampling on the main render target. */
  msaa: number;
}

export const TIER_SETTINGS: Record<SceneTier, TierSettings> = {
  high: {
    dpr: 2,
    monolithSegments: [40, 128, 20],
    terrainSegments: 288,
    embers: 2000,
    fissureOctaves: 3,
    haze: true,
    bloomLevels: 8,
    msaa: 4,
  },
  medium: {
    dpr: 1.5,
    monolithSegments: [20, 64, 10],
    terrainSegments: 160,
    embers: 600,
    fissureOctaves: 2,
    haze: false,
    bloomLevels: 6,
    msaa: 0,
  },
};

/** Frame-time thresholds (ms) for the check after the first frame (30 warm-up frames, then 2 s sampled): above this, drop one tier. */
export const DOWNGRADE_FRAME_MS: Record<SceneTier, number> = {
  high: 1000 / 45,
  medium: 1000 / 26,
};

const TIERS: QualityTier[] = ['off', 'low', 'medium', 'high'];

export function lowerTier(tier: QualityTier): QualityTier {
  return TIERS[Math.max(0, TIERS.indexOf(tier) - 1)] ?? 'off';
}

interface NavigatorHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

interface GpuInfo {
  /** WebGL2 (or a WebGPU hardware adapter, which implies it) is available. */
  available: boolean;
  /** Software rendering, or no usable hardware adapter. */
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

/**
 * Asynchronous GPU check via WebGPU's adapter: it never blocks the main thread,
 * unlike creating a WebGL context. Returns null when WebGPU can't answer (absent,
 * no adapter on desktop Linux, an error, or the timeout), so the WebGL probe runs.
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
    if (!adapter) {
      // Desktop Linux Chrome may simply not ship WebGPU yet: let WebGL decide.
      // On phones, no adapter means an unsupported or blocklisted GPU.
      const ua = navigator.userAgent;
      if (/Linux/.test(ua) && !/Android/.test(ua)) return null;
      return { available: true, software: true, renderer: '(no WebGPU adapter)', source: 'webgpu' };
    }
    const info = adapter.info ?? {};
    const software = Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter);
    const renderer = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
    return { available: true, software, renderer, source: 'webgpu' };
  } catch {
    return null;
  }
}

/** Synchronous WebGL2 probe. Blocks briefly while the context is created. */
function probeWebGl(): GpuInfo {
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

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
/** Old or entry-level mobile GPUs (WebGL renderer strings and WebGPU architectures): poster only. */
const WEAK_GPU =
  /mali-[t4]|mali-g(31|51|52)\b|adreno \(tm\) [2-5]\d\d|adreno [2-5]\d\d|adreno-[2-5]|midgard|utgard|powervr|sgx|intel.*gma/i;
/** Phones, tablets and older integrated laptop GPUs: the lighter scene. */
const MID_GPU =
  /mali|adreno|qualcomm|arm|apple gpu|apple a\d|apple|xclipse|samsung|immortalis|maleoon|imagination|intel.*hd graphics/i;

/** Read a forced tier from `?tier=` for testing and poster capture. */
export function forcedTier(): QualityTier | null {
  const value = new URLSearchParams(location.search).get('tier');
  return value && (TIERS as string[]).includes(value) ? (value as QualityTier) : null;
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Device memory in GB, or null when the browser doesn't say (Safari and Firefox
 * never do). Unknown is never treated as low.
 */
function deviceMemory(): number | null {
  const value = (navigator as NavigatorHints).deviceMemory;
  return typeof value === 'number' && value > 0 ? value : null;
}

/**
 * Logical cores, or null when unknown. Safari caps this value for privacy, so it
 * is never used to rule a device down to Low, only to choose Medium over High.
 */
function cores(): number | null {
  const value = navigator.hardwareConcurrency;
  return typeof value === 'number' && value > 0 ? value : null;
}

/**
 * Cheap, synchronous signals only: forced tier, reduced motion, save-data, slow
 * network and (known) very low memory. Returns a final tier when these settle
 * it, or null when the GPU has to be probed. Safe to call before first paint.
 */
export function detectTierFast(): QualityTier | null {
  const forced = forcedTier();
  const reduced = prefersReducedMotion();
  if (forced) return reduced && forced !== 'off' ? 'off' : forced;
  if (reduced) return 'off';

  const nav = navigator as NavigatorHints;
  const memory = deviceMemory();
  const saveData = nav.connection?.saveData === true;
  const slowNet = /(^|-)2g$/.test(nav.connection?.effectiveType ?? '');
  if (saveData || slowNet || (memory !== null && memory <= 2)) return 'low';
  return null;
}

/** Whether a scene tier is still possible: decides if the scene chunk is worth prefetching. */
export function sceneStillPossible(): boolean {
  const fast = detectTierFast();
  return fast === null || fast === 'high' || fast === 'medium';
}

/**
 * The full decision: cheap signals, then the GPU. Uses WebGPU's adapter where
 * available (asynchronous, no main-thread cost; 1.5 s timeout); otherwise
 * creates a WebGL2 context, which can block for tens of milliseconds (far more
 * on software renderers). Call it after first paint, and only on pages that
 * show the scene. Every signal read is recorded for the ?fps overlay.
 */
export async function detectTier(): Promise<QualityTier> {
  const memory = deviceMemory();
  const coreCount = cores();
  const shortSide = Math.min(screen.width, screen.height);
  const coarse = matchMedia('(pointer: coarse)').matches;
  setSignal('device memory', memory === null ? 'unknown' : `${memory} GB`);
  setSignal('cores', coreCount === null ? 'unknown' : String(coreCount));
  setSignal('dpr', String(window.devicePixelRatio || 1));
  setSignal('screen', `${screen.width}×${screen.height}${coarse ? ' touch' : ''}`);

  const fast = detectTierFast();
  if (fast) return fast;

  const gpu = (await probeWebGpu()) ?? probeWebGl();
  setSignal('gpu', `${gpu.source}: ${gpu.renderer || '(not reported)'}`);
  if (!gpu.available) return 'off';
  if (gpu.software || WEAK_GPU.test(gpu.renderer)) return 'low';

  // Apple Silicon Macs also report Apple; only treat it as mobile on touch devices.
  const midGpu = MID_GPU.test(gpu.renderer) && !(/apple/i.test(gpu.renderer) && !coarse);
  const modestMemory = memory !== null && memory <= 4;
  const modestCores = coreCount !== null && coreCount <= 4;
  if (midGpu || coarse || shortSide < 768 || modestMemory || modestCores) return 'medium';
  return 'high';
}
