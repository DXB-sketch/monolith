/**
 * Per-layer GPU time with EXT_disjoint_timer_query_webgl2 (dev tooling: only
 * created with ?fps, or on the /dev/scene route).
 *
 * Each layer's meshes open a TIME_ELAPSED query in onBeforeRender and close it
 * in onAfterRender (three draws objects one at a time, so queries never nest).
 * The whole frame is timed separately; post-processing is the frame's time
 * outside every scene draw. Results arrive a few frames late and are smoothed.
 */
import type { Object3D, WebGLRenderer } from 'three';

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface Pending {
  query: WebGLQuery;
  name: string;
}

export interface GpuTimings {
  /** Smoothed milliseconds per layer, plus `frame` (everything) and `post`. */
  ms: Record<string, number>;
  /** Frames with complete results so far. */
  samples: number;
}

export interface GpuTimer {
  /** Time every mesh under `object` as `name`. */
  track(object: Object3D, name: string): void;
  /** Wrap a whole frame. */
  beginFrame(): void;
  endFrame(): void;
  read(): GpuTimings;
  dispose(): void;
}

const SMOOTHING = 0.1;

export function createGpuTimer(renderer: WebGLRenderer): GpuTimer | null {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  if (!ext) return null;

  const free: WebGLQuery[] = [];
  const inFlight: Pending[][] = [];
  let frame: Pending[] = [];
  let active: Pending | null = null;
  let frameQuery: Pending | null = null;
  const ms: Record<string, number> = {};
  let samples = 0;

  const take = () => free.pop() ?? gl.createQuery()!;

  const begin = (name: string) => {
    // A layer draw inside the frame query would nest: the frame query is ended
    // first and the frame total becomes the sum of its parts (see endFrame).
    if (active) return;
    const pending = { query: take(), name };
    gl.beginQuery(ext.TIME_ELAPSED_EXT, pending.query);
    active = pending;
  };
  const end = () => {
    if (!active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    frame.push(active);
    active = null;
  };

  /** The frame is timed in slices between layer draws; slices count as `post`. */
  const openSlice = () => {
    if (frameQuery || active) return;
    frameQuery = { query: take(), name: 'post' };
    gl.beginQuery(ext.TIME_ELAPSED_EXT, frameQuery.query);
  };
  const closeSlice = () => {
    if (!frameQuery) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    frame.push(frameQuery);
    frameQuery = null;
  };

  const collect = () => {
    while (inFlight.length) {
      const batch = inFlight[0]!;
      const last = batch[batch.length - 1];
      if (last && !gl.getQueryParameter(last.query, gl.QUERY_RESULT_AVAILABLE)) break;
      inFlight.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      const totals: Record<string, number> = {};
      let total = 0;
      for (const p of batch) {
        const value = gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number;
        free.push(p.query);
        if (disjoint) continue;
        const t = value / 1e6;
        totals[p.name] = (totals[p.name] ?? 0) + t;
        total += t;
      }
      if (disjoint || !batch.length) continue;
      totals.frame = total;
      for (const [name, value] of Object.entries(totals)) {
        const prev = ms[name];
        ms[name] = prev === undefined ? value : prev + (value - prev) * SMOOTHING;
      }
      // Layers that drew nothing this frame decay toward zero.
      for (const name of Object.keys(ms)) {
        if (!(name in totals)) ms[name] = ms[name]! * (1 - SMOOTHING);
      }
      samples++;
    }
  };

  return {
    track(object, name) {
      object.traverse((child) => {
        child.onBeforeRender = () => {
          closeSlice();
          begin(name);
        };
        child.onAfterRender = () => {
          end();
          openSlice();
        };
      });
    },
    beginFrame() {
      collect();
      frame = [];
      openSlice();
    },
    endFrame() {
      closeSlice();
      end();
      if (frame.length) inFlight.push(frame);
      // Never let a stalled pipeline grow the queue without bound.
      while (inFlight.length > 8) {
        for (const p of inFlight.shift()!) free.push(p.query);
      }
    },
    read: () => ({ ms: { ...ms }, samples }),
    dispose() {
      for (const batch of inFlight) for (const p of batch) gl.deleteQuery(p.query);
      for (const q of free) gl.deleteQuery(q);
      inFlight.length = 0;
      free.length = 0;
    },
  };
}
