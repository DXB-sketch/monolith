/**
 * Site-wide data (projects and experiments are content collections:
 * src/content.config.ts). Never invent facts: anything not yet supplied by the
 * owner stays a bracketed placeholder (the build lists them) or is left out.
 */

export const SITE = {
  name: 'Monolith Web Studio',
  shortName: 'Monolith',
  description:
    'Monolith is a one-person web design and development studio on Bribie Island, Queensland, making fast, accessible, award-level websites for businesses across South East Queensland.',
  locale: 'en-AU',
  location: 'Bribie Island, Queensland',
  coordinates: '27.07°S · 153.16°E',
  email: 'inquiry@monolithstudio.au',
  /** Shown in the footer once registered; left out while empty. */
  abn: '' as string,
  founder: 'Dexter Bell',
  /** Real profiles only (they also feed the structured data's sameAs). Empty: no "Elsewhere" column. */
  socials: [] as Social[],
};

export interface Social {
  label: string;
  href: string;
}

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
  /** What the package includes. */
  included: string[];
}

export const SERVICES: Service[] = [
  {
    name: 'Ember',
    package: 'Launch site',
    description: 'Fast, sharp, accessible site for a new or small business. Ready in weeks.',
    price: 'from $699',
    included: [
      'Up to 5 pages, designed around your business',
      'Works beautifully on phones, tablets and desktops',
      'An enquiry form that emails you directly',
      'SEO basics: page titles, descriptions and a sitemap',
      'Launch help, and free fixes for 2 months after launch',
    ],
  },
  {
    name: 'Flow',
    package: 'Custom build',
    description: 'Bespoke design, motion and an easy-to-use CMS.',
    price: 'from $1,099',
    included: [
      'Up to 10 pages with a custom design for your brand',
      'A CMS, so you can edit pages, news and photos yourself',
      'Considered motion and interactions',
      'Bookings, galleries or event listings where you need them',
      'SEO and privacy-friendly analytics set up for launch',
      'Free fixes for 2 months after launch',
    ],
  },
  {
    name: 'Eruption',
    package: 'Flagship experience',
    description: '3D, scroll storytelling and award-grade craft.',
    price: 'from $1,799',
    included: [
      'Everything in Flow',
      'A custom 3D scene or scroll-driven story at the heart of the site',
      'Tuned to run smoothly on phones, with a fallback for older devices',
      'Accessibility checked throughout, including keyboard and reduced motion',
      'Polished to award-submission standard',
    ],
  },
];

/** Ongoing care and hosting (home page Core chapter and the Services page). */
export const CARE = {
  price: '$50–$200 a month, depending on the services your site uses and how complex it is',
  details: [
    'You can look after your own hosting and domain, or I can manage them for you. Management, including hosting, costs $50–$200 a month, depending on the services your site uses and how complex it is.',
    'Any errors or faults found within two months of launch are fixed free of charge. (That covers things not working as they should, not new changes or revisions.)',
  ],
} as const;

export const PROCESS = [
  { name: 'Measure', text: 'A call to understand the people, goals and budget.' },
  { name: 'Sketch', text: 'Design directions to react to before anything is built.' },
  { name: 'Build', text: 'Hand-coded, fast, accessible, easy to update.' },
  { name: 'Ship', text: 'Launch, training, and support after.' },
] as const;

/** Services FAQ: the owner's own answers. */
export const FAQ = [
  {
    q: 'How long does a website take?',
    a: 'Simpler sites are usually finished in under two weeks. Larger sites, or projects with lots of revisions, can take up to eight weeks.',
  },
  {
    q: 'Do I need to have my words and photos ready?',
    a: 'If you’d like to use your own words and photos, have them ready before we start. If not, I can write the words for you, and can sometimes find suitable photos too.',
  },
  {
    q: 'Can I update the site myself?',
    a: 'Yes. You’ll be able to update the site yourself.',
  },
  {
    q: 'Do you look after hosting and domains?',
    a: 'Either way works. You can look after your own hosting and domain, or I can manage them for you, from $50 to $200 a month depending on the services your site uses and how complex it is.',
  },
  {
    q: 'What happens after launch?',
    a: 'I optimise your site’s SEO, then transfer everything into your ownership. Any errors or faults found within two months of launch are fixed free of charge (new changes and revisions aren’t included).',
  },
  {
    q: 'How do payments work?',
    a: 'Bank transfer, PayID and online payments through Stripe are all accepted, and you can ask about other options. Half the quoted price is due before work begins and the rest after launch. If you’d prefer, we can agree on a payment plan instead, such as paying weekly for the hours worked.',
  },
] as const;
