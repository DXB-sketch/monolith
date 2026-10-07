/**
 * Work (case studies) from the content collection, in reading order.
 * Used by the home story's face cards, the work index and the case studies.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

export type WorkEntry = CollectionEntry<'work'>;

/** What a card needs: the home's face cards and the work list. */
export interface Project {
  slug: string;
  title: string;
  client: string;
  clientType: string;
  year: string;
  summary: string;
  liveUrl?: string;
  isConcept: boolean;
}

export async function getWork(): Promise<WorkEntry[]> {
  const entries = await getCollection('work');
  return entries.sort((a, b) => a.data.order - b.data.order);
}

export function toProject(entry: WorkEntry): Project {
  const { title, client, clientType, year, summary, liveUrl, isConcept } = entry.data;
  return { slug: entry.id, title, client, clientType, year, summary, liveUrl, isConcept };
}

/** "www.seqdvgc.com.au" from the URL: a link label that says where it goes. */
export function hostOf(url: string): string {
  return new URL(url).host.replace(/^www\./, '');
}

/** The note every concept carries, on its card and its page. */
export const CONCEPT_NOTE =
  'An unofficial concept: not a client project, and not commissioned by its subject.';
