/**
 * Quality tiers (SCENE_SPEC.md). This module must stay tiny and must never import
 * Three.js: it runs in the initial bundle to decide whether the scene loads at all.
 */

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

/** Frame-time thresholds (ms) for the 3-second re-evaluation: above this, drop one tier. */
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
  webgl2: boolean;
  renderer: string;
}

function probeGpu(): GpuInfo {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return { webgl2: false, renderer: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer };
  } catch {
    return { webgl2: false, renderer: '' };
  }
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
/** Old or entry-level mobile GPUs: poster only. */
const WEAK_GPU =
  /mali-[t4]|mali-g(31|51|52)\b|adreno \(tm\) [2-5]\d\d|adreno [2-5]\d\d|powervr|intel.*gma/i;
/** Phones, tablets and older integrated laptop GPUs: the lighter scene. */
const MID_GPU = /mali|adreno|apple gpu|apple a\d|xclipse|immortalis|maleoon|intel.*hd graphics/i;

/** Read a forced tier from `?tier=` for testing and poster capture. */
function forcedTier(): QualityTier | null {
  const value = new URLSearchParams(location.search).get('tier');
  return value && (TIERS as string[]).includes(value) ? (value as QualityTier) : null;
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Detect the tier once at start-up from cheap signals: reduced motion, save-data,
 * WebGL2 support, the GPU renderer string, device memory, cores and screen size.
 */
export function detectTier(): QualityTier {
  const forced = forcedTier();
  const reduced = prefersReducedMotion();
  if (forced) return reduced && forced !== 'off' ? 'off' : forced;
  if (reduced) return 'off';

  const nav = navigator as NavigatorHints;
  const gpu = probeGpu();
  if (!gpu.webgl2) return 'off';
  if (SOFTWARE_GPU.test(gpu.renderer)) return 'low';

  const memory = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 4;
  const saveData = nav.connection?.saveData === true;
  const slowNet = /(^|-)2g$/.test(nav.connection?.effectiveType ?? '');
  if (saveData || slowNet || memory <= 2 || cores <= 2 || WEAK_GPU.test(gpu.renderer)) {
    return 'low';
  }

  const shortSide = Math.min(screen.width, screen.height);
  const coarse = matchMedia('(pointer: coarse)').matches;
  // Apple Silicon Macs also report "Apple GPU"; only treat it as mobile on touch devices.
  const midGpu = MID_GPU.test(gpu.renderer) && !(/apple/i.test(gpu.renderer) && !coarse);
  if (midGpu || coarse || shortSide < 768 || memory <= 4 || cores <= 4) {
    return 'medium';
  }

  return 'high';
}
