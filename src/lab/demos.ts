/**
 * Interactive Lab demos, by the `demo` key in a lab entry. Each is a dynamic
 * import, so a demo's code only loads on its own page.
 */
export const DEMOS = {
  'light-through-stone': () => import('./light-through-stone'),
} as const;

export type DemoKey = keyof typeof DEMOS;

export const isDemoKey = (key: string | undefined): key is DemoKey => Boolean(key && key in DEMOS);
