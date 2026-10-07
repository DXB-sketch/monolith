/**
 * Content reveals, shared by the home story and the content pages. Lives in a
 * lazy chunk with GSAP; nothing loads on pages without `[data-reveal]`.
 *
 * The rules (unchanged from Phase 2):
 * - Hidden states exist only once JS has marked the page `motion-ready`, and
 *   only for blocks still below the viewport at that moment: nothing already
 *   in view is ever hidden (first load, deep links, back navigation).
 * - Opacity only (plus a small rise): `visibility: hidden` would drop links out
 *   of the tab order. Focus landing inside an unrevealed block completes it.
 * - SplitText only on headings (`data-reveal="lines"`), with `aria: 'auto'`
 *   (the heading keeps its full text as its accessible name).
 * - `full`: lines rise from a mask, blocks rise and fade (expo.out).
 *   `lite` (the poster tier): simple fades, no SplitText.
 *   Reduced motion: never mounted at all.
 * - Each reveal plays once. Every trigger and tween belongs to this
 *   controller and is killed by destroy(); nothing global is touched.
 */
import { gsap, ScrollTrigger } from './scroll';

export type RevealMode = 'full' | 'lite';

export interface RevealController {
  /** Show everything now and remove every trigger (reduced motion switched on). */
  finish(): void;
  destroy(): void;
  /** Blocks currently waiting to be revealed, for tests. */
  readonly pending: number;
}

const html = document.documentElement;

export async function mountReveals(root: Element, mode: RevealMode): Promise<RevealController> {
  const SplitText = mode === 'full' ? (await import('gsap/SplitText')).SplitText : null;
  if (SplitText) gsap.registerPlugin(SplitText);

  const splits: { revert(): void }[] = [];
  /** Line reveals are created in SplitText's onSplit callback, outside the context: track them. */
  const lineTweens = new Set<gsap.core.Tween>();
  const tweens = new Set<gsap.core.Tween>();
  let destroyed = false;

  html.classList.add('motion-ready');
  const full = mode === 'full';

  const ctx = gsap.context(() => {
    const threshold = window.innerHeight * 0.9;
    root.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
      if (el.getBoundingClientRect().top < threshold) return;
      const trigger = { trigger: el, start: 'top 88%', once: true };

      if (SplitText && el.dataset.reveal === 'lines') {
        // Lines rise from a mask, a light blur clearing. aria: 'auto' labels the
        // heading with its full text and hides the split pieces from AT.
        // autoSplit re-splits on resize and font load so lines re-wrap.
        const split = SplitText.create(el, {
          type: 'lines',
          mask: 'lines',
          aria: 'auto',
          autoSplit: true,
          onSplit: (self) => {
            const tween = gsap.from(self.lines, {
              yPercent: 105,
              opacity: 0,
              filter: 'blur(6px)',
              duration: 1.5,
              ease: 'expo.out',
              stagger: 0.1,
              scrollTrigger: trigger,
            });
            lineTweens.add(tween);
            // Returned so SplitText carries its progress over when it re-splits.
            return tween;
          },
        });
        splits.push(split);
        return;
      }

      tweens.add(
        gsap.from(el, {
          // Opacity only: visibility:hidden would drop links out of the tab order.
          opacity: 0,
          y: full ? 28 : 0,
          duration: full ? 1.3 : 0.8,
          ease: full ? 'expo.out' : 'power2.out',
          scrollTrigger: trigger,
        }),
      );
    });
  }, root);

  // Keyboard users can tab into content that hasn't been revealed yet: finish
  // its reveal at once so focus never lands on something invisible.
  const onFocusIn = (event: Event) => {
    const block = (event.target as Element).closest?.('[data-reveal]');
    if (!block) return;
    gsap.getTweensOf(block).forEach((tween) => tween.progress(1));
    block.querySelectorAll('*').forEach((child) => {
      gsap.getTweensOf(child).forEach((tween) => tween.progress(1));
    });
  };
  root.addEventListener('focusin', onFocusIn);

  const killAll = (complete: boolean) => {
    for (const tween of [...lineTweens, ...tweens]) {
      if (complete) tween.progress(1);
      tween.scrollTrigger?.kill();
      tween.kill();
    }
    lineTweens.clear();
    tweens.clear();
  };

  return {
    get pending() {
      return [...lineTweens, ...tweens].filter((t) => t.progress() < 1).length;
    },
    finish() {
      if (destroyed) return;
      killAll(true);
      splits.forEach((split) => split.revert());
      splits.length = 0;
      ctx.revert();
      html.classList.remove('motion-ready');
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.removeEventListener('focusin', onFocusIn);
      killAll(false);
      splits.forEach((split) => split.revert());
      splits.length = 0;
      ctx.revert();
      html.classList.remove('motion-ready');
    },
  };
}

/** Live ScrollTriggers, for the ?debug hooks (per page, after navigations). */
export const triggerCount = () => ScrollTrigger.getAll().length;
