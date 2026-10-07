/**
 * The project brief: fields, choices and validation, shared by the form in the
 * browser (step-by-step checks, loaded on demand) and the /api/contact endpoint (the real
 * check). Steps and choices exactly as in docs/BRIEF.md.
 */
import { z } from 'astro/zod';
import { BUDGETS, MESSAGE_MAX, NEEDS, TIMELINES, type FieldName } from './contact-fields';

export * from './contact-fields';

const values = <T extends readonly { value: string }[]>(options: T) =>
  options.map((o) => o.value) as [T[number]['value'], ...T[number]['value'][]];

const trimmed = (max: number) =>
  z.string().trim().max(max, `Please keep this under ${max} characters.`);

export const enquirySchema = z.object({
  need: z.enum(values(NEEDS), { error: 'Choose what you need.' }),
  budget: z.enum(values(BUDGETS), { error: 'Choose a budget range (or “Not sure yet”).' }),
  timeline: z.enum(values(TIMELINES), { error: 'Choose a timeline.' }),
  name: trimmed(100).min(1, 'Enter your name.'),
  email: z
    .string()
    .trim()
    .max(200, 'Please keep this under 200 characters.')
    .pipe(z.email('Enter an email address like name@example.com.')),
  business: trimmed(120).optional().default(''),
  phone: trimmed(40)
    .regex(/^[\d\s()+.-]*$/, 'Use digits, spaces and + ( ) - only.')
    .optional()
    .default(''),
  message: trimmed(MESSAGE_MAX).min(
    10,
    'Tell me a little about the project (at least a sentence).',
  ),
});

export type Enquiry = z.infer<typeof enquirySchema>;
export type FieldErrors = Partial<Record<FieldName, string>>;

/** Validate some or all fields. Returns the first error per field. */
export function validate(
  input: Record<string, unknown>,
  fields?: readonly FieldName[],
): { ok: true; data: Enquiry } | { ok: false; errors: FieldErrors } {
  const result = enquirySchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FieldName;
    if (fields && !fields.includes(field)) continue;
    errors[field] ??= issue.message;
  }
  if (!Object.keys(errors).length) {
    // Every requested field is valid (other steps may not be yet).
    return { ok: true, data: result.data as unknown as Enquiry };
  }
  return { ok: false, errors };
}
