import type { Locator, Page } from 'playwright-core';
import { answerFor, pickOption, type Question } from './answer.js';
import type { Config } from './config.js';
import { answerFromResume } from './llm.js';

// Fills whatever form is open inside `scope` (an Easy Apply step, an Indeed page, a Naukri drawer):
// every empty text field, dropdown, radio group and consent checkbox gets your answer. Fields that are
// already filled (sites prefill your email and phone) are left alone. Returns the questions nothing
// answered; the caller then skips the job rather than guess.

interface Field {
  id: string;
  kind: Question['kind'] | 'file';
  label: string;
  options: string[];
  filled: boolean;
  required: boolean;
}

/** Lists the form's fields, tagging each with data-jobbot-id so it can be filled afterwards. */
async function fields(scope: Locator): Promise<Field[]> {
  // Sent as source text: tsx's helpers (__name) don't exist inside the page.
  return scope.evaluate(fieldsInPage()) as Promise<Field[]>;
}

/** Built at run time from FIELDS_JS, so no build step rewrites it before Playwright sends it to the page. */
let compiled: ((root: Element) => Field[]) | null = null;
const fieldsInPage = () => (compiled ??= new Function(`return ${FIELDS_JS}`)() as (root: Element) => Field[]);

/** Runs in the page: lists the form's fields and tags each with data-jobbot-id. Plain JavaScript. */
const FIELDS_JS = String.raw`(root) => {
    const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const labelOf = (el) => {
      const id = el.getAttribute('id');
      const byFor = id ? root.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
      if (byFor && text(byFor)) return text(byFor);
      const aria = el.getAttribute('aria-label');
      if (aria) return aria;
      const by = el.getAttribute('aria-labelledby');
      if (by) return by.split(/\s+/).map((i) => text(document.getElementById(i))).join(' ').trim();
      const legend = el.closest('fieldset')?.querySelector('legend');
      if (legend && text(legend)) return text(legend);
      const wrap = el.closest('label');
      if (wrap && text(wrap)) return text(wrap);
      // The nearest block above the field that has text (a question heading).
      let node = el;
      for (let i = 0; i < 4 && node; i++) {
        node = node.parentElement;
        const t = text(node?.querySelector('label, span, p, div[class*="label"], div[class*="question"]'));
        if (t) return t;
      }
      return el.getAttribute('placeholder') ?? el.getAttribute('name') ?? '';
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0 || el.type === 'radio' || el.type === 'file';
    };
    let n = 0;
    const tag = (el) => {
      const existing = el.getAttribute('data-jobbot-id');
      if (existing) return existing;
      const id = 'jb' + Date.now().toString(36) + (n++);
      el.setAttribute('data-jobbot-id', id);
      return id;
    };
    const out = [];
    const radios = new Map();
    for (const el of Array.from(root.querySelectorAll('input, textarea, select'))) {
      if (!visible(el) || el.disabled) continue;
      const input = el;
      const required = input.required || el.getAttribute('aria-required') === 'true';
      if (el.tagName === 'SELECT') {
        const s = el;
        out.push({ id: tag(el), kind: 'select', label: labelOf(el), options: Array.from(s.options).map((o) => o.text.trim()), filled: s.selectedIndex > 0, required });
      } else if (el.tagName === 'TEXTAREA') {
        out.push({ id: tag(el), kind: 'textarea', label: labelOf(el), options: [], filled: Boolean(input.value.trim()), required });
      } else if (input.type === 'radio') {
        const group = input.name || labelOf(input.closest('fieldset') ?? input);
        radios.set(group, [...(radios.get(group) ?? []), input]);
      } else if (input.type === 'checkbox') {
        out.push({ id: tag(el), kind: 'checkbox', label: labelOf(el), options: [], filled: input.checked, required });
      } else if (input.type === 'file') {
        out.push({ id: tag(el), kind: 'file', label: labelOf(el), options: [], filled: Boolean(input.files?.length), required });
      } else if (['text', 'number', 'tel', 'email', 'url', 'search', ''].includes(input.type)) {
        // Typeahead fields (LinkedIn city) are text fields too.
        out.push({ id: tag(el), kind: input.type === 'number' || input.inputMode === 'numeric' ? 'number' : 'text', label: labelOf(el), options: [], filled: Boolean(input.value.trim()), required });
      }
    }
    for (const group of radios.values()) {
      const fs = group[0].closest('fieldset');
      const question = fs?.querySelector('legend') ? text(fs.querySelector('legend')) : labelOf(fs ?? group[0].parentElement.parentElement);
      for (const r of group) tag(r);
      out.push({
        id: group.map((r) => r.getAttribute('data-jobbot-id')).join(','),
        kind: 'radio',
        label: question,
        options: group.map((r) => labelOf(r)),
        filled: group.some((r) => r.checked),
        required: group.some((r) => r.required),
      });
    }
    return out;
}`;

const CONSENT = /\b(agree|consent|acknowledge|terms|privacy|confirm (that|the information)|accurate|declare)\b/i;
const DONT_TICK = /\b(follow|subscribe|newsletter|marketing|updates|top choice|job alert)\b/i;

export async function fillForm(page: Page, scope: Locator, config: Config): Promise<string[]> {
  const unanswered: string[] = [];
  for (const f of await fields(scope)) {
    const el = page.locator(`[data-jobbot-id="${f.id.split(',')[0]}"]`);
    if (f.kind === 'checkbox') {
      // Ticks consent boxes; unticks "follow this company" and newsletters.
      if (DONT_TICK.test(f.label) && f.filled) await el.uncheck({ force: true }).catch(() => {});
      else if (CONSENT.test(f.label) && !f.filled) await el.check({ force: true }).catch(() => {});
      continue;
    }
    if (f.kind === 'file') {
      if (!f.filled && /resume|cv|upload/i.test(f.label)) await el.setInputFiles(config.resumePath).catch(() => {});
      continue;
    }
    if (f.filled || !f.label) continue;

    const q: Question = { label: f.label, kind: f.kind, options: f.options };
    let answer = answerFor(q, config) ?? (await answerFromResume(q, config));
    if (answer === null) {
      if (f.required || f.kind === 'radio' || f.kind === 'select') unanswered.push(f.label);
      continue;
    }
    if (f.kind === 'select' || f.kind === 'radio') {
      const option = pickOption(answer, f.options);
      if (!option) {
        unanswered.push(`${f.label} (your answer "${answer}" isn't one of: ${f.options.filter(Boolean).join(' / ')})`);
        continue;
      }
      answer = option;
      if (f.kind === 'select') await el.selectOption({ label: option });
      else {
        const radio = page.locator(`[data-jobbot-id="${f.id.split(',')[f.options.indexOf(option)]}"]`);
        await radio.check({ force: true });
      }
      continue;
    }
    if (f.kind === 'number' && !/^\d+(\.\d+)?$/.test(answer)) {
      unanswered.push(`${f.label} (needs a number; your answer is "${answer}")`);
      continue;
    }
    await el.fill(answer);
    // Typeaheads (city) offer suggestions: take the first.
    const suggestion = page.locator('[role="listbox"] [role="option"]').first();
    if (await suggestion.isVisible({ timeout: 800 }).catch(() => false)) await suggestion.click().catch(() => {});
  }
  return unanswered;
}
