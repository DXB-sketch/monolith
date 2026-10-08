/**
 * Structured data (schema.org JSON-LD) for the pages that need it. Only facts
 * from docs/BRIEF.md and the content entries: no street address, no invented
 * ratings or reviews, and `sameAs` only for profile links that are real URLs.
 * Bracketed placeholders (the studio email) stay bracketed, and the
 * placeholder gate keeps them out of production.
 */
import { SITE } from './site';
import type { WorkEntry } from './work';

const absolute = (path: string, site: URL) => new URL(path, site).href.replace(/(.)\/$/, '$1');

/** The studio: a professional service in Wamuran, serving South East Queensland. */
export function studio(site: URL) {
  const sameAs = SITE.socials
    .map((social) => social.href)
    .filter((href) => /^https:\/\//.test(href));
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${absolute('/', site)}/#studio`,
    name: SITE.name,
    description: SITE.description,
    url: absolute('/', site),
    logo: absolute('/icon-512.png', site),
    image: absolute('/og/home.jpg', site),
    email: SITE.email,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Wamuran',
      addressRegion: 'QLD',
      addressCountry: 'AU',
    },
    areaServed: [
      { '@type': 'AdministrativeArea', name: 'South East Queensland' },
      { '@type': 'City', name: 'Moreton Bay' },
      { '@type': 'City', name: 'Sunshine Coast' },
      { '@type': 'City', name: 'Brisbane' },
    ],
    ...(sameAs.length ? { sameAs } : {}),
  };
}

interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbs(crumbs: Crumb[], site: URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.path, site),
    })),
  };
}

/** A case study (or a clearly labelled concept) as a creative work by the studio. */
export function caseStudy(entry: WorkEntry, imagePath: string, site: URL) {
  const { title, summary, year, isConcept } = entry.data;
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: title,
    headline: isConcept ? `${title} (concept)` : title,
    description: summary,
    url: absolute(`/work/${entry.id}`, site),
    image: absolute(imagePath, site),
    // Only a real year: a bracketed placeholder is left out rather than published.
    ...(year && /^\d{4}$/.test(year) ? { dateCreated: year } : {}),
    creator: {
      '@type': 'ProfessionalService',
      '@id': `${absolute('/', site)}/#studio`,
      name: SITE.name,
    },
    ...(isConcept ? { genre: 'Concept' } : {}),
    inLanguage: 'en-AU',
  };
}
