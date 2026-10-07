/**
 * Lists every content entry (and every page, component or data file) that
 * still contains a bracketed placeholder from docs/BRIEF.md ("[STUDIO EMAIL]",
 * "[$ PRICE]", "[TO BE SUPPLIED]"…), so the owner can see what's missing.
 * These are the build's only expected warnings.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/**
 * At least two capital letters inside the brackets and no lowercase, so code
 * like `list[0]` and Markdown links never match.
 */
export const PLACEHOLDER = /\[(?=[^\]\n]*[A-Z]{2})[A-Z0-9$][^\]\na-z]*\]/g;

/** Every file under `dir` with one of the extensions. */
function walk(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

export function placeholderReport(): AstroIntegration {
  return {
    name: 'monolith-placeholder-report',
    hooks: {
      'astro:build:done': ({ logger }) => {
        const root = fileURLToPath(new URL('../../', import.meta.url));
        const src = join(root, 'src');
        const groups: [string, string[]][] = [
          ['Content entries', walk(join(src, 'content'), ['.md', '.mdx'])],
          [
            'Pages, components and site data',
            [
              ...walk(join(src, 'pages'), ['.astro', '.ts']),
              ...walk(join(src, 'components'), ['.astro']),
              ...walk(join(src, 'lib'), ['.ts']),
            ],
          ],
        ];
        let total = 0;
        const lines: string[] = [];
        for (const [title, files] of groups) {
          const found = files
            .map((file) => {
              const matches = readFileSync(file, 'utf8').match(PLACEHOLDER) ?? [];
              return { file: relative(root, file), matches: [...new Set(matches)] };
            })
            .filter(({ matches }) => matches.length);
          if (!found.length) continue;
          lines.push(`${title}:`);
          for (const { file, matches } of found) {
            total += matches.length;
            lines.push(`  ${file}: ${matches.join(', ')}`);
          }
        }
        if (total) logger.warn(`${total} placeholders still to supply:\n${lines.join('\n')}`);
        else logger.info('No placeholders left.');
      },
    },
  };
}
