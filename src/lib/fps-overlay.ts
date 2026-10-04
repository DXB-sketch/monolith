/**
 * Dev overlay for real-device testing: `?fps` on any page.
 * Loaded with a dynamic import only when the parameter is present, so it adds
 * nothing to normal page loads. Shows the quality tier, the effective device
 * pixel ratio, average fps and the 95th-percentile frame time over the last
 * two seconds, and whether the scene is live or resting.
 */
import { TIER_SETTINGS } from '../scene/quality';

const WINDOW = 120;

let started = false;

export function mountFpsOverlay() {
  if (started) return;
  started = true;

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.fpsOverlay = '';
  Object.assign(el.style, {
    position: 'fixed',
    left: '8px',
    bottom: '8px',
    zIndex: '9999',
    padding: '6px 9px',
    font: '500 11px/1.45 "JetBrains Mono", ui-monospace, monospace',
    letterSpacing: '0.04em',
    color: 'var(--bone)',
    background: 'rgb(var(--basalt-rgb) / 0.82)',
    border: '1px solid var(--obsidian-edge)',
    borderRadius: '2px',
    pointerEvents: 'none',
    whiteSpace: 'pre',
  });

  // ClientRouter replaces <body> on navigation: put the overlay back after each swap.
  const attach = () => {
    if (!el.isConnected) document.body.appendChild(el);
  };
  attach();
  document.addEventListener('astro:after-swap', attach);

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
      el.textContent =
        `tier ${tier} · ${scene}\n` +
        `${(1000 / mean).toFixed(1)} fps · p95 ${p95.toFixed(1)} ms\n` +
        `dpr ${dpr.toFixed(2)} (device ${(window.devicePixelRatio || 1).toFixed(2)})`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
