/**
 * Scroll infrastructure for the home story: one Lenis instance driven from the
 * GSAP ticker, feeding ScrollTrigger. Lives in the lazily loaded story chunk.
 *
 * Smooth scrolling applies to wheel and trackpad only; touch devices keep
 * native scrolling (`syncTouch: false`). Lenis exists only in the story's full
 * mode: with reduced motion, tier Off or Low, or while the tier is still being
 * decided, ScrollTrigger reads native scroll.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);
// Mobile address-bar show/hide changes the viewport height; don't refresh on it.
ScrollTrigger.config({ ignoreMobileResize: true });

export interface SmoothScroll {
  lenis: Lenis;
  scrollTo(y: number, onComplete?: () => void): void;
  destroy(): void;
}

/** Lenis on the GSAP ticker. Created and destroyed in place; never jumps the scroll. */
export async function createSmoothScroll(): Promise<SmoothScroll> {
  const { default: LenisClass } = await import('lenis');
  const lenis = new LenisClass({
    autoRaf: false,
    syncTouch: false,
    // Weighty, not floaty: the expo-out feel from ART_DIRECTION.md.
    lerp: 0.1,
    wheelMultiplier: 0.9,
  });
  const raf = (time: number) => lenis.raf(time * 1000);
  const onScroll = () => ScrollTrigger.update();
  lenis.on('scroll', onScroll);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);

  return {
    lenis,
    scrollTo(y, onComplete) {
      lenis.scrollTo(y, { duration: 1.6, onComplete: () => onComplete?.() });
    },
    destroy() {
      gsap.ticker.remove(raf);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.off('scroll', onScroll);
      lenis.destroy();
    },
  };
}

/** Native, instant scroll (no Lenis). */
export function nativeScrollTo(y: number, onComplete?: () => void) {
  window.scrollTo({ top: y, behavior: 'instant' });
  onComplete?.();
}

export { gsap, ScrollTrigger };
