/**
 * The scene's public API. Pages and the scroll system talk to the scene only
 * through createScene() and the handle it returns (SCENE_SPEC.md).
 *
 * Setup degrades before it gives up: the requested tier with post-processing,
 * then without it, then (from High) Medium with and without. Each attempt is
 * checked (shader compile and link logs, framebuffer completeness, GPU memory)
 * before the first visible frame. Only when every attempt fails does
 * createScene() reject, and the page keeps the poster.
 */
import {
  ACESFilmicToneMapping,
  Color,
  HalfFloatType,
  MathUtils,
  Matrix4,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Ray,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Material,
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
import { cameraAt, createPose, idleOffset } from './camera-path';
import { blendChapterState, createChapterState } from './chapters';
import { createChannel } from './channel';
import { createEmbers, type EmbersModule } from './embers';
import { createLava } from './lava';
import { createMonolith, LAVA_LIGHT_COUNT, MONOLITH, type MonolithModule } from './monolith';
import { PALETTE_HEX } from './palette';
import {
  DOWNGRADE_FRAME_MS,
  TIER_SETTINGS,
  type QualityTier,
  type SceneTier,
  type TierSettings,
} from './quality';
import { createSky } from './sky';
import { DEFAULT_STORY_MAP, storyPosition, type StoryMap, type StoryPosition } from './story-map';
import { createTerrain, terrainHeight } from './terrain';
import type { SceneModule, SceneState } from './types';
import { createSharedUniforms, type SharedUniforms } from './uniforms';
import { WashEffect } from './wash';

export type { QualityTier, SceneTier } from './quality';
export type { StoryMap } from './story-map';

export interface SceneOptions {
  tier: SceneTier;
  /** Called once, after the first frame is on screen (cross-fade from the poster). */
  onFirstFrame?: () => void;
  /** Called when the scene drops a tier after the frame-time check. */
  onTierChange?: (tier: QualityTier, reason: string) => void;
  /** Load phases, for the ?fps overlay (e.g. 'shaders compiled'). */
  onPhase?: (phase: string, detail?: string) => void;
  /** Problems and degradations: shader logs, missing extensions, failed setups. */
  onIssue?: (message: string) => void;
  /** The GPU context was lost (show the poster) / restored (rebuild). */
  onContextLost?: () => void;
  onContextRestored?: () => void;
  /**
   * Without post-processing there is no WashEffect, so the Chapter 04 wash is
   * handed to the page to draw over the canvas (amount 0..1, CSS colour).
   */
  onWash?: (amount: number, cssColor: string) => void;
  /** Skip the frame-time check (a tier forced with ?tier= is never second-guessed). */
  fixedTier?: boolean;
  /** Poster capture: freeze time (and optionally story progress) and keep the drawing buffer. */
  capture?: { time: number; progress?: number };
  /** Dev only: object names to hide (sky, terrain, lava, monolith, embers). */
  debugHide?: string[];
  /** Dev only: render without post-processing. */
  debugNoPost?: boolean;
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
  /** Pointer position, normalised -1..1 (y up). */
  setPointer(x: number, y: number): void;
  pause(): void;
  resume(): void;
  /** Release everything. `loseContext: false` keeps the canvas usable for a rebuild. */
  dispose(options?: { loseContext?: boolean }): void;
  /** Which setup is running, for diagnostics (e.g. 'high, post, half-float'). */
  readonly description: string;
  /** Where the camera actually is in the story (damped), for diagnostics and tests. */
  readonly cameraProgress: number;
}

/**
 * Exponential smoothing on the camera's progress, per second. Lenis already
 * smooths the scroll, so this only adds a little weight; more would feel laggy.
 */
const PROGRESS_DAMPING = 7;
/** Base bloom and grain; both change through the Chapter 04 dive. */
const BLOOM_INTENSITY = 1.25;
const GRAIN_OPACITY = 0.1;
/** Frames ignored after the first one before frame times are judged (warm-up). */
const WARMUP_FRAMES = 30;
/** Running time sampled for the frame-time check, after the warm-up. */
const SAMPLE_SECONDS = 2;
/** Shader compilation gets this long before rendering compiles synchronously. */
const COMPILE_TIMEOUT_MS = 15000;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

interface SetupStep {
  tier: SceneTier;
  post: boolean;
}

/** One built attempt: everything that is torn down if the attempt fails. */
interface World {
  settings: TierSettings;
  scene: Scene;
  camera: PerspectiveCamera;
  shared: SharedUniforms;
  modules: SceneModule[];
  monolith: MonolithModule;
  embers: EmbersModule;
  composer: EffectComposer | null;
  bloom: BloomEffect | null;
  wash: WashEffect | null;
  grain: NoiseEffect | null;
  dispose(): void;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Every material reachable from the composer's passes and effects (post-processing). */
function collectPostMaterials(composer: EffectComposer): Material[] {
  const found = new Set<Material>();
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 3) return;
    seen.add(value);
    if ((value as Material).isMaterial) {
      found.add(value as Material);
      return;
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else
      for (const key of Object.keys(value))
        visit((value as Record<string, unknown>)[key], depth + 1);
  };
  for (const pass of composer.passes) {
    // Build the merged effect shader now (normally deferred to the first render).
    // Protected in the typings, public at runtime.
    if (pass instanceof EffectPass)
      (pass as unknown as { updateMaterial(): void }).updateMaterial();
    visit(pass, 0);
  }
  return [...found];
}

export async function createScene(
  canvas: HTMLCanvasElement,
  options: SceneOptions,
): Promise<SceneHandle> {
  const capture = options.capture;
  const issue = (message: string) => options.onIssue?.(message);
  const phase = (name: string, detail?: string) => options.onPhase?.(name, detail);

  // ── Renderer (one context for every attempt) ───────────────────────────
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
  };

  // Half-float colour buffers need an extension; without it, use 8-bit buffers
  // with dithering rather than render to an incomplete framebuffer.
  const halfFloat = Boolean(
    gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'),
  );
  if (!halfFloat)
    issue('half-float render targets unsupported: using 8-bit buffers with dithering');

  // ── Shared state across attempts ───────────────────────────────────────
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
  /** Where the scroll is, and where the camera is (damped toward it). */
  let targetProgress = capture?.progress ?? 0;
  let cameraProgress = targetProgress;
  const position: StoryPosition = { chapter: 0, dive: 0 };
  const pose = createPose();
  const drift = new Vector3();
  let drawingHeight = 1;
  let world: World | null = null;
  let step: SetupStep = { tier: options.tier, post: !options.debugNoPost };

  // ── Building one attempt ───────────────────────────────────────────────
  const buildWorld = async (attempt: SetupStep): Promise<World> => {
    const settings = TIER_SETTINGS[attempt.tier];
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

    // Post-processing (pmndrs/postprocessing: effects merge into one pass).
    let composer: EffectComposer | null = null;
    let bloom: BloomEffect | null = null;
    let wash: WashEffect | null = null;
    let grain: NoiseEffect | null = null;
    if (attempt.post) {
      composer = new EffectComposer(renderer, {
        frameBufferType: halfFloat ? HalfFloatType : UnsignedByteType,
        multisampling: settings.msaa,
      });
      composer.addPass(new RenderPass(scene, camera));
      bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.6,
        luminanceSmoothing: 0.3,
        intensity: BLOOM_INTENSITY,
        radius: 0.75,
        levels: settings.bloomLevels,
      });
      const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.62 });
      const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
      wash = new WashEffect();
      grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
      const effects = new EffectPass(camera, bloom, vignette, toneMapping, wash, grain);
      if (!halfFloat) effects.dithering = true;
      composer.addPass(effects);
      // Tone mapping happens in the effect chain.
      renderer.toneMapping = NoToneMapping;
    } else {
      // No effect chain: the materials tone-map and convert to sRGB themselves.
      renderer.toneMapping = ACESFilmicToneMapping;
    }

    return {
      settings,
      scene,
      camera,
      shared,
      modules,
      monolith,
      embers,
      composer,
      bloom,
      wash,
      grain,
      dispose() {
        for (const m of modules) m.dispose();
        composer?.dispose();
      },
    };
  };

  // ── Sizing ─────────────────────────────────────────────────────────────
  const resize = () => {
    if (!world) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, world.settings.dpr);
    renderer.setPixelRatio(dpr);
    if (world.composer) world.composer.setSize(width, height, false);
    else renderer.setSize(width, height, false);
    world.camera.aspect = width / height;
    drawingHeight = height * dpr;
    world.camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);

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
    if (Math.abs(pointerNdc.x) <= 1.2 && Math.abs(pointerNdc.y) <= 1.2) {
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
    if (w.wash) {
      w.wash.amount = washAmount;
      w.wash.color.copy(washColor);
    } else if (options.onWash) {
      const css = washAmount > 0 ? washColor.getStyle() : '';
      if (css !== lastWashCss) options.onWash(washAmount, css);
      lastWashCss = css;
    }
  };

  // ── Frame ──────────────────────────────────────────────────────────────
  const render = (dt: number) => {
    const w = world;
    if (!w) return;
    const { camera } = w;
    if (!capture) state.time += dt;
    state.delta = dt;
    w.shared.uTime.value = state.time;

    // Story position: damped camera progress mapped through the measured chapters.
    cameraProgress += (targetProgress - cameraProgress) * (1 - Math.exp(-dt * PROGRESS_DAMPING));
    if (Math.abs(targetProgress - cameraProgress) < 1e-5) cameraProgress = targetProgress;
    storyPosition(cameraProgress, storyMap, position);

    cameraAt(position, camera.aspect, pose);
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
    w.embers.setPointScale(drawingHeight / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2)));

    // Per-chapter scene state.
    blendChapterState(position, chapterState);
    state.faceHeat.fromArray(chapterState.faceHeat);
    state.emberDensity = chapterState.emberDensity;
    state.lavaIntensity = chapterState.lavaIntensity;
    state.fissureGain = chapterState.fissureGain;
    state.coreOpen = pose.dive;
    w.shared.uGlow.value = chapterState.glow;

    applyWash(w, position.dive);
    if (w.bloom) {
      w.bloom.intensity = BLOOM_INTENSITY + 1.6 * MathUtils.smoothstep(position.dive, 0, 0.5);
    }
    if (w.grain) w.grain.blendMode.opacity.value = (capture ? 0 : GRAIN_OPACITY) * (1 - washAmount);

    updatePointer(w, dt);
    for (const m of w.modules) m.update(state);
    if (w.composer) w.composer.render(dt);
    else renderer.render(w.scene, camera);
  };

  /**
   * Compile everything before the first visible frame (the poster is still up):
   * the scene's materials and the post chain's, in parallel where
   * KHR_parallel_shader_compile exists. Then a hidden warm-up render, and checks.
   */
  const prepare = async (w: World) => {
    resize();
    storyPosition(cameraProgress, storyMap, position);
    cameraAt(position, w.camera.aspect, pose);
    w.camera.position.copy(pose.position);
    w.camera.lookAt(pose.target);
    w.camera.updateMatrixWorld();

    const compileAll = async () => {
      await renderer.compileAsync(w.scene, w.camera);
      if (w.composer) {
        const quad = new PlaneGeometry(2, 2);
        const postScene = new Scene();
        for (const material of collectPostMaterials(w.composer)) {
          const mesh = new Mesh(quad, material);
          mesh.frustumCulled = false;
          postScene.add(mesh);
        }
        await renderer.compileAsync(postScene, w.camera);
        quad.dispose();
      }
    };
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error(`shader compilation took over ${COMPILE_TIMEOUT_MS}ms`)),
          COMPILE_TIMEOUT_MS,
        );
        compileAll().then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    } catch (error) {
      // Not fatal: the warm-up render compiles whatever is left, synchronously.
      issue(errorText(error));
    }
    if (shaderLogs.length) throw new Error(`shader compile/link failed: ${shaderLogs[0]}`);

    // Hidden warm-up frame: anything not yet compiled is compiled now, behind the poster.
    render(0);
    if (shaderLogs.length) throw new Error(`shader compile/link failed: ${shaderLogs[0]}`);
    if (gl.isContextLost()) throw new Error('WebGL context lost during setup');
    if (w.composer) {
      renderer.setRenderTarget(w.composer.inputBuffer);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      renderer.setRenderTarget(null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`post-processing framebuffer incomplete (0x${status.toString(16)})`);
      }
    }
    if (gl.getError() === gl.OUT_OF_MEMORY) throw new Error('out of GPU memory');
  };

  // ── The ladder ─────────────────────────────────────────────────────────
  const ladder: SetupStep[] = [];
  const posts = options.debugNoPost ? [false] : [true, false];
  const tiers: SceneTier[] = options.tier === 'high' ? ['high', 'medium'] : ['medium'];
  for (const tier of tiers) for (const post of posts) ladder.push({ tier, post });
  const label = (s: SetupStep) =>
    `${s.tier}, ${s.post ? `post, ${halfFloat ? 'half-float' : '8-bit'}` : 'no post'}`;

  for (const attempt of ladder) {
    if (gl.isContextLost()) break;
    let built: World | null = null;
    try {
      shaderLogs.length = 0;
      built = await buildWorld(attempt);
      world = built;
      await prepare(built);
      step = attempt;
      break;
    } catch (error) {
      issue(`setup "${label(attempt)}" failed: ${errorText(error)}`);
      built?.dispose();
      world = null;
    }
  }
  if (!world) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw new Error(
      gl.isContextLost() ? 'WebGL context lost during setup' : 'every scene setup failed',
    );
  }
  if (step !== ladder[0]) issue(`running reduced setup: ${label(step)}`);
  phase('shaders compiled', label(step));
  resizeObserver.observe(canvas);

  // ── Loop ───────────────────────────────────────────────────────────────
  let raf = 0;
  let running = false;
  let disposed = false;
  let firstFrame = false;
  let last = 0;

  // The frame-time check: starts after the first frame plus a warm-up, so shader
  // compilation and first uploads never count, then samples two seconds.
  let framesSinceFirst = 0;
  let sampledFrames = 0;
  let sampledTime = 0;
  let evaluated = Boolean(capture) || Boolean(options.fixedTier);

  const evaluate = () => {
    evaluated = true;
    if (!sampledFrames || !world) return;
    const average = (sampledTime / sampledFrames) * 1000;
    const tier = step.tier;
    if (average <= DOWNGRADE_FRAME_MS[tier]) return;
    const reason = `average frame ${average.toFixed(1)}ms over ${sampledFrames} frames after warm-up (limit ${DOWNGRADE_FRAME_MS[tier].toFixed(1)}ms)`;
    if (tier === 'high') {
      step = { ...step, tier: 'medium' };
      world.settings = TIER_SETTINGS.medium;
      if (world.composer) world.composer.multisampling = world.settings.msaa;
      world.embers.setMaxCount(world.settings.embers);
      resize();
      options.onTierChange?.('medium', reason);
    } else {
      options.onTierChange?.('low', reason);
    }
  };

  const tick = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const rawDt = (now - last) / 1000;
    last = now;
    render(Math.min(rawDt, 0.1));

    if (!firstFrame) {
      firstFrame = true;
      // Wait one more frame so the cross-fade starts from a frame that is on screen.
      requestAnimationFrame(() => options.onFirstFrame?.());
      return;
    }

    if (!evaluated) {
      framesSinceFirst++;
      if (framesSinceFirst > WARMUP_FRAMES) {
        sampledFrames++;
        // Real frame time (a stall still counts in full), capped so one hitch can't decide.
        sampledTime += Math.min(rawDt, 0.25);
        if (sampledTime >= SAMPLE_SECONDS) evaluate();
      }
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
    event.preventDefault(); // allow the browser to restore it
    pause();
    options.onContextLost?.();
  };
  const onContextRestored = () => options.onContextRestored?.();
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  return {
    get description() {
      return label(step);
    },
    get cameraProgress() {
      return cameraProgress;
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
    pause,
    resume,
    dispose({ loseContext = true } = {}) {
      if (disposed) return;
      disposed = true;
      pause();
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      world?.dispose();
      world = null;
      renderer.dispose();
      if (loseContext) renderer.forceContextLoss();
    },
  };
}
