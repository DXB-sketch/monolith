/**
 * Dev overlay for real-device testing: `?fps` on any page.
 * Loaded with a dynamic import only when the parameter is present, so it adds
 * nothing to normal page loads.
 *
 * Always visible: tier, live/resting/poster, average fps, 95th-percentile frame
 * time, effective DPR. Tap "Load" for the boot timings (performance marks from
 * src/lib/diagnostics.ts), and "Diagnostics" for the tier signals, fallback
 * reasons and scene errors (shader logs, framebuffer status, timeouts).
 */
import { getDiagnostics } from './diagnostics';
import { TIER_SETTINGS } from '../scene/quality';

const WINDOW = 120;

let started = false;

const style = (el: HTMLElement, rules: Partial<CSSStyleDeclaration>) =>
  Object.assign(el.style, rules);

export function mountFpsOverlay() {
  if (started) return;
  started = true;

  const el = document.createElement('div');
  el.dataset.fpsOverlay = '';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Performance overlay');
  style(el, {
    position: 'fixed',
    left: '8px',
    bottom: '8px',
    zIndex: '9999',
    maxWidth: 'min(92vw, 30rem)',
    maxHeight: '70vh',
    overflow: 'auto',
    padding: '6px 9px',
    font: '500 11px/1.45 "JetBrains Mono", ui-monospace, monospace',
    letterSpacing: '0.02em',
    color: 'var(--bone)',
    background: 'rgb(var(--basalt-rgb) / 0.88)',
    border: '1px solid var(--obsidian-edge)',
    borderRadius: '2px',
  });

  const live = document.createElement('div');
  style(live, { whiteSpace: 'pre' });

  const section = (title: string) => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = title;
    style(summary, { cursor: 'pointer', color: 'var(--ash)', marginTop: '4px' });
    const body = document.createElement('div');
    style(body, { whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '2px' });
    details.append(summary, body);
    return { details, body };
  };
  const load = section('Load');
  const diag = section('Diagnostics');
  el.append(live, load.details, diag.details);

  // ClientRouter replaces <body> on navigation: put the overlay back after each swap.
  const attach = () => {
    if (!el.isConnected) document.body.appendChild(el);
  };
  attach();
  document.addEventListener('astro:after-swap', attach);

  const renderDiagnostics = () => {
    const { entries, signals } = getDiagnostics();
    const marks = entries.filter((entry) => entry.kind === 'mark');
    load.body.textContent = marks.length
      ? marks.map((entry) => `${String(entry.t).padStart(6)}ms  ${entry.message}`).join('\n')
      : '(no marks yet)';

    const signalLines = Object.entries(signals).map(([name, value]) => `${name}: ${value}`);
    const problems = entries
      .filter((entry) => entry.kind !== 'mark')
      .map((entry) => `${String(entry.t).padStart(6)}ms  ${entry.kind}: ${entry.message}`);
    diag.body.textContent = [
      'tier signals',
      ...(signalLines.length ? signalLines.map((line) => `  ${line}`) : ['  (not read yet)']),
      '',
      'fallbacks, errors, notes',
      ...(problems.length ? problems.map((line) => `  ${line}`) : ['  none']),
    ].join('\n');
  };

  const deltas: number[] = [];
  let last = performance.now();
  let lastPaint = 0;

  const frame = (now: number) => {
    deltas.push(now - last);
    if (deltas.length > WINDOW) deltas.shift();
    last = now;

    if (now - lastPaint > 250 && deltas.length > 10) {
      lastPaint = now;
      const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const sorted = [...deltas].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? mean;
      const tier = document.documentElement.dataset.tier ?? 'pending';
      const cap = tier === 'high' || tier === 'medium' ? TIER_SETTINGS[tier].dpr : Infinity;
      const dpr = Math.min(window.devicePixelRatio || 1, cap);
      const stage = document.querySelector('[data-scene-stage]');
      const scene = stage?.classList.contains('is-live')
        ? stage.classList.contains('is-dormant')
          ? 'resting'
          : 'live'
        : 'poster';
      live.textContent =
        `tier ${tier} · ${scene}\n` +
        `${(1000 / mean).toFixed(1)} fps · p95 ${p95.toFixed(1)} ms\n` +
        `dpr ${dpr.toFixed(2)} (device ${(window.devicePixelRatio || 1).toFixed(2)})`;
      // Only rebuild the sections that are open (they can be long).
      if (load.details.open || diag.details.open) renderDiagnostics();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  load.details.addEventListener('toggle', renderDiagnostics);
  diag.details.addEventListener('toggle', renderDiagnostics);
}
