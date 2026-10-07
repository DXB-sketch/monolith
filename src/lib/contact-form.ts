/**
 * The project brief, enhanced. Without this script the form is one page of
 * fieldsets that posts normally. With it:
 * - one fieldset per step, "Step 2 of 5" announced politely, Back and Next;
 * - each step is validated (the same schema as the server) before moving on,
 *   and focus moves to the new step's legend;
 * - errors are linked to their fields (aria-describedby, aria-invalid) and
 *   summarised at the top, which takes focus;
 * - a draft is kept in sessionStorage (a refresh or back navigation keeps the
 *   answers) and cleared after a successful send;
 * - the brief is sent as JSON, and the in-world confirmation replaces the form.
 */
import { STEPS, validate, type FieldErrors, type FieldName } from './contact-schema';

const DRAFT_KEY = 'monolith:brief';
const LABELS: Record<FieldName, string> = {
  need: 'What you need',
  budget: 'Budget',
  timeline: 'Timeline',
  name: 'Name',
  email: 'Email',
  business: 'Business',
  phone: 'Phone',
  message: 'Project',
};
const CHOICE_FIELDS = new Set<FieldName>(['need', 'budget', 'timeline']);

interface Draft {
  values: Record<string, string>;
  step: number;
}

function readDraft(): Draft | null {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // No storage: the draft just isn't kept.
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function initBrief() {
  const form = document.querySelector<HTMLFormElement>('[data-brief]');
  if (!form || form.dataset.enhanced) return;
  form.dataset.enhanced = '1';

  const steps = Array.from(form.querySelectorAll<HTMLFieldSetElement>('[data-brief-step]'));
  const progress = form.querySelector<HTMLElement>('[data-brief-progress]')!;
  const summary = form.querySelector<HTMLElement>('[data-brief-summary]')!;
  const summaryList = summary.querySelector<HTMLElement>('[data-brief-summary-list]')!;
  const back = form.querySelector<HTMLButtonElement>('[data-brief-back]')!;
  const next = form.querySelector<HTMLButtonElement>('[data-brief-next]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-brief-submit]')!;
  const success = document.querySelector<HTMLElement>('[data-brief-success]');
  const hadServerErrors = !summary.hidden;
  let current = 0;

  form.noValidate = true;

  const values = (): Record<string, string> => {
    const data = new FormData(form);
    const out: Record<string, string> = {};
    for (const [key, value] of data.entries()) if (typeof value === 'string') out[key] = value;
    return out;
  };

  const control = (field: FieldName) =>
    CHOICE_FIELDS.has(field)
      ? form.querySelector<HTMLInputElement>(`#field-${field}-0`)
      : form.querySelector<HTMLInputElement>(`#field-${field}`);

  const stepOf = (field: FieldName) =>
    STEPS.findIndex((step) => (step.fields as readonly string[]).includes(field));

  // ── Errors ──────────────────────────────────────────────────────────────
  const setFieldError = (field: FieldName, message: string | undefined) => {
    const error = form.querySelector<HTMLElement>(`#error-${field}`);
    if (error) {
      error.textContent = message ?? '';
      error.hidden = !message;
    }
    const inputs = CHOICE_FIELDS.has(field)
      ? form.querySelectorAll<HTMLInputElement>(`input[name="${field}"]`)
      : form.querySelectorAll<HTMLInputElement>(`#field-${field}`);
    inputs.forEach((input) => {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
  };

  const showErrors = (errors: FieldErrors, formError?: string) => {
    (Object.keys(LABELS) as FieldName[]).forEach((field) => setFieldError(field, errors[field]));
    summaryList.replaceChildren(
      ...(Object.entries(errors) as [FieldName, string][]).map(([field, message]) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `#${control(field)?.id ?? ''}`;
        link.textContent = `${LABELS[field]}: ${message}`;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          showStep(stepOf(field), false);
          control(field)?.focus();
        });
        item.append(link);
        return item;
      }),
    );
    const existing = summary.querySelector('[data-brief-form-error]');
    existing?.remove();
    if (formError) {
      const p = document.createElement('p');
      p.dataset.briefFormError = '';
      p.textContent = formError;
      summaryList.before(p);
    }
    summary.hidden = false;
    summary.focus();
  };

  const clearErrors = () => {
    (Object.keys(LABELS) as FieldName[]).forEach((field) => setFieldError(field, undefined));
    summaryList.replaceChildren();
    summary.querySelector('[data-brief-form-error]')?.remove();
    summary.hidden = true;
  };

  // ── Steps ───────────────────────────────────────────────────────────────
  const showStep = (index: number, focus = true) => {
    current = Math.max(0, Math.min(steps.length - 1, index));
    steps.forEach((step, i) => (step.hidden = i !== current));
    progress.hidden = false;
    progress.textContent = `Step ${current + 1} of ${steps.length}`;
    back.hidden = current === 0;
    next.hidden = current === steps.length - 1;
    submit.hidden = current !== steps.length - 1;
    writeDraft({ values: values(), step: current });
    if (focus) steps[current]!.querySelector<HTMLElement>('[data-brief-legend]')?.focus();
  };

  const validateStep = (index: number) => {
    const fields = STEPS[index]!.fields as readonly FieldName[];
    const result = validate(values(), fields);
    return result.ok ? null : result.errors;
  };

  next.addEventListener('click', () => {
    const errors = validateStep(current);
    if (errors) return showErrors(errors);
    clearErrors();
    showStep(current + 1);
  });

  back.addEventListener('click', () => {
    clearErrors();
    showStep(current - 1);
  });

  // Enter in a text field moves on rather than submitting early.
  form.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key !== 'Enter' || target.tagName !== 'INPUT' || current === steps.length - 1) return;
    event.preventDefault();
    next.click();
  });

  form.addEventListener('input', () => writeDraft({ values: values(), step: current }));

  // ── Sending ─────────────────────────────────────────────────────────────
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = values();
    const result = validate(data);
    if (!result.ok) {
      const first = (Object.keys(result.errors) as FieldName[])
        .map(stepOf)
        .sort((a, b) => a - b)[0]!;
      showStep(first, false);
      return showErrors(result.errors);
    }
    submit.disabled = true;
    const label = submit.innerHTML;
    submit.textContent = 'Sending…';
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      const reply = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        errors?: FieldErrors;
      };
      if (response.ok && reply.ok) {
        clearDraft();
        form.hidden = true;
        if (success) {
          success.hidden = false;
          success.querySelector<HTMLElement>('[data-brief-success-heading]')?.focus();
        }
        return;
      }
      if (reply.errors) {
        const first =
          (Object.keys(reply.errors) as FieldName[]).map(stepOf).sort((a, b) => a - b)[0] ?? 0;
        showStep(first, false);
        return showErrors(reply.errors);
      }
      showErrors({}, 'The brief couldn’t be sent just now. Please try again in a moment.');
    } catch {
      showErrors({}, 'The brief couldn’t be sent (no connection?). Your answers are saved here.');
    } finally {
      submit.disabled = false;
      submit.innerHTML = label;
    }
  });

  // ── Start: restore a draft, then go stepwise ────────────────────────────
  const draft = hadServerErrors ? null : readDraft();
  if (draft) {
    for (const [name, value] of Object.entries(draft.values)) {
      const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        `[name="${CSS.escape(name)}"]`,
      );
      fields.forEach((field) => {
        if (field instanceof HTMLInputElement && field.type === 'radio') {
          field.checked = field.value === value;
        } else if (field.type !== 'hidden' && field.name !== 'website') {
          field.value = value;
        }
      });
    }
  }
  if (hadServerErrors) {
    // Plain-form errors came back from the server: start at the first broken step.
    const firstError = summary.querySelector<HTMLAnchorElement>('a[href^="#field-"]');
    const field = firstError?.hash.replace(/^#field-/, '').replace(/-\d+$/, '') as FieldName;
    showStep(field ? stepOf(field) : 0, false);
    summary.focus();
  } else {
    showStep(draft?.step ?? 0, false);
  }
}
