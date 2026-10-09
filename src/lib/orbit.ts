/**
 * The 2D hero's stone (Phase 6), loaded after first paint: frames rendered
 * from the real scene (npm run orbit), turned by scroll.
 *
 * Frame 0 is the page's own <picture>, so the hero is complete without this.
 * After `load`, at idle, the frames the scroll can reach are fetched (coarse
 * to fine, so any angle soon has a near neighbour), decoded with
 * createImageBitmap, and drawn to a canvas over the picture (2D context, at
 * the figure's size and device pixel ratio up to 2):
 *   desktop (≥ 900px)  the hero pins for one viewport while the stone turns 180°
 *   below              no pin; the stone turns 90° as the hero scrolls out
 * The nearest loaded frame shows until the exact one arrives; the readout
 * follows. Off screen, nothing is drawn or fetched. Save-data, reduced motion
 * and 2g/3g keep frame 0. Bitmaps are released when the page is swapped.
 */
import { gsap } from './scroll';
import { afterLoadIdle, prefersReducedMotion } from './motion';
import { saveData, slowConnection } from '../scene/quality';

interface FrameSet {
  frames: string[];
  /** Degrees between consecutive frames. */
  step: number;
}

interface Manifest {
  base: string;
  desktop: FrameSet;
  phone: FrameSet;
}

const DESKTOP = '(min-width: 900px)';
const PHONE = '(max-width: 899.98px)';
const CONCURRENCY = 4;
const MAX_DPR = 2;

/** 0, n, n/2, n/4, 3n/4… : every frame, coarse to fine. */
function coarseToFine(last: number): number[] {
  const order = [0, last];
  const seen = new Set(order);
  for (let gap = last; gap > 1; gap = Math.ceil(gap / 2)) {
    for (let i = 0; i <= last; i += gap) {
      const mid = Math.min(last, i + Math.ceil(gap / 2));
      if (!seen.has(mid)) {
        seen.add(mid);
        order.push(mid);
      }
    }
  }
  for (let i = 0; i <= last; i++) if (!seen.has(i)) order.push(i);
  return order;
}

/** One frame set at one sweep: loads, holds and draws the frames. */
function createPlayer(
  figure: HTMLElement,
  canvas: HTMLCanvasElement,
  readout: HTMLElement | null,
  base: string,
  set: FrameSet,
  sweep: number,
) {
  const last = Math.min(set.frames.length - 1, Math.round(sweep / set.step));
  const bitmaps: (ImageBitmap | undefined)[] = [];
  const order = coarseToFine(last);
  const abort = new AbortController();
  const context = canvas.getContext('2d', { alpha: false });
  let visible = true;
  let started = false;
  let disposed = false;
  let inFlight = 0;
  let next = 0;
  let angle = 0;
  let drawn = -1;

  const resize = () => {
    const box = figure.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.max(1, Math.round(box.width * dpr));
    const height = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      drawn = -1;
      draw();
    }
  };

  /** The loaded frame nearest the wanted one (searching outward), or -1. */
  const nearest = (wanted: number) => {
    for (let d = 0; d <= last; d++) {
      if (bitmaps[wanted - d]) return wanted - d;
      if (bitmaps[wanted + d]) return wanted + d;
    }
    return -1;
  };

  function draw() {
    if (disposed || !visible || !context) return;
    const wanted = Math.min(last, Math.max(0, Math.round(angle / set.step)));
    const index = nearest(wanted);
    if (index < 0 || index === drawn) return;
    context.drawImage(bitmaps[index]!, 0, 0, canvas.width, canvas.height);
    drawn = index;
    figure.dataset.orbitState = 'live';
    if (readout) readout.textContent = `${String(Math.round(index * set.step)).padStart(3, '0')}°`;
  }

  // Fetching runs in parallel (network only); decoding is one frame per idle
  // callback, so a burst of arriving frames never becomes one long task.
  const decodeQueue: { index: number; blob: Blob }[] = [];
  let decoding = false;
  const idle = (task: () => void) =>
    'requestIdleCallback' in window
      ? requestIdleCallback(task, { timeout: 1000 })
      : setTimeout(task, 16);

  const decodeNext = () => {
    if (decoding || disposed || !visible) return;
    const job = decodeQueue.shift();
    if (!job) return;
    decoding = true;
    idle(() => {
      createImageBitmap(job.blob)
        .then((bitmap) => {
          if (disposed) return bitmap.close();
          bitmaps[job.index] = bitmap;
          draw();
        })
        .catch(() => {
          // An undecodable frame only means a neighbour shows instead.
        })
        .finally(() => {
          decoding = false;
          decodeNext();
        });
    });
  };

  const pump = () => {
    while (!disposed && visible && started && inFlight < CONCURRENCY && next < order.length) {
      const index = order[next++]!;
      inFlight++;
      fetch(base + set.frames[index], { signal: abort.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.blob();
        })
        .then((blob) => {
          decodeQueue.push({ index, blob });
          decodeNext();
        })
        .catch(() => {
          // A missing frame only means a neighbour shows instead.
        })
        .finally(() => {
          inFlight--;
          pump();
        });
    }
  };

  const observer = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    if (visible) {
      draw();
      pump();
      decodeNext();
    }
  });
  observer.observe(figure);
  const sizer = new ResizeObserver(resize);
  sizer.observe(figure);
  resize();

  afterLoadIdle(() => {
    started = true;
    pump();
  });

  return {
    set angle(value: number) {
      angle = value;
      draw();
    },
    dispose() {
      disposed = true;
      abort.abort();
      observer.disconnect();
      sizer.disconnect();
      bitmaps.forEach((bitmap) => bitmap?.close());
      bitmaps.length = 0;
      delete figure.dataset.orbitState;
    },
  };
}

export function mountOrbit(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>('[data-orbit]');
  const canvas = figure?.querySelector<HTMLCanvasElement>('[data-orbit-canvas]');
  const hero = figure?.closest<HTMLElement>('[data-stratum]');
  if (!figure || !canvas || !hero) return () => {};
  if (prefersReducedMotion() || saveData() || slowConnection()) {
    figure.dataset.orbitState = 'still';
    return () => {};
  }
  const manifest = JSON.parse(figure.dataset.manifest ?? '{}') as Manifest;
  const readout = figure.querySelector<HTMLElement>('[data-orbit-angle]');

  const mm = gsap.matchMedia();
  mm.add({ desktop: DESKTOP, phone: PHONE }, (context) => {
    const desktop = Boolean(context.conditions?.desktop);
    const sweep = desktop ? 180 : 90;
    const player = createPlayer(
      figure,
      canvas,
      readout,
      manifest.base,
      desktop ? manifest.desktop : manifest.phone,
      sweep,
    );
    const turn = { angle: 0 };
    gsap.to(turn, {
      angle: sweep,
      ease: 'none',
      onUpdate: () => (player.angle = turn.angle),
      scrollTrigger: desktop
        ? { trigger: hero, start: 'top top', end: '+=100%', pin: true, scrub: 0.6 }
        : { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 },
    });
    return () => player.dispose();
  });

  return () => mm.revert();
}
