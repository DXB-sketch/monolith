/**
 * Site-wide data. Bracketed values are placeholders from docs/BRIEF.md and must
 * stay bracketed until real content is supplied. Never invent replacements.
 */

export const SITE = {
  name: 'Monolith Web Studio',
  shortName: 'Monolith',
  description:
    'Monolith is a one-person web design and development studio in Wamuran, Queensland, making fast, accessible, award-level websites for businesses across South East Queensland.',
  locale: 'en-AU',
  location: 'Wamuran, Queensland',
  coordinates: '26.90°S · 152.82°E',
  email: '[STUDIO EMAIL]',
  abn: '[ABN]',
  bookingUrl: '[CAL.COM BOOKING URL]',
  founder: '[FOUNDER NAME]',
  socials: [{ label: '[SOCIAL LINKS]' }],
} as const;

export interface NavItem {
  href: string;
  label: string;
}

export const NAV: NavItem[] = [
  { href: '/work', label: 'Work' },
  { href: '/lab', label: 'Lab' },
  { href: '/services', label: 'Services' },
  { href: '/about', label: 'About' },
];

export const CTA: NavItem = { href: '/contact', label: 'Start a project' };

export interface Chapter {
  index: string;
  id: string;
  label: string;
}

/** The home scroll story. Ids are the anchors of the home page sections. */
export const CHAPTERS: Chapter[] = [
  { index: '00', id: 'arrival', label: 'Arrival' },
  { index: '01', id: 'face-i', label: 'Face I' },
  { index: '02', id: 'face-ii', label: 'Face II' },
  { index: '03', id: 'the-lab', label: 'The Lab' },
  { index: '04', id: 'the-core', label: 'The Core' },
];

export interface Project {
  slug: string;
  title: string;
  client: string;
  clientType: string;
  summary: string;
  liveUrl?: string;
  concept?: boolean;
}

/** Real projects from BRIEF.md. Case study detail arrives with content collections in Phase 3. */
export const PROJECTS: Project[] = [
  {
    slug: 'seqdvgc',
    title: 'SEQDVGC',
    client: 'South East Queensland Defence Veterans Golf Club',
    clientType: 'Sporting club',
    summary:
      'A home for the club, connecting veterans and their families across Brisbane, the Sunshine Coast and the Gold Coast.',
    liveUrl: 'https://www.seqdvgc.com.au/',
  },
  {
    slug: 'allen-gillon',
    title: 'Allen Gillon',
    client: 'Allen Gillon, guitarist, Bribie Island',
    clientType: 'Musician',
    summary:
      'A quiet, accessible site for a local musician, including a “listen to this page” audio feature and skip-link accessibility.',
    liveUrl: 'https://allengillon.com/',
  },
  {
    slug: 'concept',
    title: '[CONCEPT PROJECT]',
    client: '[SUBJECT TO BE CHOSEN]',
    clientType: 'Unofficial concept',
    summary:
      'An unofficial redesign concept. Not a client project, and not commissioned by the subject.',
    concept: true,
  },
];

export interface Service {
  name: string;
  package: string;
  description: string;
  price: string;
}

export const SERVICES: Service[] = [
  {
    name: 'Ember',
    package: 'Launch site',
    description: 'Fast, sharp, accessible site for a new or small business. Ready in weeks.',
    price: 'from [$ PRICE]',
  },
  {
    name: 'Flow',
    package: 'Custom build',
    description: 'Bespoke design, motion and an easy-to-use CMS.',
    price: 'from [$ PRICE]',
  },
  {
    name: 'Eruption',
    package: 'Flagship experience',
    description: '3D, scroll storytelling and award-grade craft.',
    price: 'from [$ PRICE]',
  },
];

export const PROCESS = [
  { name: 'Measure', text: 'A call to understand the people, goals and budget.' },
  { name: 'Sketch', text: 'Design directions to react to before anything is built.' },
  { name: 'Build', text: 'Hand-coded, fast, accessible, easy to update.' },
  { name: 'Ship', text: 'Launch, training, and support after.' },
] as const;

export interface LabEntry {
  slug: string;
  title: string;
  summary: string;
}

/** Lab experiments. The first is the fissure shader running behind the home page. */
export const LAB: LabEntry[] = [
  {
    slug: 'light-through-stone',
    title: 'Light through stone',
    summary:
      'The fissure shader behind this site: cellular noise masked into a few branching veins, so magma reads as light leaking through rock rather than an even crackle.',
  },
];
