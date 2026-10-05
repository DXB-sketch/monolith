/**
 * The home page scroll story. Lazily loaded by scene-boot.ts, home page only.
 *
 * - Maps scroll through the story container to progress 0..1 and measures where
 *   each chapter actually sits (on every ScrollTrigger refresh, never per frame).
 * - Tracks the active chapter for the HUD (aria-current), and drives the
 *   decorative core temperature readout.
 * - Handles chapter links: smooth scroll to the chapter, then focus its heading.
 * - Reveals content as it enters, without ever hiding what is already in view.
 *
 * The story mounts as soon as its chunk is ready and switches mode in place as
 * the tier settles or changes, without duplicating triggers, Lenis instances or
 * SplitText splits, and without moving the scroll position:
 *   pending  tier still being decided: native scroll, HUD only, no reveals yet
 *   full     scene tiers: Lenis, camera and scene state, line reveals
 *   lite     Low tier: native scroll, simple fades
 *   static   reduced motion or tier Off: native scroll, no animation
 */
import { blendChapterState, CHAPTER_STATES, createChapterState } from '../scene/chapters';
import { DEFAULT_STORY_MAP, storyPosition, type StoryMap } from '../scene/story-map';
import {
  createSmoothScroll,
  gsap,
  nativeScrollTo,
  ScrollTrigger,
  type SmoothScroll,
} from './scroll';

export type StoryMode = 'pending' | 'full' | 'lite' | 'static';

export interface StoryBridge {
  setProgress(p: number, immediate?: boolean): void;
  setStoryMap(map: StoryMap): void;
}

export interface StoryController {
  readonly mode: StoryMode;
  /** Switch mode in place (tier resolved or changed, reduced motion switched on). */
  setMode(mode: StoryMode): void;
  /** Re-measure the chapters soon (debounced): after the first frame, after fonts load. */
  requestRefresh(): void;
  unmount(): void;
}

interface Options {
  mode: StoryMode;
  scene: StoryBridge;
}

const CHAPTER_IDS = ['arrival', 'face-i', 'face-ii', 'the-lab', 'the-core'] as const;
const html = document.documentElement;
const temperature = new Intl.NumberFormat('en-AU');
const REFRESH_DEBOUNCE_MS = 150;

export async function mountStory(
  root: HTMLElement,
  { mode: initialMode, scene }: Options,
): Promise<StoryController> {
  let mode = initialMode;
  let disposed = false;

  // A refresh records each scroller's *cached* position and puts it back after
  // measuring. After a ClientRouter swap that cache is stale (the top of the
  // page), so clear it first, and keep the page exactly where it really is.
  const refresh = () => {
    const y = window.scrollY;
    ScrollTrigger.clearScrollMemory();
    ScrollTrigger.refresh();
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y, behavior: 'instant' });
    ScrollTrigger.update();
  };
  let refreshTimer = 0;
  const requestRefresh = () => {
    if (disposed) return;
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      if (!disposed) {
        refresh();
        smooth?.lenis.resize();
      }
    }, REFRESH_DEBOUNCE_MS);
  };

  // ── Smooth scroll: present only in full mode ───────────────────────────
  let smooth: SmoothScroll | null = null;
  let smoothToken = 0;
  const applySmooth = async () => {
    if (mode === 'full' && !smooth) {
      const token = ++smoothToken;
      const created = await createSmoothScroll();
      // The mode changed (or the story unmounted) while Lenis was loading.
      if (token !== smoothToken || disposed || mode !== 'full') {
        created.destroy();
        return;
      }
      smooth = created;
    } else if (mode !== 'full' && smooth) {
      smoothToken++;
      smooth.destroy();
      smooth = null;
    } else if (mode !== 'full') {
      smoothToken++; // cancel any Lenis still loading
    }
  };
  const scrollTo = (y: number, done?: () => void) =>
    smooth ? smooth.scrollTo(y, done) : nativeScrollTo(y, done);

  const sections = CHAPTER_IDS.map((id) => document.getElementById(id));
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-chapter-link]'));
  const tempEl = document.querySelector<HTMLElement>('[data-core-temp]');
  const hud = document.querySelector<HTMLElement>('[data-hud]');
  let washed = false;
  /** The HUD's small labels can't sit over the bright wash: step aside while it burns. */
  const setWashed = (dive: number) => {
    const next = mode === 'full' && dive > 0.12 && dive < 0.74;
    if (next === washed) return;
    washed = next;
    hud?.toggleAttribute('data-washed', next);
  };

  let map: StoryMap = DEFAULT_STORY_MAP;
  let storyStart = 0;
  let storyRange = 1;
  let shownTemp = 0;
  let activeIndex = 0;
  const position = { chapter: 0, dive: 0 };
  const chapterState = createChapterState();

  const setTemp = (value: number) => {
    const rounded = Math.round(value / 5) * 5;
    if (!tempEl || rounded === shownTemp) return;
    shownTemp = rounded;
    tempEl.textContent = `${temperature.format(rounded)}°C`;
  };

  const currentProgress = () =>
    Math.min(1, Math.max(0, (window.scrollY - storyStart) / storyRange));

  /** Full mode: temperature and HUD follow the exact story position. */
  const followProgress = (p: number) => {
    blendChapterState(storyPosition(p, map, position), chapterState);
    setTemp(chapterState.coreTemp);
    setWashed(position.dive);
  };

  const setActive = (index: number) => {
    activeIndex = index;
    links.forEach((link, i) => {
      const active = i === index;
      link.toggleAttribute('data-active', active);
      if (active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    if (mode !== 'full') setTemp(CHAPTER_STATES[index]!.coreTemp);
  };

  /** Read the real layout: where each chapter's content is aligned in the viewport. */
  const measure = (start: number, end: number) => {
    storyStart = start;
    storyRange = Math.max(1, end - start);
    const vh = window.innerHeight;
    const portrait = window.innerWidth < vh;
    const toP = (y: number) => Math.min(1, Math.max(0, (y - start) / storyRange));
    const top = (el: Element) => el.getBoundingClientRect().top + window.scrollY;

    const chapters = [0, 0, 0, 0, 0] as StoryMap['chapters'];
    for (let i = 1; i <= 4; i++) {
      const el = root.querySelector(`[data-story-anchor="${i}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      // Landscape: content centred. Portrait: content starts at mid-screen, so
      // the stone (framed high) stays visible above it.
      // Blocks taller than the viewport align their top instead, so the heading is in view.
      const y = portrait
        ? top(el) - vh * 0.5
        : rect.height > vh * 0.8
          ? top(el) - vh * 0.2
          : top(el) + rect.height / 2 - vh / 2;
      chapters[i] = Math.max(chapters[i - 1]! + 0.01, toP(y));
    }

    const services = root.querySelector('[data-story-anchor="4"]');
    const cta = root.querySelector('[data-story-cta]');
    const diveStart = services
      ? toP(top(services) + services.getBoundingClientRect().height - vh * 0.2)
      : 0.8;
    // The CTA starts entering at the bottom of the viewport only once the wash is magma.
    const magma = cta ? toP(top(cta) - vh) : 0.92;
    const dive = Math.max(chapters[4] + 0.005, diveStart);
    const safeMagma = Math.max(dive + 0.02, magma);
    map = {
      chapters,
      dive: { start: dive, peak: dive + (safeMagma - dive) * 0.6, magma: safeMagma, end: 1 },
    };
    scene.setStoryMap(map);
  };

  /** Scroll position at which chapter i is framed (its anchor). */
  const chapterScrollY = (i: number) => storyStart + map.chapters[i as 0]! * storyRange;

  const focusHeading = (index: number) => {
    const heading = sections[index]?.querySelector<HTMLElement>('[data-chapter-heading]');
    heading?.focus({ preventScroll: true });
  };

  const goTo = (index: number) => {
    const id = CHAPTER_IDS[index]!;
    history.replaceState(history.state, '', `#${id}`);
    if (mode === 'static') {
      sections[index]?.scrollIntoView({ block: 'start' });
      focusHeading(index);
      return;
    }
    scrollTo(chapterScrollY(index), () => focusHeading(index));
  };

  // In-page chapter links (HUD, "Skip to the work"). Captured before ClientRouter,
  // which would otherwise handle same-page hash links itself and skip the focus move.
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey) return;
    const index = CHAPTER_IDS.indexOf(link.hash.slice(1) as (typeof CHAPTER_IDS)[number]);
    if (index < 0) return;
    event.preventDefault();
    goTo(index);
  };
  document.addEventListener('click', onClick, true);

  // Keyboard users can tab into content that hasn't been revealed yet: finish
  // its reveal at once so focus never lands on something invisible.
  const onFocusIn = (event: FocusEvent) => {
    const block = (event.target as Element).closest?.('[data-reveal]');
    if (!block) return;
    gsap.getTweensOf(block).forEach((tween) => tween.progress(1));
  };
  root.addEventListener('focusin', onFocusIn);

  const ctx = gsap.context(() => {
    // Progress through the whole story drives the camera and scene state.
    const progress = ScrollTrigger.create({
      trigger: root,
      start: 'top top',
      end: 'bottom bottom',
      onRefresh: (self) => measure(self.start, self.end),
      onUpdate: (self) => {
        if (mode === 'static') return;
        // Always kept current: a scene that arrives later starts from here.
        scene.setProgress(self.progress);
        if (mode === 'full') followProgress(self.progress);
      },
    });

    // The HUD follows the chapter that holds the middle of the viewport.
    sections.forEach((section, index) => {
      if (!section) return;
      ScrollTrigger.create({
        trigger: section,
        start: 'top center',
        end: 'bottom center',
        onToggle: (self) => self.isActive && setActive(index),
      });
    });

    measure(progress.start, progress.end);
  }, root);

  // Deep link to a chapter: land on its framing, not on the top of its section.
  // (The tall story layout exists whenever motion is allowed, whatever the tier.)
  const hashIndex = CHAPTER_IDS.indexOf(location.hash.slice(1) as (typeof CHAPTER_IDS)[number]);
  if (hashIndex > 0 && mode !== 'static') {
    const sectionTop = sections[hashIndex]!.getBoundingClientRect().top;
    if (Math.abs(sectionTop) < 4) {
      window.scrollTo({ top: chapterScrollY(hashIndex), behavior: 'instant' });
    }
  }

  // Jump the camera to wherever the page already is (deep link, back navigation).
  refresh();
  scene.setProgress(mode === 'static' ? 0 : currentProgress(), true);
  if (mode === 'full') followProgress(currentProgress());

  // Chapter anchors measured before the fonts arrive can be off: measure again.
  document.fonts?.ready.then(requestRefresh);

  // ── Reveals: set up once, when the tier has settled ────────────────────
  // Hidden states exist only once JS has marked the page motion-ready, and only
  // for content that is still below the viewport at that moment.
  const splits: { revert(): void }[] = [];
  /** Line reveals are created in SplitText's onSplit callback, outside the context: track them. */
  const lineTweens = new Set<gsap.core.Tween>();
  const revealTweens = new Set<gsap.core.Tween>();
  let revealsSetUp = false;

  const setupReveals = async (revealMode: StoryMode) => {
    if (revealsSetUp || revealMode === 'pending' || revealMode === 'static') return;
    revealsSetUp = true;
    const SplitText = revealMode === 'full' ? (await import('gsap/SplitText')).SplitText : null;
    if (disposed || mode === 'static') return;
    if (SplitText) gsap.registerPlugin(SplitText);
    html.classList.add('motion-ready');
    const full = revealMode === 'full';

    ctx.add(() => {
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

        revealTweens.add(
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
    });
    refresh();
  };

  /** Static mode: everything visible now, no animation left behind. */
  const finishReveals = () => {
    for (const tween of [...lineTweens, ...revealTweens]) {
      tween.progress(1);
      tween.scrollTrigger?.kill();
      tween.kill();
    }
    lineTweens.clear();
    revealTweens.clear();
    splits.forEach((split) => split.revert());
    splits.length = 0;
    html.classList.remove('motion-ready');
  };

  const setMode = (next: StoryMode) => {
    if (disposed || next === mode) return;
    mode = next;
    void applySmooth();
    if (next === 'full') {
      // Drive the scene from wherever the visitor has already scrolled.
      const p = currentProgress();
      scene.setProgress(p, true);
      followProgress(p);
    } else {
      setWashed(0);
      setTemp(CHAPTER_STATES[activeIndex]!.coreTemp);
    }
    if (next === 'static') finishReveals();
    else void setupReveals(next);
  };

  void applySmooth();
  void setupReveals(mode);

  // Dev hook for checking that mode switches and navigation never leave orphan
  // triggers or duplicate Lenis instances: ?debug
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { __story?: object }).__story = {
      triggers: () => ScrollTrigger.getAll().length,
      mode: () => mode,
      lenis: () => (smooth ? 1 : 0),
      lenisRoots: () => document.querySelectorAll('html.lenis').length,
      splits: () => splits.length,
    };
  }

  return {
    get mode() {
      return mode;
    },
    setMode,
    requestRefresh,
    unmount() {
      disposed = true;
      clearTimeout(refreshTimer);
      document.removeEventListener('click', onClick, true);
      root.removeEventListener('focusin', onFocusIn);
      hud?.removeAttribute('data-washed');
      lineTweens.forEach((tween) => {
        tween.scrollTrigger?.kill();
        tween.kill();
      });
      splits.forEach((split) => split.revert());
      ctx.revert();
      // The story is the only ScrollTrigger user on the site: leave none behind.
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      smoothToken++;
      smooth?.destroy();
      smooth = null;
      html.classList.remove('motion-ready');
    },
  };
}
