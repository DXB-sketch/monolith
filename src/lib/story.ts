/**
 * The home page scroll story. Lazily loaded by scene-boot.ts, home page only.
 *
 * - Maps scroll through the story container to progress 0..1 and measures where
 *   each chapter actually sits (on every ScrollTrigger refresh, never per frame).
 * - Tracks the active chapter for the HUD (aria-current), and drives the
 *   decorative core temperature readout.
 * - Handles chapter links: smooth scroll to the chapter, then focus its heading.
 * - Reveals content as it enters (src/lib/reveal.ts, shared with the content pages).
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
import { mountReveals, type RevealController } from './reveal';
import { prefersReducedMotion } from '../scene/quality';

export { triggerCount } from './reveal';
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

  /**
   * The HUD's core temperature ticks toward a new reading in 5 °C steps rather
   * than jumping (a chapter link, lite and static modes). Reduced motion: at once.
   */
  let targetTemp = 0;
  let tickTimer = 0;
  const renderTemp = (value: number) => {
    shownTemp = value;
    if (tempEl) tempEl.textContent = `${temperature.format(value)}°C`;
  };
  const tick = () => {
    tickTimer = 0;
    if (shownTemp === targetTemp) return;
    renderTemp(shownTemp + Math.sign(targetTemp - shownTemp) * 5);
    if (shownTemp !== targetTemp) tickTimer = window.setTimeout(tick, 32);
  };
  const setTemp = (value: number) => {
    const rounded = Math.round(value / 5) * 5;
    if (!tempEl || rounded === targetTemp) return;
    targetTemp = rounded;
    if (!shownTemp || prefersReducedMotion()) {
      clearTimeout(tickTimer);
      tickTimer = 0;
      renderTemp(rounded);
    } else if (!tickTimer) {
      tick();
    }
  };

  /** Quiet cues for the optional ambient sound (lib/sound.ts); nothing else listens. */
  const cue = (name: 'chapter' | 'dive', index?: number) =>
    document.dispatchEvent(new CustomEvent(`monolith:${name}`, { detail: { index } }));
  let diving = false;
  let cuesReady = false;

  const currentProgress = () =>
    Math.min(1, Math.max(0, (window.scrollY - storyStart) / storyRange));

  /** Full mode: temperature and HUD follow the exact story position. */
  const followProgress = (p: number) => {
    blendChapterState(storyPosition(p, map, position), chapterState);
    setTemp(chapterState.coreTemp);
    setWashed(position.dive);
    const nowDiving = position.dive > 0.02;
    if (nowDiving && !diving && cuesReady) cue('dive');
    diving = nowDiving;
  };

  const setActive = (index: number) => {
    if (index !== activeIndex && cuesReady) cue('chapter', index);
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

  // ── Reveals (src/lib/reveal.ts): set up once, when the tier has settled ──
  let reveals: RevealController | null = null;
  let revealsSetUp = false;

  const setupReveals = async (revealMode: StoryMode) => {
    if (revealsSetUp || revealMode === 'pending' || revealMode === 'static') return;
    revealsSetUp = true;
    const created = await mountReveals(root, revealMode === 'full' ? 'full' : 'lite');
    if (disposed || mode === 'static') {
      created.destroy();
      return;
    }
    reveals = created;
    refresh();
  };

  /** Static mode: everything visible now, no animation left behind. */
  const finishReveals = () => reveals?.finish();

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
      pendingReveals: () => reveals?.pending ?? 0,
    };
  }

  // Sound cues only for real movement, not the story finding its feet on mount.
  const cueTimer = window.setTimeout(() => (cuesReady = true), 1000);

  return {
    get mode() {
      return mode;
    },
    setMode,
    requestRefresh,
    unmount() {
      disposed = true;
      clearTimeout(refreshTimer);
      clearTimeout(tickTimer);
      clearTimeout(cueTimer);
      document.removeEventListener('click', onClick, true);
      hud?.removeAttribute('data-washed');
      // Only the story's own triggers: its context, and its reveals'.
      reveals?.destroy();
      reveals = null;
      ctx.revert();
      smoothToken++;
      smooth?.destroy();
      smooth = null;
      html.classList.remove('motion-ready');
    },
  };
}
