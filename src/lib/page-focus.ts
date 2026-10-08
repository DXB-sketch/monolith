/**
 * After every ClientRouter navigation (never the first load), move keyboard
 * focus to the new page's main heading, so keyboard and screen reader users
 * start at the top of the new content rather than on a link that no longer
 * exists. ClientRouter's own route announcer reads out the new title.
 *
 * `preventScroll` keeps the restored (back/forward) or hash scroll position.
 */
let first = true;

function focusHeading() {
  if (first) {
    first = false;
    return;
  }
  // A link to a section of the page (#face-ii) focuses that section's heading itself.
  if (location.hash) return;
  const heading = document.querySelector<HTMLElement>('main h1');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

export function initPageFocus() {
  document.addEventListener('astro:page-load', focusHeading);
}
