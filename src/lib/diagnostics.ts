/**
 * Boot diagnostics for real-device testing.
 *
 * - Load timings are performance marks (`monolith:<name>`), recorded only with
 *   `?fps` or `?debug`, so a normal visit pays nothing for them.
 * - Fallback reasons and scene errors are always kept (they are rare and tiny),
 *   so the `?fps` overlay can explain why a page is showing the poster.
 * - `?debug` also logs every entry to the console.
 *
 * In the initial bundle: keep it small and free of dependencies.
 */

const params = new URLSearchParams(location.search);
export const TIMING_ENABLED = params.has('fps') || params.has('debug');
const DEBUG = params.has('debug');

export type DiagnosticKind = 'mark' | 'fallback' | 'error' | 'info';

export interface DiagnosticEntry {
  /** Milliseconds since navigation start. */
  t: number;
  kind: DiagnosticKind;
  message: string;
}

const entries: DiagnosticEntry[] = [];
/** Tier signals as they were read: GPU string, memory, cores, DPR, screen. */
const signals: Record<string, string> = {};
const MAX_ENTRIES = 80;

function push(kind: DiagnosticKind, message: string) {
  const entry = { t: Math.round(performance.now()), kind, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  if (DEBUG) {
    const log =
      kind === 'error' ? console.error : kind === 'fallback' ? console.warn : console.info;
    log(`[monolith] +${entry.t}ms ${kind}: ${message}`);
  }
}

/** A load timing. Free without ?fps / ?debug. */
export function mark(name: string, detail?: string) {
  if (!TIMING_ENABLED) return;
  performance.mark(`monolith:${name}`);
  push('mark', detail ? `${name} (${detail})` : name);
}

/** The page fell back (to the poster, or to a lower setting). Always recorded. */
export function fallback(reason: string) {
  push('fallback', reason);
}

/** Something failed (shader log, framebuffer status, timeout). Always recorded. */
export function error(message: string) {
  push('error', message);
}

export function info(message: string) {
  if (TIMING_ENABLED) push('info', message);
}

export function setSignal(name: string, value: string) {
  signals[name] = value;
  if (DEBUG) console.info(`[monolith] signal ${name}: ${value}`);
}

export function getDiagnostics() {
  return { entries, signals };
}

/** Live scene numbers for the ?fps overlay (GPU time per layer, resolution scale, decisions). */
export interface SceneStats {
  /** Smoothed GPU milliseconds per layer, plus `frame` and `post`; null without timer queries. */
  gpu: Record<string, number> | null;
  /** Free-form lines: setup, resolution scale, layers, controller state. */
  lines: string[];
}

let statsProvider: (() => SceneStats | null) | null = null;

export function setSceneStats(provider: (() => SceneStats | null) | null) {
  statsProvider = provider;
}

export function getSceneStats(): SceneStats | null {
  return statsProvider?.() ?? null;
}

/** Reject after `ms` with a recorded timeout, so no boot step can wait forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  let timer = 0;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => {
        const message = `${step} timed out after ${ms}ms`;
        error(message);
        reject(new Error(message));
      }, ms);
    }),
  ]);
}
