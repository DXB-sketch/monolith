/**
 * The custom cursor and pointer-driven hover details (Phase 4). Loaded only on
 * desktops with a fine pointer and no reduced-motion preference; touch screens
 * and reduced motion never download it.
 *
 * - A small ring in bone follows the pointer with slight inertia; a tiny dot
 *   tracks it exactly. The native cursor always stays visible underneath.
 * - Over links and buttons the ring grows and warms toward lava; over project
 *   rows and cards it reads "View"; over the Lab demo's sliders, "Drag". The
 *   label is decorative (the whole cursor is aria-hidden).
 * - Never over text fields, selects or any iframe: the
 *   native cursor alone does that job.
 * - Transforms only, updated in requestAnimationFrame, and the loop stops as
 *   soon as the ring has caught up (or the pointer leaves the window).
 *
 * The same pointer listener feeds the hover language: buttons and panels get
 * the pointer's position as --mx / --my for their warm glow and sheen, and the
 * primary "Start a project" buttons lean up to 6 px toward the pointer.
 */
type CursorState = 'idle' | 'link' | 'view' | 'drag' | 'hidden';

const HIDE = 'input:not([type=range]), textarea, select, iframe, [contenteditable]';
const DRAG = 'input[type=range], [data-cursor="drag"]';
const VIEW = '[data-cursor="view"]';
const LINK = 'a, button, summary, label, [role="button"]';
const GLOW = '.btn, [data-sheen]';
const MAGNET = '[data-magnetic]';
/** Inertia of the ring: the share of the remaining distance covered each frame (60 fps). */
const FOLLOW = 0.22;
const MAGNET_PX = 6;

let root: HTMLElement | null = null;
let ring: HTMLElement | null = null;
let dot: HTMLElement | null = null;
let label: HTMLElement | null = null;
let x = -100;
let y = -100;
let rx = -100;
let ry = -100;
let raf = 0;
let last = 0;
let state: CursorState = 'hidden';
let magnet: HTMLElement | null = null;
let abort: AbortController | null = null;

function setState(next: CursorState) {
  if (next === state || !root) return;
  state = next;
  root.dataset.state = next;
  if (label) label.textContent = next === 'view' ? 'View' : next === 'drag' ? 'Drag' : '';
}

function stateFor(target: Element | null): CursorState {
  if (!target) return 'idle';
  if (target.closest(HIDE)) return 'hidden';
  if (target.closest(DRAG)) return 'drag';
  if (target.closest(VIEW)) return 'view';
  if (target.closest(LINK)) return 'link';
  return 'idle';
}

function frame(now: number) {
  raf = 0;
  const dt = last ? Math.min(64, now - last) : 16;
  last = now;
  // Frame-rate independent easing toward the pointer.
  const k = 1 - Math.pow(1 - FOLLOW, dt / 16.67);
  rx += (x - rx) * k;
  ry += (y - ry) * k;
  if (ring) ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
  if (Math.abs(x - rx) + Math.abs(y - ry) > 0.2) raf = requestAnimationFrame(frame);
  else last = 0;
}

function kick() {
  if (!raf) raf = requestAnimationFrame(frame);
}

function release(el: HTMLElement | null) {
  if (!el) return;
  el.style.removeProperty('--mag-x');
  el.style.removeProperty('--mag-y');
}

function onMove(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return;
  x = event.clientX;
  y = event.clientY;
  if (dot) dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  if (rx < -50) {
    // Appearing (first move, or back into the window): start the ring at the pointer.
    rx = x;
    ry = y;
  }
  const target = event.target instanceof Element ? event.target : null;
  setState(stateFor(target));
  kick();

  // Warm glow and sheen: the pointer's position inside the element.
  const glow = target?.closest<HTMLElement>(GLOW);
  if (glow) {
    const box = glow.getBoundingClientRect();
    glow.style.setProperty('--mx', `${x - box.left}px`);
    glow.style.setProperty('--my', `${y - box.top}px`);
  }

  // A slight magnetic lean on the primary "Start a project" buttons.
  const next = target?.closest<HTMLElement>(MAGNET) ?? null;
  if (next !== magnet) {
    release(magnet);
    magnet = next;
  }
  if (magnet) {
    const box = magnet.getBoundingClientRect();
    const dx = (x - (box.left + box.width / 2)) / (box.width / 2);
    const dy = (y - (box.top + box.height / 2)) / (box.height / 2);
    magnet.style.setProperty(
      '--mag-x',
      `${(Math.max(-1, Math.min(1, dx)) * MAGNET_PX).toFixed(2)}px`,
    );
    magnet.style.setProperty(
      '--mag-y',
      `${(Math.max(-1, Math.min(1, dy)) * MAGNET_PX).toFixed(2)}px`,
    );
  }
}

function onLeave() {
  setState('hidden');
  release(magnet);
  magnet = null;
  cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
  rx = -100;
}

export function mountCursor() {
  root = document.querySelector<HTMLElement>('[data-cursor-root]');
  if (!root || abort) return;
  ring = root.querySelector('[data-cursor-ring]');
  dot = root.querySelector('[data-cursor-dot]');
  label = root.querySelector('[data-cursor-label]');
  abort = new AbortController();
  const { signal } = abort;
  document.documentElement.classList.add('cursor-on');
  window.addEventListener('pointermove', onMove, { passive: true, signal });
  document.documentElement.addEventListener('pointerleave', onLeave, { signal });
  window.addEventListener('blur', onLeave, { signal });
  // A page change: whatever was under the pointer is gone.
  document.addEventListener('astro:after-swap', () => setState('idle'), { signal });

  // Switched to reduced motion, or a touch screen took over: stand down.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const check = () => {
    if (reduced.matches || !fine.matches) unmountCursor();
  };
  reduced.addEventListener('change', check, { signal });
  fine.addEventListener('change', check, { signal });
}

export function unmountCursor() {
  abort?.abort();
  abort = null;
  onLeave();
  document.documentElement.classList.remove('cursor-on');
}
