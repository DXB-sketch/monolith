/**
 * The scene's public API. Pages and the scroll system talk to the scene only
 * through createScene() and the handle it returns (SCENE_SPEC.md).
 */
import {
  Color,
  HalfFloatType,
  MathUtils,
  Matrix4,
  NoToneMapping,
  PerspectiveCamera,
  Ray,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { framingFor, idleOffset } from './camera-path';
import { createChannel } from './channel';
import { createEmbers } from './embers';
import { createLava } from './lava';
import { createMonolith, LAVA_LIGHT_COUNT, MONOLITH } from './monolith';
import { PALETTE_HEX } from './palette';
import { DOWNGRADE_FRAME_MS, TIER_SETTINGS, type QualityTier, type SceneTier } from './quality';
import { createSky } from './sky';
import { createTerrain, terrainHeight } from './terrain';
import type { SceneModule, SceneState } from './types';
import { createSharedUniforms } from './uniforms';

export type { QualityTier, SceneTier } from './quality';

export interface SceneOptions {
  tier: SceneTier;
  /** Called once, after the first frame is on screen (cross-fade from the poster). */
  onFirstFrame?: () => void;
  /** Called when the scene drops a tier after the 3-second check, or loses its context. */
  onTierChange?: (tier: QualityTier) => void;
  /** Poster capture: freeze time at this value and keep the drawing buffer. */
  capture?: { time: number };
  /** Dev only: object names to hide (sky, terrain, lava, monolith, embers). */
  debugHide?: string[];
  /** Dev only: render without post-processing. */
  debugNoPost?: boolean;
}

export interface SceneHandle {
  /** 0..1 scroll progress through the home story. Stub until Phase 2. */
  setProgress(p: number): void;
  /** Jump to a chapter's framing, for non-home pages and direct links. Stub until Phase 2. */
  setChapter(index: number): void;
  /** Pointer position, normalised -1..1 (y up). */
  setPointer(x: number, y: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

/** Ember density and lava brightness for Chapter 00. Phase 2 varies these per chapter. */
const ARRIVAL = { emberDensity: 0.55, lavaIntensity: 1 } as const;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function createScene(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
): Promise<SceneHandle> {
  let tier: SceneTier = options.tier;
  let settings = TIER_SETTINGS[tier];
  const capture = options.capture;

  // ── Renderer and scene graph ───────────────────────────────────────────
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: Boolean(capture),
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping; // ACES is applied in the effect chain
  renderer.toneMappingExposure = 0.92;
  renderer.setClearColor(new Color(PALETTE_HEX.basalt));

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.5, 6000);
  const shared = createSharedUniforms();
  const channel = createChannel();

  // Yield between heavier builds so the main thread stays responsive.
  const sky = createSky(shared);
  const terrain = createTerrain(shared, settings, channel);
  await nextFrame();
  const lava = createLava(shared, channel);
  const monolith = createMonolith(shared, settings);
  const embers = createEmbers(shared, settings.embers, channel);
  await nextFrame();

  monolith.setLavaLights(
    channel.lightsNear(LAVA_LIGHT_COUNT, 14).map((light) => {
      light.y = terrainHeight(light.x, light.z) + 0.3;
      return light;
    }),
  );

  const modules: SceneModule[] = [sky, terrain, lava, monolith, embers];
  for (const m of modules) {
    m.object.visible = !options.debugHide?.includes(m.object.name);
    scene.add(m.object);
  }

  // ── Post-processing (pmndrs/postprocessing: effects merge into one pass) ──
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    multisampling: settings.msaa,
  });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.6,
    luminanceSmoothing: 0.3,
    intensity: 1.25,
    radius: 0.75,
    levels: settings.bloomLevels,
  });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.62 });
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  // Grain is per-pixel noise: leave it out of poster captures, where it would only cost bytes.
  grain.blendMode.opacity.value = capture ? 0 : 0.1;
  composer.addPass(new EffectPass(camera, bloom, vignette, toneMapping, grain));

  // ── State ──────────────────────────────────────────────────────────────
  const state: SceneState = {
    time: capture?.time ?? 0,
    delta: 0,
    faceHeat: new Vector4(0, 0, 0, 0),
    pointerPoint: new Vector3(0, -100, 0),
    pointerHeat: 0,
    emberDensity: ARRIVAL.emberDensity,
    lavaIntensity: ARRIVAL.lavaIntensity,
  };
  let chapter = 0;
  let progress = 0;

  // ── Sizing ─────────────────────────────────────────────────────────────
  const framing = framingFor(0, 16 / 9);
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, settings.dpr);
    renderer.setPixelRatio(dpr);
    composer.setSize(width, height, false);
    camera.aspect = width / height;
    framingFor(chapter, camera.aspect, framing);
    camera.fov = framing.fov;
    camera.updateProjectionMatrix();
    embers.setPointScale((height * dpr) / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2)));
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

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
  const bounds = monolith.bounds;

  const updatePointer = (dt: number) => {
    let targetHeat = 0;
    if (Math.abs(pointerNdc.x) <= 1.2 && Math.abs(pointerNdc.y) <= 1.2) {
      ray.origin.setFromMatrixPosition(camera.matrixWorld);
      ray.direction
        .set(pointerNdc.x, pointerNdc.y, 0.5)
        .unproject(camera)
        .sub(ray.origin)
        .normalize();
      inverse.copy(monolith.mesh.matrixWorld).invert();
      localRay.copy(ray).applyMatrix4(inverse);
      if (localRay.intersectBox(bounds, hitPoint)) {
        targetHeat = 1;
      } else {
        // Near miss: heat the closest part of the stone, fading with distance.
        const d2 = localRay.distanceSqToSegment(axisBottom, axisTop, onRay, onAxis);
        bounds.clampPoint(onRay, hitPoint);
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

  // ── Loop ───────────────────────────────────────────────────────────────
  let raf = 0;
  let running = false;
  let disposed = false;
  let firstFrame = false;
  let last = 0;
  const drift = new Vector3();

  // Re-evaluate the tier once, using frames between 1s and 3s of running time.
  let runningTime = 0;
  let sampledFrames = 0;
  let sampledTime = 0;
  let evaluated = Boolean(capture);

  const evaluate = () => {
    evaluated = true;
    if (!sampledFrames) return;
    const average = (sampledTime / sampledFrames) * 1000;
    if (average <= DOWNGRADE_FRAME_MS[tier]) return;
    if (tier === 'high') {
      tier = 'medium';
      settings = TIER_SETTINGS.medium;
      composer.multisampling = settings.msaa;
      embers.setMaxCount(settings.embers);
      resize();
      options.onTierChange?.('medium');
    } else {
      options.onTierChange?.('low');
    }
  };

  const render = (dt: number) => {
    if (!capture) state.time += dt;
    state.delta = dt;
    shared.uTime.value = state.time;

    framingFor(chapter, camera.aspect, framing);
    idleOffset(state.time, drift);
    camera.position.copy(framing.position).add(drift);
    camera.lookAt(framing.target);
    camera.updateMatrixWorld();

    updatePointer(dt);
    for (const m of modules) m.update(state);
    if (options.debugNoPost) renderer.render(scene, camera);
    else composer.render(dt);
  };

  const tick = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    render(dt);

    if (!firstFrame) {
      firstFrame = true;
      // Wait one more frame so the cross-fade starts from a frame that is on screen.
      requestAnimationFrame(() => options.onFirstFrame?.());
    }

    if (!evaluated) {
      runningTime += dt;
      if (runningTime > 1) {
        sampledFrames++;
        sampledTime += dt;
      }
      if (runningTime > 3) evaluate();
    }
  };

  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const resume = () => {
    if (running || disposed) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    pause();
    options.onTierChange?.('low');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  // Compile every shader up front without blocking (KHR_parallel_shader_compile).
  camera.position.copy(framing.position);
  camera.lookAt(framing.target);
  camera.updateMatrixWorld();
  await renderer.compileAsync(scene, camera);

  return {
    setProgress(p) {
      // Phase 2: drives the camera path and per-chapter scene states.
      progress = MathUtils.clamp(p, 0, 1);
      void progress;
    },
    setChapter(index) {
      // Phase 2 adds keyframes for chapters 01–04; until then this holds Chapter 00.
      chapter = Math.max(0, Math.round(index));
      resize();
    },
    setPointer(x, y) {
      pointerNdc.set(x, y);
    },
    pause,
    resume,
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      for (const m of modules) m.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
