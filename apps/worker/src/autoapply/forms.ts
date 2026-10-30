import type { AutoApplyProvider, FormFieldType, FormQuestion } from '@parakeet/shared';

// Application forms, read the way the job board's own page reads them, normalised to FormQuestion.
// Greenhouse: its public Job Board API. Lever: the apply page's HTML. Ashby: the public GraphQL its
// job pages load. Read only: submitting is done by the user's browser (the Friday extension).

const UA = 'Mozilla/5.0 (compatible; FridayJobs/1.0; +https://friday-ai.in)';

export class FormUnavailableError extends Error {}

async function get(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...init?.headers }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404 || res.status === 410) throw new FormUnavailableError(`Form not found (${res.status})`);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res;
}

/** The page the extension opens to apply. */
export function submitUrl(provider: AutoApplyProvider, board: string, externalId: string) {
  switch (provider) {
    // Greenhouse's own hosted form, also used when a company embeds it in its careers site.
    case 'greenhouse':
      return `https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(externalId)}`;
    case 'lever':
      return `https://jobs.lever.co/${encodeURIComponent(board)}/${encodeURIComponent(externalId)}/apply`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${encodeURIComponent(board)}/${encodeURIComponent(externalId)}/application`;
  }
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// ---- Greenhouse ----------------------------------------------------------------------------------

interface GhField {
  name: string;
  type: string;
  values?: { label: string; value: string | number }[];
}
interface GhQuestion {
  label: string;
  required: boolean;
  description?: string | null;
  fields: GhField[];
}

const GH_TYPES: Record<string, FormFieldType> = {
  input_text: 'text',
  textarea: 'textarea',
  input_file: 'file',
  multi_value_single_select: 'select',
  multi_value_multi_select: 'multiselect',
  input_hidden: 'hidden',
};
const GH_STANDARD = new Set(['first_name', 'last_name', 'email', 'phone', 'location', 'preferred_name']);
/** The degree list on Greenhouse's education section. */
const GH_DEGREES = [
  'High School', "Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Master of Business Administration (M.B.A.)',
  'Juris Doctor (J.D.)', 'Doctor of Medicine (M.D.)', 'Doctor of Philosophy (Ph.D.)', "Engineer's Degree", 'Other',
];

function ghQuestions(list: GhQuestion[] | null | undefined, kind?: FormQuestion['kind']): FormQuestion[] {
  const out: FormQuestion[] = [];
  for (const q of list ?? []) {
    // A file question offers "attach" or "paste" as two fields; the file is the one filled.
    const field = q.fields.find((f) => f.type === 'input_file') ?? q.fields[0];
    if (!field) continue;
    const type = GH_TYPES[field.type] ?? 'text';
    if (type === 'hidden') continue;
    out.push({
      key: field.name,
      label: decode(q.label),
      type,
      required: q.required,
      options: (field.values ?? []).map((v) => decode(v.label)),
      kind: kind ?? (field.name === 'resume' ? 'resume' : GH_STANDARD.has(field.name) ? 'standard' : 'custom'),
      ...(q.description ? { description: decode(q.description).slice(0, 500) } : {}),
    });
  }
  return out;
}

async function greenhouse(board: string, id: string): Promise<FormQuestion[]> {
  const res = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}?questions=true`);
  const d = (await res.json()) as {
    education?: 'education_required' | 'education_optional' | null;
    questions?: GhQuestion[];
    location_questions?: GhQuestion[];
    compliance?: { questions: GhQuestion[] }[] | null;
    demographic_questions?: { questions?: { label: string; required: boolean; id: number; answer_options: { label: string }[]; type: string }[] } | null;
  };
  const form = [...ghQuestions(d.questions), ...ghQuestions(d.location_questions)];
  // Greenhouse's form adds a country picker for the phone number.
  if (form.some((q) => q.key === 'phone')) {
    form.splice(form.findIndex((q) => q.key === 'phone'), 0, { key: 'country', label: 'Country', type: 'select', required: true, options: [], kind: 'standard' });
  }
  // The education section the form shows when the job asks for it (not listed as questions by the API).
  if (d.education) {
    const required = d.education === 'education_required';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    form.push(
      { key: 'school--0', label: 'School', type: 'select', required, options: [], kind: 'custom', description: 'The candidate’s most recent school or university, as named on the resume' },
      { key: 'degree--0', label: 'Degree', type: 'select', required, options: GH_DEGREES, kind: 'custom' },
      { key: 'discipline--0', label: 'Discipline', type: 'select', required, options: [], kind: 'custom', description: 'Field of study, e.g. Computer Science' },
      { key: 'start-month--0', label: 'Start date month', type: 'select', required, options: months, kind: 'custom' },
      { key: 'start-year--0', label: 'Start date year', type: 'number', required, options: [], kind: 'custom' },
      { key: 'end-month--0', label: 'End date month', type: 'select', required, options: months, kind: 'custom' },
      { key: 'end-year--0', label: 'End date year', type: 'number', required, options: [], kind: 'custom' },
    );
  }
  for (const c of d.compliance ?? []) form.push(...ghQuestions(c.questions, 'eeo'));
  for (const q of d.demographic_questions?.questions ?? []) {
    form.push({
      // The form's field id is the bare question id.
      key: String(q.id),
      label: decode(q.label),
      type: q.type === 'multi_value_multi_select' ? 'multiselect' : 'select',
      required: q.required,
      options: q.answer_options.map((o) => decode(o.label)),
      kind: 'eeo',
    });
  }
  return form;
}

// ---- Lever ---------------------------------------------------------------------------------------

const LEVER_STANDARD: Record<string, string> = {
  name: 'Full name',
  email: 'Email',
  phone: 'Phone',
  location: 'Current location',
  org: 'Current company',
  'urls[LinkedIn]': 'LinkedIn URL',
  'urls[GitHub]': 'GitHub URL',
  'urls[Portfolio]': 'Portfolio URL',
  'urls[Twitter]': 'Twitter URL',
  'urls[Other]': 'Other website',
};

interface LeverCard {
  id: string;
  text?: string;
  fields: { type: string; text: string; required?: boolean; description?: string; options?: { text: string }[] }[];
}

const LEVER_TYPES: Record<string, FormFieldType> = {
  text: 'text',
  textarea: 'textarea',
  'multiple-choice': 'select',
  'multiple-select': 'multiselect',
  dropdown: 'select',
  file: 'file',
  date: 'date',
};

async function lever(board: string, id: string): Promise<FormQuestion[]> {
  const html = await (await get(submitUrl('lever', board, id))).text();
  const form: FormQuestion[] = [{ key: 'resume', label: 'Resume/CV', type: 'file', required: true, options: [], kind: 'resume' }];
  // Each field sits in an <li class="application-question">; a required one is marked in that block.
  const blocks = html.split(/<li class="application-question/).slice(1);
  for (const [key, label] of Object.entries(LEVER_STANDARD)) {
    const block = blocks.find((b) => b.includes(`name="${key}"`));
    if (!block) continue;
    const required = /class="required"|required-field|\brequired(=| |>)/.test(block.slice(0, block.indexOf('</li>') + 1 || undefined));
    form.push({ key, label, type: 'text', required, options: [], kind: 'standard' });
  }
  // Custom questions: each card carries its own definition as JSON.
  for (const m of html.matchAll(/value="(\{[^"]*?)"\s+name="cards\[([^\]]+)\]\[baseTemplate\]"/g)) {
    let card: LeverCard;
    try {
      card = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    } catch {
      continue;
    }
    card.fields.forEach((f, i) => {
      form.push({
        key: `cards[${m[2]}][field${i}]`,
        label: decode(f.text),
        type: LEVER_TYPES[f.type] ?? 'text',
        required: Boolean(f.required),
        options: (f.options ?? []).map((o) => decode(o.text)),
        kind: 'custom',
        ...(f.description ? { description: decode(f.description).slice(0, 500) } : {}),
      });
    });
  }
  if (/name="comments"/.test(html)) {
    form.push({ key: 'comments', label: 'Additional information', type: 'textarea', required: false, options: [], kind: 'custom' });
  }
  for (const [key, label] of [
    ['eeo[gender]', 'Gender'],
    ['eeo[race]', 'Race'],
    ['eeo[veteran]', 'Veteran status'],
    ['eeo[disability]', 'Disability status'],
  ] as const) {
    if (!html.includes(`name="${key}"`)) continue;
    const select = new RegExp(`<select[^>]*name="${key.replace(/[[\]]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
    const options = select ? [...select[1].matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((o) => decode(o[1])).filter(Boolean) : [];
    form.push({ key, label, type: 'select', required: false, options, kind: 'eeo' });
  }
  return form;
}

// ---- Ashby ---------------------------------------------------------------------------------------

interface AshbyField {
  path: string;
  title: string;
  type: string;
  selectableValues?: { label: string; value: string }[] | null;
}

const ASHBY_TYPES: Record<string, FormFieldType> = {
  String: 'text',
  Email: 'text',
  Phone: 'text',
  LongText: 'textarea',
  File: 'file',
  ValueSelect: 'select',
  MultiValueSelect: 'multiselect',
  Boolean: 'checkbox',
  Date: 'date',
  Number: 'number',
  Location: 'text',
  SocialLink: 'text',
};

const ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { isRequired field } } } }
    surveyForms { sections { fieldEntries { ... on FormFieldEntry { isRequired field } } } }
  }
}`;

async function ashby(board: string, id: string): Promise<FormQuestion[]> {
  const res = await get('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operationName: 'ApiJobPosting',
      variables: { organizationHostedJobsPageName: board, jobPostingId: id },
      query: ASHBY_QUERY,
    }),
  });
  const body = (await res.json()) as {
    data?: { jobPosting: { applicationForm: { sections: { fieldEntries: { isRequired: boolean; field: AshbyField }[] }[] } | null; surveyForms?: { sections: { fieldEntries: { isRequired: boolean; field: AshbyField }[] }[] }[] } | null };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(`Ashby: ${body.errors[0].message}`);
  const posting = body.data?.jobPosting;
  if (!posting?.applicationForm) throw new FormUnavailableError('Posting not found');
  const read = (sections: { fieldEntries: { isRequired: boolean; field: AshbyField }[] }[], kind?: FormQuestion['kind']) =>
    sections.flatMap((s) =>
      s.fieldEntries
        .filter((e) => e.field?.path)
        .map(({ isRequired, field }): FormQuestion => ({
          key: field.path,
          label: decode(field.title ?? field.path),
          type: ASHBY_TYPES[field.type] ?? 'text',
          required: isRequired,
          options: (field.selectableValues ?? []).map((v) => decode(v.label)),
          kind: kind ?? (field.path === '_systemfield_resume' ? 'resume' : field.path.startsWith('_systemfield_') ? 'standard' : 'custom'),
        })),
    );
  return [...read(posting.applicationForm.sections), ...(posting.surveyForms ?? []).flatMap((f) => read(f.sections, 'eeo'))];
}

/** The listing's application form. Throws FormUnavailableError when the posting is gone. */
export function fetchForm(provider: AutoApplyProvider, board: string, externalId: string): Promise<FormQuestion[]> {
  switch (provider) {
    case 'greenhouse':
      return greenhouse(board, externalId);
    case 'lever':
      return lever(board, externalId);
    case 'ashby':
      return ashby(board, externalId);
  }
}
