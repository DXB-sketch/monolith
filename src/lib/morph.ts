/**
 * Shared-element morphs between pages (Phase 4, styles/transitions.css).
 *
 * The case study hero carries its names statically (`work-title-<slug>`,
 * `work-cover-<slug>`). Everything else is named only when it takes part, so
 * no other title is ever captured and flies across the screen:
 *
 * - leaving through a work row: that row's title, and its cover as it is
 *   currently shown (the floating preview, or the inline thumbnail);
 * - leaving through "Next project": that title;
 * - arriving back at the work index from a case study: that project's row.
 *
 * Reduced motion and the poster tier switch the names off in CSS.
 */
type PreparationEvent = Event & { sourceElement?: Element };
type SwapEvent = Event & { newDocument: Document };

const visible = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && el.getClientRects().length > 0;

function name(el: Element | null, value: string) {
  if (!(el instanceof HTMLElement)) return;
  el.classList.add('vt-morph');
  el.style.setProperty('--vt', value);
}

/** The case study being left, if any (its hero carries the slug). */
let leavingCase: string | null = null;

function onPreparation(event: Event) {
  const source = (event as PreparationEvent).sourceElement;
  leavingCase = document.querySelector<HTMLElement>('[data-case-slug]')?.dataset.caseSlug ?? null;
  const link = source?.closest<HTMLElement>('[data-morph-slug]');
  const slug = link?.dataset.morphSlug;
  if (!link || !slug) return;
  name(link.querySelector('[data-morph-title]'), `work-title-${slug}`);
  // The cover as the visitor sees it right now.
  const preview = document.querySelector(
    `[data-work-preview].is-visible [data-preview-slug="${slug}"].is-active`,
  );
  const thumb = link.querySelector('[data-morph-cover]');
  if (visible(preview)) name(preview, `work-cover-${slug}`);
  else if (visible(thumb)) name(thumb, `work-cover-${slug}`);
}

function onBeforeSwap(event: Event) {
  if (!leavingCase) return;
  // Back to the work index: the project's row takes the title (and cover, if shown).
  const row = (event as SwapEvent).newDocument.querySelector<HTMLElement>(
    `[data-morph-slug="${leavingCase}"]`,
  );
  if (!row) return;
  name(row.querySelector('[data-morph-title]'), `work-title-${leavingCase}`);
  // A thumbnail only shows on touch screens: CSS decides, so name it and let
  // an unrendered one simply not take part.
  name(row.querySelector('[data-morph-cover]'), `work-cover-${leavingCase}`);
}

let bound = false;

export function initMorphs() {
  if (bound) return;
  bound = true;
  document.addEventListener('astro:before-preparation', onPreparation);
  document.addEventListener('astro:before-swap', onBeforeSwap);
}
