/**
 * The scene's public API. Pages and the scroll system talk to the scene only
 * through createScene() and the handle it returns (SCENE_SPEC.md).
 *
 * Phase 2.5: the scene builds up in layers, each compiled off the main thread
 * (compileAsync / KHR_parallel_shader_compile) and faded in as soon as the
 * previous one is stable:
 *   L1 sky, distant peaks, the monolith (this chunk; the poster cross-fades
 *      to it as soon as its first frame is on screen)
 *   L2 terrain and fog · L3 lava and its glow · L4 embers · L5 post-processing
 *      (High, Medium) — the layers chunk, src/scene/layers.ts
 *   L6 extras: pointer heat, hairline crazing, full horizon smoke, every ember
 *
 * A frame-time controller then holds the tier's frame rate (60 fps; Lite 30):
 * resolution scale first (0.5–1), then the extras, then one tier down, and the
 * poster only when Lite at half resolution can't hold ~24 fps. With headroom
 * it scales back up, and may step up a tier (once per tier per session).
 */
import {
  ACESFilmicToneMapping,
  Color,
  MathUtils,
  Matrix4,
  PerspectiveCamera,
  Ray,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { loadFissureAtlas, type FissureAtlas } from './atlas';
import {
  cameraAt,
  copyFrame,
  createFrame,
  createPose,
  glideDuration,
  glideFrame,
  idleOffset,
  orbitAt,
  poseFromFrame,
  viewAt,
  type OrbitFrame,
} from './camera-path';
import { blendChapterState, createChapterState, type ChapterState } from './chapters';
import { VIEW_STATES, type PageView } from './views';
import { createChannel } from './channel';
import { createGlow, type GlowModule } from './glow';
import { createGpuTimer, type GpuTimer, type GpuTimings } from './gpu-timer';
import { createMonolith, LAVA_LIGHT_COUNT, MONOLITH, type MonolithModule } from './monolith';
import { terrainHeight } from './ground';
import { PALETTE_HEX } from './palette';
import { createPeaks } from './peaks';
import {
  higherTier,
  lowerTier,
  SCENE_TIERS,
  TIER_SETTINGS,
  type QualityTier,
  type SceneTier,
  type TierSettings,
} from './quality';
import { createSky, type SkyModule } from './sky';
import { DEFAULT_STORY_MAP, storyPosition, type StoryMap, type StoryPosition } from './story-map';
import { BLOOM_DIVE, BLOOM_INTENSITY, GRAIN_OPACITY, VIGNETTE_DARKNESS } from './look';
import { createNoiseTexture } from './textures';
import type { SceneModule, SceneState } from './types';
import { createSharedUniforms, type SharedUniforms } from './uniforms';
import type { EmbersModule, LavaModule, PostChain, TerrainModule } from './layers';

export type { QualityTier, SceneTier } from './quality';
export type { StoryMap } from './story-map';
export type { PageView } from './views';

type LayersModule = typeof import('./layers');

export interface SceneOptions {
  tier: SceneTier;
  /** Resolution scale to start from (0.5–1), e.g. remembered this session. */
  startScale?: number;
  /** The highest tier this session may still upgrade into. */
  ceiling?: SceneTier | 'poster';
  /** Tiers already reached by an upgrade this session (each happens once). */
  upgraded?: SceneTier[];
  /** The fissure atlas fetch, already in flight (baked tiers). */
  atlas?: Promise<Blob>;
  /** Called once, after the first frame is on screen (cross-fade from the poster). */
  onFirstFrame?: () => void;
  /** The scene changed tier itself (upgrade, downgrade, or 'poster' as the last resort). */
  onTierChange?: (tier: QualityTier, reason: string) => void;
  /** Settled state worth remembering this session (tier, scale, ceiling, upgrades). */
  onSettle?: (state: {
    tier: SceneTier;
    scale: number;
    ceiling: SceneTier | 'poster';
    upgraded: SceneTier[];
  }) => void;
  /** Load phases, for the ?fps overlay (e.g. 'L1 compiled'). */
  onPhase?: (phase: string, detail?: string) => void;
  /** Problems and degradations: shader logs, missing extensions, failed layers. */
  onIssue?: (message: string) => void;
  /** Controller decisions (resolution, extras, tiers), for the ?fps overlay. */
  onDecision?: (message: string) => void;
  /** The GPU context was lost (show the poster) / restored (rebuild). */
  onContextLost?: () => void;
  onContextRestored?: () => void;
  /**
   * Without the post-processing layer there is no WashEffect, so the Chapter 04
   * wash is handed to the page to draw over the canvas (amount 0..1, CSS colour).
   */
  onWash?: (amount: number, cssColor: string) => void;
  /** Never change tier (a tier forced with ?tier= is never second-guessed). */
  fixedTier?: boolean;
  /** Hold this resolution scale (testing, cost measurements). */
  fixedScale?: number;
  /** Poster capture: every layer at once, frozen time (and story progress), drawing buffer kept. */
  capture?: { time: number; progress?: number; view?: PageView };
  /** Dev only: object names to hide (sky, peaks, terrain, lava, monolith, embers, glow). */
  debugHide?: string[];
  /** Dev only: never add the post-processing layer. */
  debugNoPost?: boolean;
  /** Dev only: no heat haze (to measure its cost). */
  debugNoHaze?: boolean;
  /** Time each layer on the GPU (EXT_disjoint_timer_query_webgl2), for ?fps. */
  gpuTiming?: boolean;
}

export interface SceneHandle {
  /**
   * 0..1 scroll progress through the home story. The camera follows with light
   * damping; `immediate` jumps straight there (deep links, back navigation).
   */
  setProgress(p: number, immediate?: boolean): void;
  /** Where each chapter sits in progress space, measured from the real layout. */
  setStoryMap(map: StoryMap): void;
  /** Jump to a chapter's framing, for non-home pages. */
  setChapter(index: number): void;
  /**
   * Frame a content page (Phase 4), or `null` to follow the home story again.
   * The camera glides there from wherever it is, unless `immediate` (first
   * load, back/forward, reduced motion).
   */
  setView(view: PageView | null, options?: { immediate?: boolean }): void;
  /** Highest resolution scale for the current page (content pages render lighter). */
  setScaleCap(cap: number): void;
  /**
   * Lite on content pages: once the camera has arrived and every layer has
   * faded in, stop rendering and hold the still frame until something needs
   * motion again (a page change, the core flare, a resize).
   */
  setHoldWhenIdle(hold: boolean): void;
  /** Brighten the core vein briefly (the contact form's success). */
  flare(): void;
  /** A brief heat shimmer over the whole view, as the page changes (High, Medium). */
  shimmer(): void;
  /** True while a held still frame is on screen (Lite on content pages). */
  readonly holding: boolean;
  /** Pointer position, normalised -1..1 (y up). */
  setPointer(x: number, y: number): void;
  pause(): void;
  resume(): void;
  /** Release everything. `loseContext: false` keeps the canvas usable for a rebuild. */
  dispose(options?: { loseContext?: boolean }): void;
  /** Which setup is running, for diagnostics (e.g. 'lite, no post'). */
  readonly description: string;
  readonly tier: SceneTier;
  /** Where the camera actually is in the story (damped), for diagnostics and tests. */
  readonly cameraProgress: number;
  /** Per-layer GPU milliseconds, or null without timer queries. */
  gpuTimings(): GpuTimings | null;
  /** Readable state for the ?fps overlay: layers, scale, frame time, decisions. */
  stats(): string[];
}

/**
 * Exponential smoothing on the camera's progress, per second. Lenis already
 * smooths the scroll, so this only adds a little weight; more would feel laggy.
 */
const PROGRESS_DAMPING = 7;
/** Each layer fades in over this long. */
const FADE_MS = 450;
/** Frames ignored by the controller after a layer or tier appears (compiles, uploads, fades). */
const SETTLE_FRAMES = 30;
/** After a resolution or extras change only the next few frames are unrepresentative. */
const SETTLE_FRAMES_SMALL = 8;
/** The controller decides at most this often. */
const DECISION_MS = 500;
const SCALE_MIN = 0.5;
const SCALE_DOWN = 0.1;
const SCALE_UP = 0.05;
/** Headroom needed before scaling up, restoring extras, or stepping up a tier. */
const SCALE_UP_HOLD_MS = 2000;
const EXTRAS_HOLD_MS = 3000;
const UPGRADE_HOLD_MS = 5000;
/** Lite at the minimum scale below this frame rate: the poster. */
const POSTER_FPS = 24;
/** Shader compilation gets this long before rendering compiles synchronously. */
const COMPILE_TIMEOUT_MS = 15000;
/** Embers without the extras layer (the rest arrive with L6). */
const BASE_EMBER_SHARE = 0.6;
/** Frames rendered after everything settles before Lite holds its still. */
const HOLD_AFTER_FRAMES = 3;
/** The contact success flare: rise, then cool. */
const FLARE_RISE_MS = 300;
const FLARE_COOL_MS = 2400;
/** The page-change shimmer: a quick swell, then it settles. */
const SHIMMER_RISE_MS = 120;
const SHIMMER_FALL_MS = 380;
/** Headroom needed before the haze comes back after being dropped under load. */
const HAZE_HOLD_MS = 4000;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function copyState(from: ChapterState, out: ChapterState) {
  for (let k = 0; k < 4; k++) out.faceHeat[k] = from.faceHeat[k]!;
  out.emberDensity = from.emberDensity;
  out.lavaIntensity = from.lavaIntensity;
  out.fissureGain = from.fissureGain;
  out.glow = from.glow;
  out.coreTemp = from.coreTemp;
  return out;
}

function mixStates(a: ChapterState, b: ChapterState, t: number, out: ChapterState) {
  const mix = (x: number, y: number) => x + (y - x) * t;
  for (let k = 0; k < 4; k++) out.faceHeat[k] = mix(a.faceHeat[k]!, b.faceHeat[k]!);
  out.emberDensity = mix(a.emberDensity, b.emberDensity);
  out.lavaIntensity = mix(a.lavaIntensity, b.lavaIntensity);
  out.fissureGain = mix(a.fissureGain, b.fissureGain);
  out.glow = mix(a.glow, b.glow);
  out.coreTemp = mix(a.coreTemp, b.coreTemp);
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface Fade {
  apply(value: number): void;
  start: number;
}

/** One tier's scene: built in layers, torn down as a whole. */
interface World {
  tier: SceneTier;
  settings: TierSettings;
  scene: Scene;
  camera: PerspectiveCamera;
  shared: SharedUniforms;
  sky: SkyModule;
  monolith: MonolithModule;
  glow: GlowModule | null;
  terrain: TerrainModule | null;
  lava: LavaModule | null;
  embers: EmbersModule | null;
  post: PostChain | null;
  /** The post chain is drawing (L5 done). */
  postActive: boolean;
  modules: SceneModule[];
  fades: Fade[];
  /** Highest layer in place (1–6). */
  layer: number;
  disposed: boolean;
  dispose(): void;
}

export async function createScene(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
): Promise<SceneHandle> {
  const capture = options.capture;
  const issue = (message: string) => options.onIssue?.(message);
  const phase = (name: string, detail?: string) => options.onPhase?.(name, detail);

  // ── Renderer (one context for every tier and layer) ────────────────────
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: Boolean(capture),
    });
  } catch (error) {
    throw new Error(`WebGL context could not be created: ${errorText(error)}`, { cause: error });
  }
  renderer.outputColorSpace = SRGBColorSpace;
  // Materials tone-map when drawing straight to the screen (L1–L4, and Lite
  // throughout). Into the post chain's targets three skips it, and the chain's
  // own ACES pass takes over.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.setClearColor(new Color(PALETTE_HEX.basalt));
  const gl = renderer.getContext() as WebGL2RenderingContext;

  // Shader compile and link logs, captured instead of only printed.
  const shaderLogs: string[] = [];
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    const logs = [
      context.getProgramInfoLog(program),
      context.getShaderInfoLog(vertex),
      context.getShaderInfoLog(fragment),
    ]
      .map((log) => log?.trim())
      .filter(Boolean)
      .join(' | ');
    shaderLogs.push(logs.slice(0, 600) || 'link failed without a log');
    if (import.meta.env.DEV)
      console.error('[scene] shader error', JSON.stringify(context.getShaderInfoLog(fragment)));
  };

  // Half-float colour buffers need an extension; without it, the post chain
  // uses 8-bit buffers with dithering rather than an incomplete framebuffer.
  const halfFloat = Boolean(
    gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'),
  );
  if (!halfFloat)
    issue('half-float render targets unsupported: post-processing uses 8-bit buffers');

  // ── Shared across tiers ────────────────────────────────────────────────
  const channel = createChannel();
  const lavaLights = channel.lightsNear(LAVA_LIGHT_COUNT, 14).map((light) => {
    light.y = terrainHeight(light.x, light.z) + 0.3;
    return light;
  });
  const noise = createNoiseTexture();
  let cells: Texture | null = null;
  let layers: Promise<LayersModule> | null = null;
  const loadLayers = () => (layers ??= import('./layers'));

  let atlas: FissureAtlas | null = null;
  let atlasLoad: Promise<FissureAtlas | null> | null = null;
  const loadAtlas = () =>
    (atlasLoad ??= loadFissureAtlas(renderer, options.atlas, issue).then(
      (loaded) => {
        atlas = loaded;
        phase('fissure atlas ready', loaded.source);
        return loaded;
      },
      (error: unknown) => {
        issue(`fissure atlas failed, using the flat glow: ${errorText(error)}`);
        return null;
      },
    ));

  // Per-frame GPU time: per layer with ?fps; the frame total (where the
  // extension exists) also informs upgrades.
  const timer: GpuTimer | null = capture ? null : createGpuTimer(renderer);

  const state: SceneState = {
    time: capture?.time ?? 0,
    delta: 0,
    faceHeat: new Vector4(0, 0, 0, 0),
    pointerPoint: new Vector3(0, -100, 0),
    pointerHeat: 0,
    emberDensity: 0,
    lavaIntensity: 1,
    fissureGain: 1,
    coreOpen: 0,
  };
  const chapterState = createChapterState();
  let storyMap: StoryMap = DEFAULT_STORY_MAP;
  // Page views and glides between framings.
  let view: PageView | null = capture?.view ?? null;
  const targetFrame = createFrame();
  /** The orbit frame the camera used last (before the dive, if any): where a glide starts. */
  const frame = createFrame();
  let framed = false;
  const targetState = createChapterState();
  let glide: {
    from: OrbitFrame;
    fromState: ChapterState;
    elapsed: number;
    duration: number;
  } | null = null;
  let flareAt = -1;
  let shimmerAt = -1;
  /** High's haze is wanted (dropped first under load, before resolution). */
  let haze = !options.debugNoHaze;
  let scaleCap = 1;
  let holdWhenIdle = false;
  let idleFrames = 0;
  /** Where the scroll is, and where the camera is (damped toward it). */
  let targetProgress = capture?.progress ?? 0;
  let cameraProgress = targetProgress;
  const position: StoryPosition = { chapter: 0, dive: 0 };
  const pose = createPose();
  const drift = new Vector3();
  let drawingHeight = 1;
  let world: World | null = null;
  let pointerOn = Boolean(capture);

  // ── Controller state ───────────────────────────────────────────────────
  let scale = MathUtils.clamp(options.fixedScale ?? options.startScale ?? 1, SCALE_MIN, 1);
  let extras = Boolean(capture);
  let ceiling: SceneTier | 'poster' = options.ceiling ?? 'high';
  const upgraded = new Set<SceneTier>(options.upgraded ?? []);
  const decisions: string[] = [];
  let lastFrameMs = 0;

  const decide = (message: string) => {
    const line = `${(performance.now() / 1000).toFixed(1)}s ${message}`;
    decisions.push(line);
    if (decisions.length > 5) decisions.shift();
    options.onDecision?.(message);
  };
  const settle = () => {
    if (!world || capture) return;
    options.onSettle?.({ tier: world.tier, scale, ceiling, upgraded: [...upgraded] });
  };

  // ── Building ───────────────────────────────────────────────────────────
  const hidden = (object: Object3D) => Boolean(options.debugHide?.includes(object.name));
  const show = (w: World, object: Object3D) => {
    object.visible = !hidden(object);
    w.scene.add(object);
    if (options.gpuTiming) timer?.track(object, object.name);
  };

  /** L1: sky, peaks, monolith (and Lite's glow sprites). */
  const buildCore = (tier: SceneTier): World => {
    const settings = TIER_SETTINGS[tier];
    const scene = new Scene();
    const camera = new PerspectiveCamera(34, 1, 0.5, 6000);
    const shared = createSharedUniforms();
    shared.uLavaGlow.value = 0;
    const sky = createSky(shared, settings, noise);
    const peaks = createPeaks(shared, settings);
    const monolith = createMonolith(shared, settings, lavaLights);
    if (settings.bakedFissures) monolith.setAtlas(atlas?.texture ?? null, atlas ? 1 : 0);
    const glow = settings.fakeBloom ? createGlow(shared, channel) : null;
    const modules: SceneModule[] = [sky, peaks, monolith];
    if (glow) modules.push(glow);

    const w: World = {
      tier,
      settings,
      scene,
      camera,
      shared,
      sky,
      monolith,
      glow,
      terrain: null,
      lava: null,
      embers: null,
      post: null,
      postActive: false,
      modules,
      fades: [],
      layer: 1,
      disposed: false,
      dispose() {
        if (w.disposed) return;
        w.disposed = true;
        for (const m of w.modules) m.dispose();
        w.post?.dispose();
      },
    };
    for (const m of modules) show(w, m.object);
    return w;
  };

  const fade = (w: World, apply: (value: number) => void, instant: boolean) => {
    apply(instant ? 1 : 0);
    if (!instant) w.fades.push({ apply, start: -1 });
  };

  /** Compile with KHR_parallel_shader_compile where available; never longer than the timeout. */
  const compile = async (object: Object3D, w: World) => {
    let timeout = 0;
    try {
      await Promise.race([
        renderer.compileAsync(object, w.camera, w.scene),
        new Promise((_, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error(`shader compilation took over ${COMPILE_TIMEOUT_MS}ms`)),
            COMPILE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      // Not fatal: the first render compiles whatever is left.
      issue(errorText(error));
    } finally {
      clearTimeout(timeout);
    }
    if (shaderLogs.length) throw new Error(`shader compile/link failed: ${shaderLogs[0]}`);
  };

  /** Add one layer (2–5) to a world: build, compile, then fade it in. */
  const addLayer = async (w: World, layer: number, instant: boolean) => {
    const mod = await loadLayers();
    if (w.disposed) return;
    const settings = w.settings;
    if (layer === 2 || layer === 3) cells ??= mod.createCellsTexture();
    const textures = { noise, cells: cells! };

    if (layer === 2) {
      const terrain = mod.buildTerrain(w.shared, settings, channel, textures);
      await compile(terrain.object, w);
      if (w.disposed) return terrain.dispose();
      w.terrain = terrain;
      w.modules.push(terrain);
      show(w, terrain.object);
      fade(w, (v) => terrain.setFade(v), instant);
    } else if (layer === 3) {
      const lava = mod.buildLava(w.shared, settings, channel, textures);
      await compile(lava.object, w);
      if (w.disposed) return lava.dispose();
      w.lava = lava;
      w.modules.push(lava);
      show(w, lava.object);
      fade(
        w,
        (v) => {
          lava.setFade(v);
          w.shared.uLavaGlow.value = v;
        },
        instant,
      );
    } else if (layer === 4) {
      const embers = mod.buildEmbers(w.shared, settings, channel);
      embers.setMaxCount(extras ? settings.embers : Math.round(settings.embers * BASE_EMBER_SHARE));
      await compile(embers.object, w);
      if (w.disposed) return embers.dispose();
      w.embers = embers;
      w.modules.push(embers);
      show(w, embers.object);
      fade(w, (v) => embers.setFade(v), instant);
    } else if (layer === 5) {
      if (settings.post === 'none' || options.debugNoPost) return;
      const post = mod.buildPost(renderer, w.scene, w.camera, settings, halfFloat, noise);
      try {
        post.composer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
        // The scene's materials drawing into the chain's target are new programs
        // (no tone mapping, linear output): compile them, and the chain's own.
        renderer.setRenderTarget(post.inputBuffer);
        const scenePrograms = renderer.compileAsync(w.scene, w.camera);
        renderer.setRenderTarget(null);
        const quads = mod.quadScene(post.materials());
        await Promise.race([
          Promise.all([scenePrograms, renderer.compileAsync(quads.scene, w.camera)]),
          sleep(COMPILE_TIMEOUT_MS),
        ]);
        quads.dispose();
        if (shaderLogs.length) throw new Error(`shader compile/link failed: ${shaderLogs[0]}`);
        // Hidden check: the chain's framebuffer must be complete.
        renderer.setRenderTarget(post.inputBuffer);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        renderer.setRenderTarget(null);
        if (status !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error(`framebuffer incomplete (0x${status.toString(16)})`);
      } catch (error) {
        post.dispose();
        shaderLogs.length = 0;
        issue(`post-processing unavailable, continuing without it: ${errorText(error)}`);
        return;
      }
      if (w.disposed) return post.dispose();
      w.post = post;
      w.postActive = true;
      // The CSS wash hands over to the WashEffect.
      options.onWash?.(0, '');
      lastWashCss = '';
      fade(w, (v) => (post.fade = v), instant);
      resize();
    }
    w.layer = Math.max(w.layer, layer);
  };

  /** Every layer at once (poster capture, and in-place tier changes). */
  const buildAll = async (w: World) => {
    for (const layer of [2, 3, 4, 5]) await addLayer(w, layer, true);
    w.layer = 6;
  };

  // ── Sizing ─────────────────────────────────────────────────────────────
  const resize = () => {
    const w = world;
    if (!w) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    // The tier's DPR cap, then the resolution scale. CSS stretches the canvas to fill.
    const dpr = Math.min(window.devicePixelRatio || 1, w.settings.dpr) * Math.min(scale, scaleCap);
    renderer.setPixelRatio(dpr);
    if (w.postActive && w.post) w.post.composer.setSize(width, height, false);
    else renderer.setSize(width, height, false);
    w.camera.aspect = width / height;
    drawingHeight = height * dpr;
    w.camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(() => {
    resize();
    kick();
  });

  // ── Pointer heat ───────────────────────────────────────────────────────
  const pointerNdc = new Vector2(4, 4);
  const ray = new Ray();
  const localRay = new Ray();
  const inverse = new Matrix4();
  const hitPoint = new Vector3();
  const onRay = new Vector3();
  const onAxis = new Vector3();
  const axisBottom = new Vector3(0, 0, 0);
  const axisTop = new Vector3(0, MONOLITH.height, 0);
  const targetPoint = new Vector3(0, -100, 0);

  const updatePointer = (w: World, dt: number) => {
    let targetHeat = 0;
    const { camera, monolith } = w;
    if (pointerOn && Math.abs(pointerNdc.x) <= 1.2 && Math.abs(pointerNdc.y) <= 1.2) {
      ray.origin.setFromMatrixPosition(camera.matrixWorld);
      ray.direction
        .set(pointerNdc.x, pointerNdc.y, 0.5)
        .unproject(camera)
        .sub(ray.origin)
        .normalize();
      inverse.copy(monolith.mesh.matrixWorld).invert();
      localRay.copy(ray).applyMatrix4(inverse);
      if (localRay.intersectBox(monolith.bounds, hitPoint)) {
        targetHeat = 1;
      } else {
        // Near miss: heat the closest part of the stone, fading with distance.
        const d2 = localRay.distanceSqToSegment(axisBottom, axisTop, onRay, onAxis);
        monolith.bounds.clampPoint(onRay, hitPoint);
        const gap = Math.max(0, Math.sqrt(d2) - MONOLITH.width / 2);
        targetHeat = Math.exp(-(gap * gap) / 5);
      }
      hitPoint.applyMatrix4(monolith.mesh.matrixWorld);
      targetPoint.copy(hitPoint);
    }
    const follow = 1 - Math.exp(-dt * 9);
    if (state.pointerHeat < 0.01) state.pointerPoint.copy(targetPoint);
    else state.pointerPoint.lerp(targetPoint, follow);
    // Stone warms quickly and cools slowly.
    const rate = targetHeat > state.pointerHeat ? 2.4 : 0.9;
    state.pointerHeat += (targetHeat - state.pointerHeat) * (1 - Math.exp(-dt * rate));
  };

  // ── Wash ───────────────────────────────────────────────────────────────
  const washColor = new Color();
  let lastWashCss = '';
  let washAmount = 0;
  const applyWash = (w: World, dive: number) => {
    // Rises to molten light at the peak (0.5), cools through lava and magma by
    // 0.75 (the CTA may appear from here), and reaches basalt at 1.
    const palette = w.shared;
    if (dive <= 0) {
      washAmount = 0;
    } else if (dive < 0.5) {
      washAmount = MathUtils.smoothstep(dive, 0.22, 0.5);
      washColor.copy(palette.uLavaHot.value);
    } else if (dive < 0.75) {
      washAmount = 1;
      const t = (dive - 0.5) / 0.25;
      if (t < 0.5) washColor.lerpColors(palette.uLavaHot.value, palette.uLava.value, t * 2);
      else washColor.lerpColors(palette.uLava.value, palette.uMagma.value, (t - 0.5) * 2);
    } else {
      washAmount = 1;
      washColor.lerpColors(
        palette.uMagma.value,
        palette.uBasalt.value,
        MathUtils.smoothstep(dive, 0.75, 1),
      );
    }
    if (w.postActive && w.post) {
      w.post.wash.amount = washAmount;
      w.post.wash.color.copy(washColor);
    } else if (options.onWash) {
      // Lite (and before L5): the same colours on a CSS layer over the canvas.
      const css = washAmount > 0 ? washColor.getStyle() : '';
      if (css !== lastWashCss) options.onWash(washAmount, css);
      lastWashCss = css;
    }
  };

  // ── Frame ──────────────────────────────────────────────────────────────
  let fadeClock = 0;
  const render = (dt: number) => {
    const w = world;
    if (!w) return;
    const { camera } = w;
    if (!capture) state.time += dt;
    state.delta = dt;
    w.shared.uTime.value = state.time;

    // Layer fades, on real time (never frozen by capture).
    fadeClock += dt * 1000;
    if (w.fades.length) {
      w.fades = w.fades.filter((f) => {
        if (f.start < 0) f.start = fadeClock;
        const t = Math.min(1, (fadeClock - f.start) / FADE_MS);
        f.apply(t * t * (3 - 2 * t));
        return t < 1;
      });
    }

    // Story position: damped camera progress mapped through the measured chapters.
    cameraProgress += (targetProgress - cameraProgress) * (1 - Math.exp(-dt * PROGRESS_DAMPING));
    if (Math.abs(targetProgress - cameraProgress) < 1e-5) cameraProgress = targetProgress;
    storyPosition(cameraProgress, storyMap, position);

    // Where the camera is headed: this page's view, or the story.
    if (view) {
      viewAt(view, camera.aspect, targetFrame);
      copyState(VIEW_STATES[view], targetState);
      if (view === 'notfound') {
        // A slow drift past the edge of the plain.
        targetFrame.theta += Math.sin(state.time * 0.045) * 0.035;
        targetFrame.height += Math.sin(state.time * 0.031 + 0.8) * 1.6;
      }
    } else {
      orbitAt(position.chapter, camera.aspect, targetFrame);
      blendChapterState(position, targetState);
    }

    let dive = 0;
    if (glide) {
      glide.elapsed += dt * 1000;
      const t = Math.min(1, glide.elapsed / glide.duration);
      const e = easeInOutCubic(t);
      glideFrame(glide.from, targetFrame, e, frame);
      poseFromFrame(frame, pose);
      mixStates(glide.fromState, targetState, e, chapterState);
      if (t >= 1) glide = null;
    } else if (view) {
      copyFrame(targetFrame, frame);
      poseFromFrame(frame, pose);
      copyState(targetState, chapterState);
    } else {
      cameraAt(position, camera.aspect, pose);
      copyFrame(targetFrame, frame);
      copyState(targetState, chapterState);
      dive = position.dive;
    }
    framed = true;

    // Idle drift breathes during the orbit and fades out as the camera nears the stone.
    idleOffset(state.time, drift).multiplyScalar(1 - pose.dive);
    camera.position.copy(pose.position).add(drift);
    camera.lookAt(pose.target);
    const near = MathUtils.clamp(pose.clearance * 0.4, 0.03, 0.5);
    if (camera.fov !== pose.fov || camera.near !== near) {
      camera.fov = pose.fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    const pointScale = drawingHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
    w.embers?.setPointScale(pointScale);
    w.glow?.setPointScale(pointScale);

    // The contact success flare: the core vein opens a little and burns brighter.
    let flare = 0;
    if (flareAt >= 0) {
      const since = fadeClock - flareAt;
      flare =
        since < FLARE_RISE_MS
          ? since / FLARE_RISE_MS
          : Math.max(0, 1 - (since - FLARE_RISE_MS) / FLARE_COOL_MS) ** 2;
      if (since > FLARE_RISE_MS + FLARE_COOL_MS) flareAt = -1;
    }

    // Per-chapter (or per-view) scene state.
    state.faceHeat.fromArray(chapterState.faceHeat);
    state.emberDensity = chapterState.emberDensity;
    state.lavaIntensity = chapterState.lavaIntensity;
    state.fissureGain = chapterState.fissureGain * (1 + 0.7 * flare);
    state.coreOpen = Math.max(pose.dive, 0.22 * flare);
    w.shared.uGlow.value = chapterState.glow * (1 + 0.35 * flare);

    applyWash(w, dive);
    if (w.post) {
      const f = w.post.fade;
      w.post.bloom.intensity =
        (BLOOM_INTENSITY + BLOOM_DIVE * MathUtils.smoothstep(dive, 0, 0.5) + 0.6 * flare) * f;
      w.post.vignette.darkness = VIGNETTE_DARKNESS * f;
      w.post.grain.blendMode.opacity.value = (capture ? 0 : GRAIN_OPACITY) * (1 - washAmount) * f;
      // Heat: High's haze (unless dropped under load), and the page-change shimmer.
      let shimmer = 0;
      if (shimmerAt >= 0) {
        const since = fadeClock - shimmerAt;
        shimmer =
          since < SHIMMER_RISE_MS
            ? since / SHIMMER_RISE_MS
            : Math.max(0, 1 - (since - SHIMMER_RISE_MS) / SHIMMER_FALL_MS);
        shimmer = shimmer * shimmer * (3 - 2 * shimmer);
        if (since > SHIMMER_RISE_MS + SHIMMER_FALL_MS) shimmerAt = -1;
      }
      w.post.heat.time = state.time;
      w.post.heat.stoneDistance = Math.hypot(camera.position.x, camera.position.z);
      w.post.heat.shimmer = shimmer * f;
      w.post.heat.haze = w.post.hazeCapable && haze ? f * (1 - washAmount) : 0;
    }

    updatePointer(w, dt);
    for (const m of w.modules) m.update(state);
    timer?.beginFrame();
    if (w.postActive && w.post) w.post.composer.render(dt);
    else renderer.render(w.scene, camera);
    timer?.endFrame();
  };

  /** Compile L1 and draw it once (hidden behind the poster), then check the context. */
  const prepareCore = async (w: World) => {
    resize();
    storyPosition(cameraProgress, storyMap, position);
    if (view) poseFromFrame(viewAt(view, w.camera.aspect, frame), pose);
    else cameraAt(position, w.camera.aspect, pose);
    w.camera.position.copy(pose.position);
    w.camera.lookAt(pose.target);
    w.camera.updateMatrixWorld();
    await compile(w.scene, w);
    render(0);
    if (shaderLogs.length) throw new Error(`shader compile/link failed: ${shaderLogs[0]}`);
    if (gl.isContextLost()) throw new Error('WebGL context lost during setup');
    if (gl.getError() === gl.OUT_OF_MEMORY) throw new Error('out of GPU memory');
  };

  // ── L1, degrading one tier at a time if a tier can't even start ────────
  if (TIER_SETTINGS[options.tier].bakedFissures) {
    // Give the atlas a moment (it loads alongside the scene chunk); if it's
    // late, the stone starts with its flat glow and the veins ignite on arrival.
    const pending = loadAtlas();
    await Promise.race([pending, sleep(capture ? 20000 : 150)]);
  }
  const ladder = SCENE_TIERS.slice(0, SCENE_TIERS.indexOf(options.tier) + 1).reverse();
  for (const tier of ladder) {
    if (gl.isContextLost()) break;
    if (TIER_SETTINGS[tier].bakedFissures && !atlasLoad) void loadAtlas();
    let built: World | null = null;
    try {
      shaderLogs.length = 0;
      built = buildCore(tier);
      // The fissures start dim and ignite as the poster cross-fades away.
      if (!capture) built.monolith.setFade(0.3);
      world = built;
      await prepareCore(built);
      break;
    } catch (error) {
      issue(`tier ${tier} could not start: ${errorText(error)}`);
      built?.dispose();
      world = null;
      if (tier !== 'lite') ceiling = lowerTier(tier) ?? 'poster';
    }
  }
  if (!world) {
    noise.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    throw new Error(
      gl.isContextLost() ? 'WebGL context lost during setup' : 'no scene tier could start',
    );
  }
  const startWorld: World = world;
  if (startWorld.tier !== options.tier)
    options.onTierChange?.(startWorld.tier, 'tier could not start');
  phase('L1 compiled', `${startWorld.tier}: sky, peaks, monolith`);

  // The atlas arriving after L1 started: the veins ignite from the flat glow.
  if (startWorld.settings.bakedFissures && !atlas) {
    void loadAtlas().then((loaded) => {
      const w = world;
      if (!loaded || !w || !w.settings.bakedFissures) return;
      fade(w, (v) => w.monolith.setAtlas(loaded.texture, v), false);
    });
  }

  if (capture) {
    await buildAll(startWorld);
    resize();
    render(0);
  }
  resizeObserver.observe(canvas);

  // ── Loop, pacing and the controller ───────────────────────────────────
  let raf = 0;
  let running = false;
  /** The page wants the scene running (resume) or not (pause: hidden tab, offscreen). */
  let wanted = false;
  /** Lite on a content page, holding its still frame. */
  let held = false;
  let disposed = false;
  let firstFrame = false;
  let lastTick = 0;
  let lastRender = 0;
  const vsyncs: number[] = [];
  let vsync = 1000 / 60;
  let frameIndex = 0;
  let settleUntilFrame = SETTLE_FRAMES;
  let samples: number[] = [];
  let rawMax = 0;
  let lastDecision = 0;
  let headroomSince = 0;
  let switching = false;
  let gaveUp = false;

  /** Ignore the next frames (a layer, tier or scale just changed). */
  const unsettle = (frames = SETTLE_FRAMES) => {
    settleUntilFrame = frameIndex + frames;
    samples = [];
    rawMax = 0;
    headroomSince = 0;
  };

  const setScale = (next: number, why: string) => {
    if (options.fixedScale !== undefined) return;
    const value = Math.round(MathUtils.clamp(next, SCALE_MIN, 1) * 100) / 100;
    if (value === scale) return;
    decide(`resolution ${scale.toFixed(2)} → ${value.toFixed(2)} (${why})`);
    scale = value;
    resize();
    unsettle(SETTLE_FRAMES_SMALL);
    settle();
  };

  const setExtras = (on: boolean, why: string) => {
    if (extras === on) return;
    extras = on;
    const w = world;
    if (w) {
      w.monolith.setExtras(on);
      w.sky.setExtras(on);
      w.embers?.setMaxCount(
        on ? w.settings.embers : Math.round(w.settings.embers * BASE_EMBER_SHARE),
      );
    }
    decide(`extras ${on ? 'on' : 'off'} (${why})`);
    unsettle(SETTLE_FRAMES_SMALL);
  };

  const setHaze = (on: boolean, why: string) => {
    if (haze === on) return;
    haze = on;
    decide(`haze ${on ? 'on' : 'off'} (${why})`);
    unsettle(SETTLE_FRAMES_SMALL);
  };

  /** Rebuild in place at another tier, every layer at once; the old one keeps drawing meanwhile. */
  const switchTier = async (next: SceneTier, why: string, kind: 'up' | 'down') => {
    const current = world;
    if (!current || switching) return;
    switching = true;
    decide(`tier ${current.tier} → ${next} (${why})`);
    try {
      if (TIER_SETTINGS[next].bakedFissures) {
        await Promise.race([loadAtlas(), sleep(10000)]);
      }
      shaderLogs.length = 0;
      const w = buildCore(next);
      try {
        w.camera.copy(current.camera);
        await compile(w.scene, w);
        await buildAll(w);
      } catch (error) {
        w.dispose();
        throw error;
      }
      if (disposed || world !== current) {
        w.dispose();
        return;
      }
      w.monolith.setExtras(extras);
      w.sky.setExtras(extras);
      world = w;
      // A full extras state carries over; pointer heat is on from L6 anyway.
      current.dispose();
      if (!w.postActive) options.onWash?.(0, '');
      lastWashCss = '';
      if (kind === 'up') upgraded.add(next);
      else ceiling = next;
      resize();
      unsettle();
      options.onTierChange?.(next, why);
      settle();
    } catch (error) {
      issue(`tier ${next} failed: ${errorText(error)}`);
      if (kind === 'up') ceiling = current.tier;
      else options.onTierChange?.('poster', `${why}; ${next} failed: ${errorText(error)}`);
      settle();
    } finally {
      switching = false;
    }
  };

  const canUpgrade = (w: World): SceneTier | null => {
    if (options.fixedTier || capture) return null;
    const next = higherTier(w.tier);
    if (!next || upgraded.has(next) || ceiling === 'poster') return null;
    if (SCENE_TIERS.indexOf(next) > SCENE_TIERS.indexOf(ceiling)) return null;
    return next;
  };

  /**
   * Evidence the next tier would hold its frame rate. With GPU timer queries:
   * this tier's GPU time well under the next tier's frame budget. Without
   * them, only Lite (capped at 30 fps) can show headroom: every vsync arrived
   * on time, so a frame costs less than one refresh.
   */
  const upgradeEvidence = (w: World, next: SceneTier) => {
    const gpu = timer?.read();
    const nextBudget = 1000 / TIER_SETTINGS[next].fps;
    if (gpu && gpu.samples > 20 && gpu.ms.frame !== undefined)
      return gpu.ms.frame < nextBudget * 0.35;
    return w.settings.fps === 30 && rawMax > 0 && rawMax < vsync * 1.3;
  };

  const control = (w: World, interval: number, now: number) => {
    if (capture || switching || frameIndex < settleUntilFrame || w.fades.length) return;
    samples.push(interval);
    if (now - lastDecision < DECISION_MS || samples.length < 8) return;
    lastDecision = now;
    const average = samples.reduce((a, b) => a + b, 0) / samples.length;
    lastFrameMs = average;
    samples = [];
    const budget = 1000 / w.settings.fps;

    if (average > budget * 1.15) {
      headroomSince = 0;
      const why = `frame ${average.toFixed(1)} ms > ${(budget * 1.15).toFixed(1)}`;
      const effective = Math.min(scale, scaleCap);
      if (haze && w.post?.hazeCapable) setHaze(false, why);
      else if (effective > SCALE_MIN + 1e-3) setScale(effective - SCALE_DOWN, why);
      else if (extras) setExtras(false, why);
      else if (!options.fixedTier) {
        const lower = lowerTier(w.tier);
        if (lower) void switchTier(lower, why, 'down');
        else if (average > 1000 / POSTER_FPS && !gaveUp) {
          gaveUp = true;
          decide(`poster (${why} at minimum resolution)`);
          options.onTierChange?.(
            'poster',
            `lite can't hold ${POSTER_FPS} fps at half resolution (${why})`,
          );
        }
      }
      rawMax = 0;
      return;
    }
    if (average > budget * 1.05) {
      headroomSince = 0;
      rawMax = 0;
      return;
    }
    if (!headroomSince) {
      headroomSince = now;
      rawMax = 0;
    }
    const holdMs = now - headroomSince;
    if (scale < scaleCap && holdMs >= SCALE_UP_HOLD_MS) {
      setScale(
        scale + SCALE_UP,
        `holding ${average.toFixed(1)} ms for ${(holdMs / 1000).toFixed(1)} s`,
      );
    } else if (!extras && w.layer >= 6 && holdMs >= EXTRAS_HOLD_MS) {
      setExtras(true, 'frame budget allows');
    } else if (
      !haze &&
      !options.debugNoHaze &&
      w.post?.hazeCapable &&
      extras &&
      scale >= scaleCap &&
      holdMs >= HAZE_HOLD_MS
    ) {
      setHaze(true, 'frame budget allows');
    } else if (scale >= scaleCap && extras && holdMs >= UPGRADE_HOLD_MS) {
      // A capped page renders lighter than home: no evidence for a heavier tier there.
      const next = scaleCap >= 1 ? canUpgrade(w) : null;
      if (next && upgradeEvidence(w, next)) {
        void switchTier(
          next,
          `headroom for ${(holdMs / 1000).toFixed(0)} s at full resolution`,
          'up',
        );
      } else {
        // Settled where it is: remember it for this session.
        settle();
        headroomSince = now;
        rawMax = 0;
      }
    }
  };

  const tick = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const raw = now - lastTick;
    lastTick = now;
    // The display's refresh interval, from recent rAF gaps.
    if (raw > 3 && raw < 60) {
      vsyncs.push(raw);
      if (vsyncs.length > 30) vsyncs.shift();
      vsync = [...vsyncs].sort((a, b) => a - b)[vsyncs.length >> 1] ?? vsync;
    }
    rawMax = Math.max(rawMax, raw);

    const w = world;
    if (!w) return;
    // Frame pacing: render on whole vsyncs only, evenly, at the tier's rate.
    const budget = 1000 / w.settings.fps;
    const since = now - lastRender;
    if (firstFrame && since < budget - vsync * 0.5) return;
    lastRender = now;
    render(Math.min(since, 100) / 1000);
    frameIndex++;

    if (!firstFrame) {
      firstFrame = true;
      // Wait one more frame so the cross-fade starts from a frame that is on screen.
      requestAnimationFrame(() => options.onFirstFrame?.());
      if (!capture) void progressive(w);
      return;
    }
    control(w, since, now);

    // Lite on content pages: hold the still once nothing is moving.
    if (holdWhenIdle && !glide && flareAt < 0 && w.layer >= 6 && !w.fades.length && !switching) {
      if (++idleFrames > HOLD_AFTER_FRAMES) {
        held = true;
        stopLoop();
      }
    } else {
      idleFrames = 0;
    }
  };

  /** L2–L6, each once the previous one has faded in; L1 is already on screen. */
  const progressive = async (w: World) => {
    // L1's fissures ignite as the poster cross-fades away.
    fade(w, (v) => w.monolith.setFade(0.3 + 0.7 * v), false);
    const names = ['', '', 'L2 terrain', 'L3 lava', 'L4 embers', 'L5 post-processing'];
    for (const layer of [2, 3, 4, 5]) {
      try {
        await addLayer(w, layer, false);
      } catch (error) {
        issue(`${names[layer]} failed: ${errorText(error)}`);
        shaderLogs.length = 0;
      }
      if (w.disposed || world !== w) return;
      if (w.layer >= layer) phase(names[layer]!, w.tier);
      unsettle();
      await sleep(FADE_MS + 100);
    }
    if (w.disposed || world !== w) return;
    // L6: pointer heat always; the optional detail only if the budget allows.
    pointerOn = true;
    w.layer = 6;
    if (scale >= (options.startScale ?? 1) - 1e-3) setExtras(true, 'L6');
    phase('L6 extras', extras ? 'on' : 'deferred');
  };

  const stopLoop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const startLoop = () => {
    if (running || disposed) return;
    running = true;
    held = false;
    idleFrames = 0;
    lastTick = performance.now();
    lastRender = 0;
    unsettle();
    raf = requestAnimationFrame(tick);
  };

  const pause = () => {
    wanted = false;
    stopLoop();
  };

  const resume = () => {
    wanted = true;
    startLoop();
  };

  /** Something needs motion: wake a held still (only if the page wants the scene running). */
  const kick = () => {
    idleFrames = 0;
    if (wanted && !running) startLoop();
  };

  const onContextLost = (event: Event) => {
    event.preventDefault(); // allow the browser to restore it
    pause();
    options.onContextLost?.();
  };
  const onContextRestored = () => options.onContextRestored?.();
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const describe = () => {
    const w = world;
    if (!w) return 'none';
    const post = w.postActive ? `post, ${halfFloat ? 'half-float' : '8-bit'}` : 'no post';
    return `${w.tier}, ${post}`;
  };

  return {
    get description() {
      return describe();
    },
    get tier() {
      return world?.tier ?? options.tier;
    },
    get cameraProgress() {
      return cameraProgress;
    },
    get holding() {
      return held;
    },
    gpuTimings: () => timer?.read() ?? null,
    stats() {
      const w = world;
      if (!w) return [];
      const dpr = Math.min(window.devicePixelRatio || 1, w.settings.dpr);
      const layer = w.layer >= 6 ? 'L1–L6' : `L1–L${w.layer}`;
      return [
        `setup ${describe()} · ${layer}${atlas ? ` · atlas ${atlas.source}` : ''}`,
        `scale ${Math.min(scale, scaleCap).toFixed(2)} × dpr ${dpr.toFixed(2)} = ${(Math.min(scale, scaleCap) * dpr).toFixed(2)}` +
          (scaleCap < 1 ? ` (page cap ${scaleCap.toFixed(2)})` : '') +
          (options.fixedScale !== undefined ? ' (fixed)' : '') +
          (view ? ` · view ${view}${held ? ', held' : ''}` : ''),
        `target ${w.settings.fps} fps · frame ${lastFrameMs ? lastFrameMs.toFixed(1) : '…'} ms · extras ${extras ? 'on' : 'off'}` +
          (w.post?.hazeCapable ? ` · haze ${haze ? 'on' : 'off'}` : ''),
        ...decisions.map((d) => `· ${d}`),
      ];
    },
    setProgress(p, immediate = false) {
      if (capture) return;
      targetProgress = MathUtils.clamp(p, 0, 1);
      if (immediate) cameraProgress = targetProgress;
    },
    setStoryMap(map) {
      storyMap = map;
    },
    setChapter(index) {
      const i = MathUtils.clamp(Math.round(index), 0, 4);
      targetProgress = storyMap.chapters[i as 0 | 1 | 2 | 3 | 4];
    },
    setPointer(x, y) {
      pointerNdc.set(x, y);
    },
    setView(next, { immediate = false } = {}) {
      if (capture) return;
      if (next === view && !immediate) return;
      const w = world;
      if (immediate || !w || !framed) {
        glide = null;
      } else {
        // Glide from wherever the camera is now (mid-glide included) to the new framing.
        const from = copyFrame(frame, createFrame());
        const to = createFrame();
        if (next) viewAt(next, w.camera.aspect, to);
        else
          orbitAt(storyPosition(cameraProgress, storyMap, position).chapter, w.camera.aspect, to);
        glide = {
          from,
          fromState: copyState(chapterState, createChapterState()),
          elapsed: 0,
          duration: glideDuration(from, to),
        };
      }
      view = next;
      kick();
    },
    setScaleCap(cap) {
      const next = MathUtils.clamp(cap, SCALE_MIN, 1);
      if (next === scaleCap) return;
      scaleCap = next;
      resize();
      unsettle(SETTLE_FRAMES_SMALL);
      kick();
    },
    setHoldWhenIdle(hold) {
      holdWhenIdle = hold;
      if (!hold) kick();
    },
    flare() {
      flareAt = fadeClock;
      kick();
    },
    shimmer() {
      if (!world?.postActive) return;
      shimmerAt = fadeClock;
      kick();
    },
    pause,
    resume,
    dispose({ loseContext = true } = {}) {
      if (disposed) return;
      disposed = true;
      pause();
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      timer?.dispose();
      world?.dispose();
      world = null;
      noise.dispose();
      cells?.dispose();
      void atlasLoad?.then((loaded) => loaded?.dispose());
      renderer.dispose();
      if (loseContext) renderer.forceContextLoss();
    },
  };
}
