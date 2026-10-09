/**
 * The 2D landing page's motion (Phase 6), loaded after first paint. Only
 * transform, opacity and clip-path are animated.
 *
 * - The lava thread: its lit layer scales down the gutter with the page's
 *   scroll progress; each section's node lights as its section reaches 40%
 *   of the viewport.
 * - Work panels: on fine pointers, a slight tilt (at most 3°) and an ember glow
 *   that follows the pointer, both from --mx/--my set by one delegated,
 *   rAF-throttled pointermove.
 * - The Core: its glow rises with scroll as the section comes in.
 *
 * Section entrances are the shared reveals (src/lib/reveal.ts, mounted by
 * scene-boot). Reduced motion: nothing here runs; the thread shows fully lit
 * (CSS) and every block is in its final state.
 */
import { gsap, ScrollTrigger } from './scroll';
import { finePointer, prefersReducedMotion } from './motion';

export function mountLanding(root: HTMLElement): () => void {
  if (prefersReducedMotion()) return () => {};

  const ctx = gsap.context(() => {
    const fill = root.querySelector<HTMLElement>('[data-thread-fill]');
    if (fill) {
      ScrollTrigger.create({
        trigger: root,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => (fill.style.transform = `scaleY(${self.progress.toFixed(4)})`),
      });
    }

    root.querySelectorAll<HTMLElement>('[data-stratum]').forEach((section) => {
      const node = section.querySelector('[data-node]');
      if (!node) return;
      // Lit from when the section's top passes 60% down the viewport (40% of it showing).
      ScrollTrigger.create({
        trigger: section,
        start: 'top 60%',
        end: 'max',
        onEnter: () => node.classList.add('is-lit'),
        onLeaveBack: () => node.classList.remove('is-lit'),
      });
    });

    const glow = root.querySelector('[data-core-glow]');
    const core = glow?.closest('[data-stratum]');
    if (glow && core) {
      gsap.fromTo(
        glow,
        { opacity: 0.2 },
        {
          opacity: 1,
          ease: 'none',
          scrollTrigger: { trigger: core, start: 'top bottom', end: 'center center', scrub: true },
        },
      );
    }
  }, root);

  // ── Work panels: tilt and glow under the pointer ─────────────────────────
  const stops: (() => void)[] = [() => ctx.revert()];
  if (finePointer()) {
    root.classList.add('can-tilt');
    let active: HTMLElement | null = null;
    let pending: PointerEvent | null = null;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const event = pending;
      pending = null;
      if (!event) return;
      const panel = (event.target as Element | null)?.closest?.<HTMLElement>('[data-tilt]') ?? null;
      if (panel !== active) {
        active?.classList.remove('is-pointing');
        active = panel;
        active?.classList.add('is-pointing');
      }
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      panel.style.setProperty('--mx', ((event.clientX - box.left) / box.width).toFixed(3));
      panel.style.setProperty('--my', ((event.clientY - box.top) / box.height).toFixed(3));
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pending = event;
      raf ||= requestAnimationFrame(apply);
    };
    const onLeave = () => {
      active?.classList.remove('is-pointing');
      active = null;
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    stops.push(() => {
      cancelAnimationFrame(raf);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      root.classList.remove('can-tilt');
      onLeave();
    });
  }

  // Fonts change line lengths, so section heights: measure again once they're in.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());

  return () => stops.forEach((stop) => stop());
}
