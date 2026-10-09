/**
 * Content collections: case studies (work) and experiments (lab).
 *
 * Only facts from docs/BRIEF.md go in these entries. Everything else stays a
 * bracketed placeholder ([TO BE SUPPLIED] and friends) until the owner supplies
 * it; the build lists every entry that still has one (see
 * src/integrations/placeholder-report.ts).
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** A four-digit year, or a bracketed placeholder until it's supplied. */
const year = z.union([z.string().regex(/^\d{4}$/), z.string().regex(/^\[[^\]]+\]$/)]);

const work = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/work' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      client: z.string(),
      /** e.g. "Sporting club", "Musician". */
      clientType: z.string(),
      /** Left out of the page until supplied. */
      year: year.optional(),
      /** The live site; omitted for concepts. Opens in the same tab. */
      liveUrl: z.url().optional(),
      /** One line. */
      summary: z.string(),
      /** Position in the work list (and the next-project loop). */
      order: z.number().int(),
      /** Concepts are labelled as such on every card and on their page. */
      isConcept: z.boolean(),
      /** Drafts are left out of every build except `astro dev` (and so out of the placeholder gate). */
      draft: z.boolean().default(false),
      cover: image(),
      coverAlt: z.string(),
      gallery: z
        .array(
          z.discriminatedUnion('type', [
            z.object({
              type: z.literal('image'),
              src: image(),
              alt: z.string().min(1),
              /** Wide images span the full width; narrow ones (phone screens) sit in pairs. */
              wide: z.boolean().default(true),
            }),
            z.object({
              type: z.literal('video'),
              /** A file in public/, e.g. /media/project-recording.mp4 */
              src: z.string().startsWith('/'),
              poster: image(),
              /** What the recording shows, in words: shown with the video. */
              description: z.string().min(1),
            }),
          ]),
        )
        .optional(),
      /** The section is omitted when absent. */
      challenge: z.string().optional(),
      decisions: z
        .array(
          z.object({
            area: z.enum(['design', 'technical', 'accessibility']),
            text: z.string(),
          }),
        )
        .min(1),
      /** Only real results. The section is omitted when absent. */
      results: z
        .object({
          lighthouse: z
            .object({
              performance: z.number().int().min(0).max(100),
              accessibility: z.number().int().min(0).max(100),
              bestPractices: z.number().int().min(0).max(100),
              seo: z.number().int().min(0).max(100),
            })
            .optional(),
          notes: z.array(z.string()).optional(),
        })
        .optional(),
      /** Only a real quote. The section is omitted when absent. */
      quote: z.object({ text: z.string(), name: z.string(), role: z.string() }).optional(),
      seo: z
        .object({ title: z.string().optional(), description: z.string().optional() })
        .optional(),
    }),
});

const lab = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/lab' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      summary: z.string(),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      /** Key of an interactive demo (src/lab/demos.ts), loaded only on its page. */
      demo: z.string().optional(),
      tags: z.array(z.string()).default([]),
      /** Drafts are left out of every build except `astro dev`. */
      draft: z.boolean().default(false),
    }),
});

export const collections = { work, lab };
