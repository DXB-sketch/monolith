/**
 * Site-wide data (projects and experiments are content collections:
 * src/content.config.ts). Bracketed values are placeholders from docs/BRIEF.md and must
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

export interface Service {
  name: string;
  package: string;
  description: string;
  price: string;
  /** What the package includes: to be supplied by the owner. */
  included: string[];
}

export const SERVICES: Service[] = [
  {
    name: 'Ember',
    package: 'Launch site',
    description: 'Fast, sharp, accessible site for a new or small business. Ready in weeks.',
    price: 'from [$ PRICE]',
    included: ['[WHAT’S INCLUDED TO BE SUPPLIED]'],
  },
  {
    name: 'Flow',
    package: 'Custom build',
    description: 'Bespoke design, motion and an easy-to-use CMS.',
    price: 'from [$ PRICE]',
    included: ['[WHAT’S INCLUDED TO BE SUPPLIED]'],
  },
  {
    name: 'Eruption',
    package: 'Flagship experience',
    description: '3D, scroll storytelling and award-grade craft.',
    price: 'from [$ PRICE]',
    included: ['[WHAT’S INCLUDED TO BE SUPPLIED]'],
  },
];

export const PROCESS = [
  { name: 'Measure', text: 'A call to understand the people, goals and budget.' },
  { name: 'Sketch', text: 'Design directions to react to before anything is built.' },
  { name: 'Build', text: 'Hand-coded, fast, accessible, easy to update.' },
  { name: 'Ship', text: 'Launch, training, and support after.' },
] as const;

/** Services FAQ: sensible questions, answers to be supplied (no invented policies). */
export const FAQ = [
  { q: 'How long does a website take?', a: '[ANSWER TO BE SUPPLIED]' },
  { q: 'Do I need to have my words and photos ready?', a: '[ANSWER TO BE SUPPLIED]' },
  { q: 'Can I update the site myself?', a: '[ANSWER TO BE SUPPLIED]' },
  { q: 'Do you look after hosting and domains?', a: '[ANSWER TO BE SUPPLIED]' },
  { q: 'What happens after launch?', a: '[ANSWER TO BE SUPPLIED]' },
  { q: 'How do payments work?', a: '[ANSWER TO BE SUPPLIED]' },
] as const;
