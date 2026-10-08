/**
 * The project brief's fields and choices, exactly as in docs/BRIEF.md. Plain
 * data with no validator attached, so the form can render and step through
 * without loading Zod; contact-schema.ts adds the rules.
 */
export const NEEDS = [
  { value: 'new-website', label: 'A new website' },
  { value: 'redesign', label: 'A redesign' },
  { value: 'something-else', label: 'Something else' },
] as const;

export const BUDGETS = [
  { value: '300-700', label: '$300–$700' },
  { value: '700-1100', label: '$700–$1,100' },
  { value: '1100-1800', label: '$1,100–$1,800' },
  { value: 'over-1800', label: '$1,800+' },
  { value: 'not-sure', label: 'Not sure yet' },
] as const;

export const TIMELINES = [
  { value: 'asap', label: 'As soon as possible' },
  { value: '1-3-months', label: 'In 1–3 months' },
  { value: 'flexible', label: 'I’m flexible' },
] as const;

export const labelFor = (options: readonly { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

export const MESSAGE_MAX = 4000;

/** Field names, in step order. */
export const STEPS = [
  { id: 'need', legend: 'What do you need?', fields: ['need'] },
  { id: 'budget', legend: 'What’s your budget?', fields: ['budget'] },
  { id: 'timeline', legend: 'When do you need it?', fields: ['timeline'] },
  { id: 'details', legend: 'Your details', fields: ['name', 'email', 'business', 'phone'] },
  { id: 'message', legend: 'Tell me about the project', fields: ['message'] },
] as const;

export type FieldName = (typeof STEPS)[number]['fields'][number];

/** The honeypot and the signed start time travel with the form. */
export const HONEYPOT = 'website';
export const TOKEN = 'started';
