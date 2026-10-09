/**
 * The placeholder gate (Phase 5; Phase 3's report, made strict).
 *
 * After every build it lists what's still missing, grouped by page:
 *
 * - every built page (the HTML as shipped, so titles, descriptions, alt text,
 *   Open Graph tags and structured data are all checked, and draft entries,
 *   which are not built, are not);
 * - the on-demand pages, which have no HTML at build time (/contact, its
 *   success state), from their source;
 * - the site URL itself, while it is still the placeholder origin.
 *
 * Production builds (Cloudflare Workers Builds of the `main` branch, or
 * STRICT_CONTENT=1 anywhere) fail while anything is listed. Preview and local builds only warn.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/**
 * At least two capital letters inside the brackets and no lowercase, so code
 * like `list[0]` and Markdown links never match. Constant keys in code
 * (`body[HONEYPOT]`, `{ [TOKEN]: value }`) are skipped too. Price stand-ins
 * like `[$X]` count.
 */
export const PLACEHOLDER =
  /(?<![\w\])])\[(?:(?=[^\]\n]*[A-Z]{2})[A-Z0-9$][^\]\na-z]*|\$[A-Z])\](?!\s*:)/g;

/** The origin used until PUBLIC_SITE_URL is set (astro.config.mjs). */
const SITE_PLACEHOLDER = 'https://monolith.example';

/** Source of the pages rendered on demand (no HTML exists for them at build time). */
const ON_DEMAND_SOURCES: [string, string[]][] = [
  [
    '/contact',
    [
      'src/pages/contact.astro',
      'src/components/ContactForm.astro',
      'src/components/ContactSuccess.astro',
      'src/components/BookCall.astro',
      'src/lib/contact-fields.ts',
    ],
  ],
];

/** Cloudflare's build environment names the branch it is building. */
const PRODUCTION_BRANCH = process.env.PRODUCTION_BRANCH || 'main';
export const strictContent = () =>
  process.env.STRICT_CONTENT === '1' ||
  (process.env.WORKERS_CI_BRANCH ?? process.env.CF_PAGES_BRANCH) === PRODUCTION_BRANCH;

/** Every file under `dir` with one of the extensions. */
function walk(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

/** "/work/seqdvgc" from ".../static/work/seqdvgc/index.html". */
function routeOf(staticDir: string, file: string) {
  const path = relative(staticDir, file).split(sep).join('/');
  return `/${path.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '')}`;
}

/** Decode the few entities that can appear inside a placeholder in HTML. */
const decode = (html: string) =>
  html
    .replace(/&#36;|&dollar;/g, '$')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

export function placeholderReport(): AstroIntegration {
  let site = SITE_PLACEHOLDER;
  return {
    name: 'monolith-placeholder-report',
    hooks: {
      'astro:config:done': ({ config }) => {
        site = config.site?.replace(/\/$/, '') ?? SITE_PLACEHOLDER;
      },
      'astro:build:done': ({ dir, logger }) => {
        const root = fileURLToPath(new URL('../../', import.meta.url));
        const staticDir = fileURLToPath(dir);
        const byPage = new Map<string, Set<string>>();
        const add = (page: string, found: Iterable<string>) => {
          const set = byPage.get(page) ?? new Set<string>();
          for (const item of found) set.add(item);
          if (set.size) byPage.set(page, set);
        };

        for (const file of walk(staticDir, ['.html'])) {
          add(
            routeOf(staticDir, file),
            decode(readFileSync(file, 'utf8')).match(PLACEHOLDER) ?? [],
          );
        }
        for (const [page, sources] of ON_DEMAND_SOURCES) {
          for (const source of sources) {
            add(
              `${page} (on demand)`,
              readFileSync(join(root, source), 'utf8').match(PLACEHOLDER) ?? [],
            );
          }
        }
        if (site === SITE_PLACEHOLDER) add('Site URL', ['[DOMAIN] (set PUBLIC_SITE_URL)']);

        const pages = [...byPage.keys()].sort();
        const distinct = new Set(pages.flatMap((page) => [...byPage.get(page)!]));
        if (!pages.length) {
          logger.info('Placeholder gate: nothing left to supply.');
          return;
        }
        const lines = pages.map((page) => `  ${page}: ${[...byPage.get(page)!].join(', ')}`);
        const summary = `${distinct.size} placeholders still to supply, on ${pages.length} pages:\n${lines.join('\n')}`;
        if (strictContent()) {
          throw new Error(
            `Placeholder gate: this is a production build (the production branch on Cloudflare, or STRICT_CONTENT=1) and ${summary}\n` +
              'Fill these in (see LAUNCH.md, step 1), or set a content entry to `draft: true` to leave it out.',
          );
        }
        logger.warn(
          `${summary}\n  (Preview build: warning only. Production builds fail until these are filled.)`,
        );
      },
    },
  };
}
