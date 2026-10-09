/**
 * Small motion helpers shared by the 2D pages (Phase 6). Tiny and dependency
 * free: safe for the initial bundle.
 */
export { prefersReducedMotion } from '../scene/quality';

/** Run after the browser has painted the HTML, preferably when idle. */
export function afterFirstPaint(task: () => void) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout: 1200 });
      else task();
    }, 0);
  });
}

/** After the window's `load` event, when the main thread is idle. */
export function afterLoadIdle(task: () => void) {
  const idle = () => {
    if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout: 2000 });
    else setTimeout(task, 200);
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

/** A mouse or trackpad: hover effects that follow the pointer make sense. */
export const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
