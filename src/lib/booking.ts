/**
 * The Cal.com embed, loaded on demand. Nothing third-party is requested until
 * the visitor clicks "Book a call". If the script fails (blocked, offline) or
 * the calendar doesn't appear in time, the plain booking link takes over.
 */

const EMBED_SCRIPT = 'https://app.cal.com/embed/embed.js';
const LOAD_TIMEOUT_MS = 10_000;

type CalFn = ((...args: unknown[]) => void) & { loaded?: boolean; ns?: object; q?: unknown[][] };

/** A CSS colour token as #rrggbb (Cal.com's brand colour wants hex): derived, never hardcoded. */
function tokenHex(name: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
  probe.remove();
  return `#${[r, g, b].map((c) => c!.toString(16).padStart(2, '0')).join('')}`;
}

/** Cal.com's documented loader: queues calls until embed.js has arrived. */
function calQueue(): CalFn {
  const w = window as unknown as { Cal?: CalFn };
  if (w.Cal) return w.Cal;
  const cal: CalFn = (...args: unknown[]) => {
    cal.q!.push(args);
  };
  cal.q = [];
  cal.ns = {};
  w.Cal = cal;
  return cal;
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${EMBED_SCRIPT}"]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = EMBED_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('embed script failed'));
    document.head.appendChild(script);
  });
}

export function initBooking() {
  document.querySelectorAll<HTMLElement>('[data-book]').forEach((root) => {
    if (root.dataset.bookReady) return;
    root.dataset.bookReady = '1';
    const open = root.querySelector<HTMLButtonElement>('[data-book-open]')!;
    const embed = root.querySelector<HTMLElement>('[data-book-embed]')!;
    const status = root.querySelector<HTMLElement>('[data-book-status]')!;
    const link = root.querySelector<HTMLElement>('[data-book-link]')!;
    const url = root.dataset.bookUrl ?? '';
    open.hidden = false;

    open.addEventListener('click', async () => {
      if (!url) {
        status.textContent = 'Online booking isn’t set up yet. Use the form, or email me.';
        return;
      }
      open.disabled = true;
      status.textContent = 'Loading the calendar…';
      const target = new URL(url);
      const calLink = target.pathname.replace(/^\//, '');
      const id = `cal-embed-${Math.random().toString(36).slice(2, 8)}`;
      embed.id = id;
      embed.hidden = false;
      try {
        const Cal = calQueue();
        Cal('init', { origin: target.origin });
        Cal('inline', { elementOrSelector: `#${id}`, calLink, layout: 'month_view' });
        Cal('ui', {
          theme: 'dark',
          styles: { branding: { brandColor: tokenHex('--lava') } },
          layout: 'month_view',
        });
        await loadScript();
        // The calendar arrives as an iframe; give it a while, then fall back.
        const started = Date.now();
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            if (embed.querySelector('iframe')) return resolve();
            if (Date.now() - started > LOAD_TIMEOUT_MS) return reject(new Error('timeout'));
            setTimeout(check, 250);
          };
          check();
        });
        status.textContent = 'Pick a time below.';
        open.hidden = true;
      } catch {
        embed.hidden = true;
        open.disabled = false;
        status.textContent = 'The calendar couldn’t load here. Use the booking page link instead.';
        link.focus?.();
      }
    });
  });
}
