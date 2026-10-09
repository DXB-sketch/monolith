/**
 * Custom analytics events: a handful that would tell the owner what real
 * visitors get and do.
 *
 *   scene_tier      the tier the visit settled on, and why when it's the poster
 *   story_progress  the furthest story chapter reached on /potential (once, when leaving the story)
 *   cta_click       which "Start a project" / "Arrange a call" button, on which page
 *   contact_step    a brief step reached for the first time
 *   contact_submit  a brief sent successfully
 *   sound_on        the ambient sound switched on
 *   intro_skipped   the first-visit intro opened early by an input
 *
 * Nothing is sent anywhere yet: Cloudflare Web Analytics (page views and Core
 * Web Vitals, cookieless, enabled in the Cloudflare dashboard) has no custom
 * events. Each event is dispatched on `document` as a `monolith:analytics`
 * CustomEvent ({ name, data }), so a provider can be added here in one place,
 * and tests can check them.
 *
 * Never personal data: no form values, no free text, no GPU strings, no query
 * strings. Nothing here waits on anything.
 */
type Value = string | number | boolean;

export interface AnalyticsEvent {
  name: string;
  data?: Record<string, Value>;
}

export function track(name: string, data?: Record<string, Value>) {
  try {
    document.dispatchEvent(
      new CustomEvent<AnalyticsEvent>('monolith:analytics', { detail: { name, data } }),
    );
  } catch {
    // Analytics must never break the page.
  }
}

/** The page, without query or hash (and without the trailing slash). */
export const pagePath = () => location.pathname.replace(/(.)\/$/, '$1');

/**
 * Why the poster is showing, as a short category: the raw reasons hold GPU
 * renderer strings and timings, which are more detail than the owner needs
 * and edge towards fingerprinting.
 */
export function posterReason(reason: string): string {
  const r = reason.replace(/^remembered this session: /, '');
  // Phase 6: 2D is the default, and the gate's check never counts as a visit's tier.
  if (/experience-2d/.test(r)) return 'experience-2d';
  if (/awaiting the gate|gate check/.test(r)) return 'gate';
  if (/reduced-motion/.test(r)) return 'reduced-motion';
  if (/save-data/.test(r)) return 'save-data';
  if (/forced/.test(r)) return 'forced';
  if (/no WebGL2/i.test(r)) return 'no-webgl2';
  if (/software renderer/.test(r)) return 'software-renderer';
  if (/detection failed|timed out/.test(r)) return 'detection-failed';
  if (/no frame rendered/.test(r)) return 'no-first-frame';
  if (/context lost/i.test(r)) return 'context-lost';
  if (/scene unavailable|failed to load|error/i.test(r)) return 'scene-error';
  if (/→ poster/.test(r)) return 'weak-gpu';
  return 'other';
}

/**
 * "Start a project" (the buttons, not plain "Contact" links) and "Arrange a
 * call", wherever they are: one delegated listener, so no button needs
 * wiring. `placement` says which one: the nav, the footer, or the section it
 * sits in (its id, else its class: `arrival`, `next-step`).
 */
export function initCtaTracking() {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      const el = target?.closest?.('a[href]');
      if (!el) return;
      let button: string | null = null;
      if (el.matches('[data-book-link]')) button = 'arrange_call';
      else if (
        el instanceof HTMLAnchorElement &&
        el.classList.contains('btn') &&
        el.origin === location.origin &&
        el.pathname.replace(/\/$/, '') === '/contact'
      ) {
        button = 'start_project';
      }
      if (!button) return;
      const section = el.closest('section');
      const placement = el.closest('nav, header')
        ? 'nav'
        : el.closest('footer')
          ? 'footer'
          : section?.id || section?.classList[0] || 'page';
      track('cta_click', { button, placement, page: pagePath() });
    },
    { capture: true, passive: true },
  );
}

/**
 * The intro (an inline script, components/Intro.astro) marks an early open by
 * an input on the root element; it may happen before this module runs.
 */
export function initIntroTracking() {
  const root = document.documentElement;
  const consume = () => {
    if (!('introSkipped' in root.dataset)) return;
    delete root.dataset.introSkipped;
    track('intro_skipped');
  };
  consume();
  document.addEventListener('monolith:intro-skipped', consume);
}

/** Run `send` once, the first time the page is hidden or left (bfcache-safe). */
export function onLeave(send: () => void) {
  let sent = false;
  const fire = () => {
    if (sent) return;
    sent = true;
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', fire);
    send();
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') fire();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', fire);
  return fire;
}
