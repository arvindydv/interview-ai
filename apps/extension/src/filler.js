// Fills one prepared application on a job board's own form, submits it, and reports what the job
// board said (to background.js). Injected into the form's tab on every page load: phase "fill" fills
// and submits, phase "check" (a page loaded after submitting) only looks for the confirmation. It
// types into the page like a person would and never touches a CAPTCHA: if a job board shows a
// challenge, the user is asked to finish it.
//
// Fields are found by their name or id on the job board first, then by the question's label, so the
// same code works across Greenhouse, Lever and Ashby. Exposed as window.__fridayFill for tests.

(() => {
  if (window.__fridayFill) return;

  const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  // What each job board shows once it has the application (kept in step with the API's check).
  const CONFIRMATION = {
    greenhouse: { url: /greenhouse\.io\/.*(confirmation|thank)/i, text: /thank you for applying|application (has been )?(received|submitted)|we('ve| have) received your application/i },
    lever: { url: /lever\.co\/[^/]+\/[^/]+\/thanks/i, text: /application submitted|thank(s| you) for applying|we('ve| have) received your application/i },
    ashby: { url: /ashbyhq\.com\/.*(submitted|confirmation)/i, text: /application (was )?(successfully )?submitted|thank(s| you) for (applying|submitting)|we('ve| have) received your application/i },
    workable: { url: /workable\.com\/.*(success|thank|submitted)/i, text: /thank(s| you) for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)/i },
    smartrecruiters: { url: /smartrecruiters\.com\/.*(success|thank|confirmation)/i, text: /thank(s| you) for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)/i },
    workday: { url: /myworkdayjobs\.com\/.*(applicationSubmitted|submitted)/i, text: /application submitted|thank(s| you) for applying|your application (has been|was) (submitted|received)/i },
  };
  // Tests set __fridayProvider for saved copies of a form.
  const HOSTS = [['lever.co', 'lever'], ['ashbyhq.com', 'ashby'], ['workable.com', 'workable'], ['smartrecruiters.com', 'smartrecruiters'], ['myworkdayjobs.com', 'workday']];
  const provider = window.__fridayProvider ?? HOSTS.find(([h]) => location.host.includes(h))?.[1] ?? 'greenhouse';

  /** How long a tab left with the user (CAPTCHA, sign-in) is watched for them finishing it. */
  const USER_WAIT_MS = 45 * 60_000;
  // Friday's servers run this file too (apps/worker/src/autoapply/cloud.ts), and listen through __fridayCloudSend.
  const send = (msg) =>
    (window.__fridayCloudSend ? window.__fridayCloudSend(msg) : globalThis.chrome?.runtime?.sendMessage?.(msg))?.catch?.(() => {});

  const CONTROL = 'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role=combobox]';

  async function waitFor(fn, ms, every = 250) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(every);
    }
    return null;
  }

  // ---- finding fields --------------------------------------------------------------------------

  function textOf(el) {
    return el ? (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
  }

  function labelOf(el) {
    if (el.labels?.length) return textOf(el.labels[0]);
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => textOf(document.getElementById(id))).join(' ');
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const legend = el.closest('fieldset')?.querySelector('legend');
    if (legend) return textOf(legend);
    return '';
  }

  /** The smallest element around a question's text that also holds its control(s). */
  function containerFor(label) {
    const want = norm(label).slice(0, 80);
    if (!want) return null;
    const candidates = [...document.querySelectorAll('label, legend, span, div, p, h3, h4')].filter((el) => {
      const t = norm(textOf(el));
      return t.length < want.length + 80 && t.startsWith(want.slice(0, Math.min(want.length, 50))) && el.childElementCount < 6;
    });
    for (const el of candidates) {
      let box = el;
      for (let i = 0; i < 6 && box; i++, box = box.parentElement) {
        if (box.querySelector(`${CONTROL}, [role=radio], [role=checkbox], input[type=radio], input[type=checkbox]`)) return box;
      }
    }
    return null;
  }

  function byKey(key) {
    const esc = CSS.escape(key);
    return (
      document.querySelector(`[name="${key.replace(/"/g, '\\"')}"]:not([type=hidden])`) ??
      document.getElementById(key) ??
      document.querySelector(`[id="${esc}"], [name$="[${esc}]"]:not([type=hidden]), [id$="${esc}"]:not([type=hidden])`) ??
      null
    );
  }

  function findControl(q) {
    const direct = byKey(q.key);
    if (direct && direct.type !== 'hidden') return { el: direct, box: direct.closest('fieldset, [role=group]') ?? containerFor(q.label) };
    const want = norm(q.label);
    const el = [...document.querySelectorAll(CONTROL)].find((c) => {
      const l = norm(labelOf(c));
      return l && (l === want || l.startsWith(want.slice(0, 60)) || want.startsWith(l));
    });
    if (el) return { el, box: containerFor(q.label) };
    const box = containerFor(q.label);
    return box ? { el: box.querySelector(CONTROL), box } : null;
  }

  // ---- filling -----------------------------------------------------------------------------------

  /** Sets a value the way typing does, so React and other frameworks see it. */
  function setValue(el, value) {
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const same = (a, b) => norm(a) === norm(b);

  function pickNative(select, value) {
    const opt = [...select.options].find((o) => same(o.textContent, value) || same(o.value, value));
    if (!opt) return false;
    select.value = opt.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /** Searchable dropdowns (react-select and the like): type, then click the matching option. */
  async function pickCombobox(el, value, allowOther = false) {
    el.focus();
    el.click();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    if (el instanceof HTMLInputElement) setValue(el, value);
    const option = await waitFor(
      () =>
        [...document.querySelectorAll('[role=option], [class*=option]')].find((o) => visible(o) && same(textOf(o), value)) ??
        [...document.querySelectorAll('[role=option]')].find((o) => visible(o) && norm(textOf(o)).startsWith(norm(value))),
      2500,
    );
    if (!option) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      // A school or field of study missing from the board's list: "Other" is the honest choice.
      if (allowOther && !same(value, 'Other')) return pickCombobox(el, 'Other', false);
      return false;
    }
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    option.click();
    await sleep(150);
    return true;
  }

  /** Radio buttons, checkboxes or option buttons inside a question's container. */
  function pickChoices(box, values) {
    let done = 0;
    for (const value of values) {
      const inputs = [...box.querySelectorAll('input[type=radio], input[type=checkbox]')];
      const input = inputs.find((i) => same(labelOf(i) || textOf(i.parentElement), value) || same(i.value, value));
      if (input) {
        if (!input.checked) input.click();
        done++;
        continue;
      }
      const button = [...box.querySelectorAll('button, [role=radio], [role=checkbox], [role=button]')].find((b) => same(textOf(b), value));
      if (button) {
        if (button.getAttribute('aria-pressed') !== 'true' && button.getAttribute('aria-checked') !== 'true') button.click();
        done++;
      }
    }
    return done === values.length;
  }

  function attachFile(input, resume) {
    const bytes = Uint8Array.from(atob(resume.base64), (c) => c.charCodeAt(0));
    const type = /\.docx$/i.test(resume.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], resume.name, { type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files.length === 1;
  }

  function resumeInput(q) {
    const direct = q ? byKey(q.key) : null;
    if (direct?.type === 'file') return direct;
    const files = [...document.querySelectorAll('input[type=file]')];
    return files.find((f) => /resume|cv/i.test(`${f.name} ${f.id} ${labelOf(f)} ${textOf(f.closest('div, li, fieldset'))}`)) ?? files[0] ?? null;
  }

  async function fillOne(q, answer, resume, coverLetter) {
    const values = Array.isArray(answer.value) ? answer.value : [answer.value];
    if (answer.source === 'cover_letter') {
      const direct = byKey(q.key);
      const files = [...document.querySelectorAll('input[type=file]')];
      const input =
        (direct?.type === 'file' ? direct : null) ??
        files.find((f) => /cover/i.test(`${f.name} ${f.id} ${labelOf(f)} ${textOf(f.closest('div, li, fieldset'))}`));
      if (input && coverLetter) return attachFile(input, coverLetter);
      return false;
    }
    if (q.type === 'file' || answer.source === 'file') {
      // A required text alternative (e.g. a cover letter written out) goes in the paste box when there is one.
      if (answer.source !== 'file') {
        const paste = byKey(`${q.key}_text`);
        if (paste) return setValue(paste, values[0]), true;
        return false;
      }
      const input = resumeInput(q);
      return input ? attachFile(input, resume) : false;
    }
    const found = findControl(q);
    if (!found) return false;
    const { el, box } = found;
    if (el instanceof HTMLSelectElement) return values.every((v) => pickNative(el, v));
    const listbox = box?.querySelector('button[aria-haspopup=listbox]');
    if (!(el instanceof HTMLSelectElement) && listbox) {
      listbox.click();
      const option = await waitFor(() => [...document.querySelectorAll('[role=option]')].find((o) => visible(o) && same(textOf(o), values[0])), 2500);
      if (!option) return false;
      option.click();
      return true;
    }
    if (el?.getAttribute('role') === 'combobox' || el?.getAttribute('aria-autocomplete') || el?.closest('[class*=select__control], [class*=Select]')) {
      const other = /^(school|discipline)--/.test(q.key);
      for (const v of values) if (!(await pickCombobox(el, v, other))) return false;
      return true;
    }
    if (el && (el.type === 'radio' || el.type === 'checkbox')) return pickChoices(box ?? el.closest('fieldset, div'), values);
    if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      // A yes/no question shown as buttons next to a hidden input.
      if (box && q.options.length && box.querySelector('button, [role=radio]') && pickChoices(box, values)) return true;
      setValue(el, values.join(', '));
      return true;
    }
    return box ? pickChoices(box, values) : false;
  }

  /** Required fields still empty on the page, by label. */
  function emptyRequired() {
    const out = new Set();
    for (const el of document.querySelectorAll('[required], [aria-required=true]')) {
      if (!visible(el) && el.type !== 'file') continue;
      const empty =
        el.type === 'checkbox' || el.type === 'radio'
          ? !document.querySelector(`[name="${CSS.escape(el.name)}"]:checked`)
          : el.type === 'file'
            ? !el.files?.length
            : !(el.value ?? '').trim();
      if (empty) out.add(labelOf(el) || textOf(el.closest('div, li, fieldset')).slice(0, 120) || el.name);
    }
    return [...out].filter(Boolean);
  }

  // ---- submitting --------------------------------------------------------------------------------

  function confirmed() {
    const c = CONFIRMATION[provider];
    const text = textOf(document.body).slice(0, 4000);
    return c.url.test(location.href) || c.text.test(text) ? { url: location.href, text: text.slice(0, 2000) } : null;
  }

  /** A CAPTCHA asking the user to do something (not the invisible kind that just runs). */
  function challengeShown() {
    return [...document.querySelectorAll('iframe')].some((f) => {
      const src = f.src || '';
      const r = f.getBoundingClientRect();
      return /recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com.*(challenge|hcaptcha-challenge)|challenges\.cloudflare\.com/.test(src) && r.width > 100 && r.height > 100 && visible(f);
    });
  }

  /** A CAPTCHA checkbox the form wants ticked before it can be sent ("I'm not a robot"). */
  function captchaCheckboxShown() {
    return [...document.querySelectorAll('iframe')].some((f) => {
      const src = f.src || '';
      const r = f.getBoundingClientRect();
      return /recaptcha\/(api2|enterprise)\/anchor|hcaptcha\.com.*frame=checkbox|challenges\.cloudflare\.com\/.*turnstile/.test(src) && r.width > 50 && r.height > 30 && visible(f);
    });
  }

  function loginShown() {
    return /sign in to (continue|apply)|log in to apply/i.test(textOf(document.body).slice(0, 3000)) && Boolean(document.querySelector('input[type=password]'));
  }

  function errorsShown() {
    const invalid = [...document.querySelectorAll('[aria-invalid=true]')].filter(visible);
    const messages = [...document.querySelectorAll('[class*=error], [role=alert]')].filter((e) => visible(e) && textOf(e).length > 2 && textOf(e).length < 300);
    return { fields: invalid.map((el) => labelOf(el) || el.name).filter(Boolean), messages: messages.map(textOf).slice(0, 5) };
  }

  function submitButton() {
    const buttons = [...document.querySelectorAll('button, input[type=submit]')].filter(visible);
    return (
      buttons.find((b) => /submit application|submit your application|send application|apply now|^submit$|^apply$|^send$/i.test((b.value || textOf(b)).trim())) ??
      (nextButton() ? null : buttons.find((b) => b.type === 'submit')) ??
      null
    );
  }

  async function watchAfterSubmit(report) {
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      await sleep(1000);
      const ok = confirmed();
      if (ok) return report({ outcome: 'submitted', evidence: ok });
      if (challengeShown() || loginShown()) {
        const reason = loginShown() ? 'login_required' : 'captcha';
        await send({ type: 'needs-user', reason });
        // The user finishes it (or submits themselves); watch for the confirmation a while longer. If
        // the page changes, the next page is checked for it too (phase "check").
        const done = await waitFor(confirmed, USER_WAIT_MS, 2000);
        return report(done ? { outcome: 'submitted', evidence: done } : { outcome: reason, message: 'Waited for you to finish the check' });
      }
      if (Date.now() > end - 55_000) {
        const errs = errorsShown();
        if (errs.fields.length || errs.messages.length) {
          return report({
            outcome: errs.fields.length ? 'needs_answers' : 'failed',
            unanswered: errs.fields,
            message: errs.messages.join(' · ').slice(0, 900) || 'The form showed errors',
          });
        }
      }
    }
    // No confirmation and no error: the API marks it unverified and asks the user to check.
    return report({ outcome: 'submitted', evidence: { url: location.href, text: textOf(document.body).slice(0, 2000) } });
  }

  // ---- entry -------------------------------------------------------------------------------------

  function nextButton() {
    const buttons = [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible);
    return buttons.find((b) => /^(next|continue|save and continue|review|review application)$/i.test((b.value || textOf(b)).trim())) ?? null;
  }

  /** Fills every prepared answer whose field is on the current page. */
  async function fillPage(task, resume, coverLetter, done) {
    const byKey = new Map(task.form.map((q) => [q.key, q]));
    const results = [];
    for (const a of task.answers) {
      if (done.has(a.key) || a.value === null || a.value === undefined || (Array.isArray(a.value) && !a.value.length)) continue;
      const q = byKey.get(a.key) ?? { key: a.key, label: a.label, type: 'text', required: false, options: [], kind: 'custom' };
      // Only fields on this step: multi-step forms show the rest later.
      const isFile = q.type === 'file' || a.source === 'file' || a.source === 'cover_letter';
      if (!isFile && !findControl(q)) continue;
      let ok = false;
      try {
        ok = await fillOne(q, a, resume, coverLetter);
      } catch {
        ok = false;
      }
      if (ok) done.add(a.key);
      results.push({ key: a.key, label: a.label, required: q.required, ok });
      await sleep(120 + Math.random() * 180);
    }
    return results;
  }

  async function fill(task, resume, submit, coverLetter = null) {
    // Never fill a page that already says the application went through.
    const already = confirmed();
    if (already) return { outcome: 'submitted', evidence: already };
    // Boards that show the job first: press its Apply / I'm interested button.
    if (!document.querySelector('input[type=file], form input:not([type=hidden])')) {
      const apply = [...document.querySelectorAll('a, button')].find((b) => visible(b) && /^(apply( for this job| now| manually)?|i'?m interested)$/i.test(textOf(b)));
      apply?.click();
    }
    await sleep(1500);
    // Workday and others may ask the user to sign in to the employer's site first.
    if (loginShown()) {
      if (!submit) return { outcome: 'login_required' };
      await send({ type: 'needs-user', reason: 'login_required' });
      const signedIn = await waitFor(() => !loginShown(), USER_WAIT_MS, 2000);
      if (!signedIn) return { outcome: 'login_required', message: 'Waited for you to sign in' };
      await sleep(2000);
    }
    const ready = await waitFor(() => document.querySelector('input[type=file], form input:not([type=hidden]), input[name], textarea'), 25_000);
    if (!ready) return { outcome: 'failed', message: 'The application form didn’t load' };
    await sleep(800);

    const done = new Set();
    const results = [];
    for (let step = 0; step < 8; step++) {
      results.push(...(await fillPage(task, resume, coverLetter, done)));
      await sleep(600);
      const empty = emptyRequired();
      const next = nextButton();
      if (!submit) {
        const unplaced = results.filter((r) => !r.ok && r.required).map((r) => r.label);
        return { outcome: 'dry_run', filled: results.filter((r) => r.ok).length, tried: results.length, unplaced, empty, results };
      }
      if (empty.length) return { outcome: 'needs_answers', unanswered: empty, message: 'The form asks questions that weren’t prepared' };
      if (!next) break;
      const before = location.href + textOf(document.body).slice(0, 300);
      next.click();
      await waitFor(() => location.href + textOf(document.body).slice(0, 300) !== before, 15_000, 400);
      await sleep(1200);
      const errs = errorsShown();
      if (errs.fields.length) return { outcome: 'needs_answers', unanswered: errs.fields, message: errs.messages.join(' · ').slice(0, 900) };
    }
    const unplaced = task.answers
      .filter((a) => a.value !== null && !done.has(a.key) && task.form.find((q) => q.key === a.key)?.required)
      .map((a) => a.label);
    if (unplaced.length) return { outcome: 'failed', message: `Couldn’t fill: ${unplaced.slice(0, 5).join('; ')}` };

    const button = submitButton();
    if (!button) return { outcome: 'failed', message: 'No submit button found' };
    // A visible "I'm not a robot" box: the form is filled, and the user ticks it and sends it themselves.
    if (captchaCheckboxShown()) {
      await send({ type: 'needs-user', reason: 'captcha' });
      const done = await waitFor(confirmed, USER_WAIT_MS, 2000);
      return done ? { outcome: 'submitted', evidence: done } : { outcome: 'captcha', message: 'Waited for you to finish the check' };
    }
    // Wait until the extension has noted it: from now on this application is never sent twice, even
    // if the page navigates away before reporting.
    await send({ type: 'submitting' });
    button.click();
    return new Promise((resolve) => watchAfterSubmit(resolve));
  }

  window.__fridayFill = fill;
  window.__fridayCheck = () => new Promise((resolve) => watchAfterSubmit(resolve));

  globalThis.chrome?.runtime?.onMessage?.addListener((msg, _sender, reply) => {
    if (msg.type !== 'fill') return;
    reply({ ok: true });
    // Once per page: the extension sends this on every load, and some pages report "complete" twice.
    if (window.__fridayStarted) return;
    window.__fridayStarted = true;
    const run = msg.phase === 'check' ? window.__fridayCheck() : fill(msg.task, msg.resume, msg.submit !== false, msg.coverLetter);
    run
      .catch((err) => ({ outcome: 'failed', message: `Filling failed: ${err.message}` }))
      .then((report) => {
        const { outcome, evidence, unanswered, message } = report;
        send({ type: 'result', report: { outcome: outcome === 'dry_run' ? 'failed' : outcome, evidence, unanswered, message } });
      });
  });
})();
