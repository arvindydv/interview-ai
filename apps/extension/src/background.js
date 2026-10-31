import { CONFIG } from './config.js';

// Friday Jobs Auto Apply, in the user's browser. While the browser is open and Auto Apply is on, it
// takes one prepared application at a time from the API (POST /v1/auto-apply/claim), opens the job
// board's form in a background tab, lets filler.js fill and submit it, and reports what the job board
// said. It never solves or skips a CAPTCHA: when a job board asks for one (or for a sign-in), the
// application is reported as waiting for the user, the tab is left open for them and the queue moves
// on; if they finish it there, the confirmation is still picked up.
//
// State lives in chrome.storage, as the service worker can stop at any time, and every handler runs
// one at a time (serial) so two alarms or messages never claim two applications at once.
//
//   device   { token, id, userId, email }   the extension's own API token (never the site's session)
//   optedOut true after the user disconnected this browser (here or on the site), until they reconnect
//   paused   true until the user presses Start; pausedBy 'signout' when the site signed out
//   running  tab id holding the queue's one slot, or null
//   tabs     { [tabId]: { taskId, title, company, phase: 'fill' | 'submitted', handed, startedAt } }
//   task:<tabId>  the claimed task with its resume and cover letter, for (re)filling that tab
//   outbox   reports not yet delivered to the API, retried until it answers
//   revoke   tokens of disconnected devices the API hasn't confirmed revoking yet, retried likewise

/** Time between applications, so a 100-job day doesn't hammer any one job board. */
const GAP_MS = CONFIG.gapMs ?? [45_000, 90_000];
/** Give up on a tab that hasn't reported in this long (the API's lease is 15 minutes). */
const TASK_TIMEOUT_MS = 13 * 60_000;
/** Stop watching a tab left with the user after this long; the application waits for them on the site. */
const HANDED_TIMEOUT_MS = 60 * 60_000;

const store = {
  get: (k) => chrome.storage.local.get(k).then((r) => r[k]),
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};

let chain = Promise.resolve();
/** Runs fn after every handler queued before it has finished. */
function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch((err) => console.warn('[friday]', err));
  return run;
}

// ---- auth ----------------------------------------------------------------------------------------

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, init = {}) {
  const device = await store.get('device');
  if (!device) throw new ApiError('signed_out', 401);
  let res;
  try {
    res = await fetch(`${CONFIG.apiUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${device.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
  } catch (err) {
    throw new ApiError(`Can’t reach Friday (${err.message})`, 0);
  }
  if (res.status === 401) {
    // Disconnected from the Auto Apply page: stays disconnected until the user connects it again.
    await chrome.storage.local.set({ device: null, optedOut: true });
    await setStatus({ error: 'This browser was disconnected from Friday. Connect it again to keep applying.' });
    throw new ApiError('signed_out', 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `HTTP ${res.status}`, res.status);
  }
  return res;
}

/**
 * Revokes a device's token on the API. Until the API confirms it, the token is kept (only) for this,
 * so a network blip never leaves a forgotten token working.
 */
async function revoke(token) {
  const pending = [...new Set([...((await store.get('revoke')) ?? []), ...(token ? [token] : [])])];
  const left = [];
  for (const t of pending) {
    const res = await fetch(`${CONFIG.apiUrl}/v1/auto-apply/devices/self`, { method: 'DELETE', headers: { authorization: `Bearer ${t}` } }).catch(() => null);
    // 401/404: already gone.
    if (!res || res.status >= 500) left.push(t);
  }
  await store.set('revoke', left);
}

function jwtSub(token) {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { sub: p.sub, exp: p.exp };
  } catch {
    return {};
  }
}

const browserName = () => {
  const p = navigator.userAgentData?.platform || (/Mac/.test(navigator.userAgent) ? 'macOS' : /Win/.test(navigator.userAgent) ? 'Windows' : 'Linux');
  return `Chrome on ${p}`;
};

/**
 * The Friday Jobs site's session (from session.js). The extension uses it once, to get a token of its
 * own: sharing the site's refresh token would rotate it under the site and sign the user out there.
 */
async function onSession(session) {
  const device = await store.get('device');
  if (!session) {
    // Signed out on the site: stop taking new applications, but deliver what's in flight.
    if (device && (await store.get('paused')) === false) {
      await store.set('paused', true);
      await store.set('pausedBy', 'signout');
    }
    await setStatus({});
    return;
  }
  const { sub, exp } = jwtSub(session.accessToken);
  if (!sub || (await store.get('optedOut'))) return;
  if (device?.userId === sub) {
    if ((await store.get('pausedBy')) === 'signout') {
      await store.set('paused', false);
      await store.set('pausedBy', null);
    }
    return;
  }
  // Another account: switch once the current applications are settled (session.js syncs again).
  if (device && (Object.keys((await store.get('tabs')) ?? {}).length || ((await store.get('outbox')) ?? []).length)) return;
  // An expired token: the site refreshes it and session.js sends the new one.
  if (exp && exp * 1000 < Date.now() + 30_000) return;
  if (device) await revoke(device.token);
  const res = await fetch(`${CONFIG.apiUrl}/v1/auto-apply/devices`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: browserName() }),
  }).catch(() => null);
  if (!res?.ok) {
    const body = (await res?.json().catch(() => ({}))) ?? {};
    await setStatus({ error: body.message ?? 'Couldn’t connect to Friday. Reload Friday Jobs to try again.' });
    return;
  }
  const d = await res.json();
  await store.set('device', { token: d.token, id: d.device.id, userId: d.userId, email: d.email });
  // Another account's applications aren't sent until that person presses Start.
  if (device) await chrome.storage.local.set({ log: [], paused: true, pausedBy: null });
  await setStatus({ email: d.email, error: null });
}

// ---- status --------------------------------------------------------------------------------------

async function setStatus(patch) {
  const status = { ...(await store.get('status')), ...patch, updatedAt: Date.now() };
  const tabs = (await store.get('tabs')) ?? {};
  status.waitingForUser = Object.values(tabs).some((t) => t.handed);
  await store.set('status', status);
  chrome.action.setBadgeText({ text: status.waitingForUser ? '!' : status.running ? '…' : '' });
  chrome.action.setBadgeBackgroundColor({ color: status.waitingForUser ? '#b45309' : '#059669' });
}

async function addLog(t, outcome) {
  const log = ((await store.get('log')) ?? []).slice(-49);
  log.push({ at: Date.now(), title: t.title, company: t.company, outcome });
  await store.set('log', log);
}

// ---- reports -------------------------------------------------------------------------------------

/** Queues a report and tries to deliver it; undelivered ones are retried on every step. */
async function report(taskId, body) {
  const outbox = (await store.get('outbox')) ?? [];
  outbox.push({ taskId, body, at: Date.now() });
  await store.set('outbox', outbox);
  await flush();
}

/** Delivers queued reports in order. True when nothing is left. */
async function flush() {
  const outbox = (await store.get('outbox')) ?? [];
  while (outbox.length) {
    const { taskId, body } = outbox[0];
    try {
      await api(`/v1/auto-apply/applications/${taskId}/report`, { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      // Network or server trouble (or signed out): keep it, so a sent application is never sent again.
      if (err.status === 0 || err.status === 401 || err.status >= 500) break;
      // 4xx: the API has moved on (e.g. the user removed it); nothing to deliver.
      console.warn('[friday] report dropped', taskId, err.message);
    }
    outbox.shift();
  }
  await store.set('outbox', outbox);
  return outbox.length === 0;
}

// ---- tabs ----------------------------------------------------------------------------------------

async function getTabs() {
  return (await store.get('tabs')) ?? {};
}

async function saveTab(tabId, t) {
  const tabs = await getTabs();
  if (t) tabs[tabId] = t;
  else delete tabs[tabId];
  await store.set('tabs', tabs);
}

/** Frees the queue's slot after an application, with a pause before the next one. */
async function release(tabId) {
  if ((await store.get('running')) === tabId) {
    await store.set('running', null);
    const [lo, hi] = GAP_MS;
    await store.set('nextAt', Date.now() + lo + Math.random() * (hi - lo));
  }
}

/** The tab's application is over: forget it (and its files). */
async function drop(tabId) {
  await saveTab(tabId, null);
  await chrome.storage.local.remove(`task:${tabId}`);
  await release(tabId);
  await setStatus({ running: null });
}

/**
 * The tab stopped without the filler reporting (closed, timed out). Once the submit button was
 * pressed it is never tried again: the API asks the user to confirm instead of risking a duplicate.
 */
async function abandon(tabId, t, why, url = '') {
  if (!t.handed) {
    await report(
      t.taskId,
      t.phase === 'submitted'
        ? { outcome: 'submitted', evidence: { url, text: '' }, message: why }
        : { outcome: 'failed', message: why },
    );
    await addLog(t, t.phase === 'submitted' ? 'unverified' : 'failed');
  }
  await drop(tabId);
}

async function inject(tabId) {
  const t = (await getTabs())[tabId];
  if (!t) return;
  const payload = await store.get(`task:${tabId}`);
  if (!payload) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['filler.js'] });
    // A page that was already being filled ignores this (filler.js runs once per page).
    await chrome.tabs.sendMessage(tabId, { type: 'fill', ...payload, phase: t.phase === 'submitted' ? 'check' : 'fill', submit: true });
  } catch (err) {
    // Not a job board page (an error page, or the user went elsewhere): wait for the next load.
    console.warn('[friday] could not fill tab', tabId, err.message);
  }
}

// ---- the queue -----------------------------------------------------------------------------------

function toBase64(buffer) {
  let s = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function step() {
  if ((await store.get('revoke'))?.length) await revoke();
  if (!(await store.get('device'))) return;
  // Reports first: an application isn't claimed while the last one's outcome can't be delivered.
  const delivered = await flush().catch(() => false);

  const tabs = await getTabs();
  for (const [id, t] of Object.entries(tabs)) {
    const tabId = Number(id);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) await abandon(tabId, t, 'The tab was closed before it finished');
    else if (!t.handed && Date.now() - t.startedAt > TASK_TIMEOUT_MS) {
      await abandon(tabId, t, 'Timed out', tab.url);
      chrome.tabs.remove(tabId).catch(() => {});
    } else if (t.handed && Date.now() - t.handedAt > HANDED_TIMEOUT_MS) await drop(tabId);
  }

  // Paused until the user presses Start in the popup (the default after installing).
  if ((await store.get('paused')) !== false || !delivered) return;
  if (await store.get('running')) return;
  if (Date.now() < ((await store.get('nextAt')) ?? 0)) return;

  let task;
  try {
    ({ task } = await (await api('/v1/auto-apply/claim', { method: 'POST', body: JSON.stringify({ device: 'extension' }) })).json());
  } catch (err) {
    await setStatus({ error: err.message === 'signed_out' ? 'Open Friday Jobs and sign in to connect.' : err.message });
    return;
  }
  if (!task) {
    await setStatus({ running: null, error: null, idle: true });
    return;
  }
  let resume, cover;
  try {
    resume = await (await api(task.resumePath)).arrayBuffer();
    cover = task.coverLetterPath ? await (await api(task.coverLetterPath)).arrayBuffer().catch(() => null) : null;
  } catch (err) {
    await report(task.id, { outcome: 'failed', message: `Couldn’t download the resume: ${err.message}` });
    return;
  }
  // The same application still open from an earlier try (e.g. left at a CAPTCHA): replace that tab.
  for (const [id, t] of Object.entries(await getTabs())) {
    if (t.taskId === task.id) {
      await drop(Number(id));
      chrome.tabs.remove(Number(id)).catch(() => {});
    }
  }
  const tab = await chrome.tabs.create({ url: task.applyUrl, active: false });
  await store.set(`task:${tab.id}`, {
    task,
    resume: { name: task.resumeFileName, base64: toBase64(resume) },
    coverLetter: cover ? { name: task.coverLetterFileName, base64: toBase64(cover) } : null,
  });
  await saveTab(tab.id, { taskId: task.id, title: task.title, company: task.company, phase: 'fill', handed: false, startedAt: Date.now() });
  await store.set('running', tab.id);
  await setStatus({ running: { title: task.title, company: task.company }, error: null, idle: false });
  // Already loaded (fast pages finish before the listener sees them).
  if ((await chrome.tabs.get(tab.id).catch(() => null))?.status === 'complete') await inject(tab.id);
}

// ---- events --------------------------------------------------------------------------------------

// Every page load in an application's tab: fill it, or after submitting, look for the confirmation.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  serial(() => inject(tabId));
});

chrome.tabs.onRemoved.addListener((tabId) =>
  serial(async () => {
    const t = (await getTabs())[tabId];
    if (!t) return;
    await abandon(tabId, t, 'The tab was closed before it finished');
    await step();
  }),
);

async function onFillerMessage(msg, tabId) {
  const t = (await getTabs())[tabId];
  if (!t) return;
  if (msg.type === 'submitting') {
    // From here on this application is never sent again automatically.
    await saveTab(tabId, { ...t, phase: 'submitted' });
  } else if (msg.type === 'needs-user') {
    if (t.handed) return;
    // A CAPTCHA challenge or sign-in: the application waits for the user and the queue moves on. The
    // tab stays open and filler.js keeps watching, so finishing it there still counts.
    // After a CAPTCHA only the user sends it, so later pages in the tab are only checked, never filled.
    const phase = msg.reason === 'captcha' ? 'submitted' : t.phase;
    await saveTab(tabId, { ...t, phase, handed: true, handedAt: Date.now(), reason: msg.reason });
    await report(t.taskId, { outcome: msg.reason, message: msg.message });
    await addLog(t, msg.reason);
    await release(tabId);
    await setStatus({ running: null });
    chrome.notifications.create(`user-${tabId}`, {
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Friday needs you for one application',
      message: `${t.company} is asking for ${msg.reason === 'login_required' ? 'a sign-in' : 'a quick check'}. Click to finish it.`,
      priority: 2,
    });
    await step();
  } else if (msg.type === 'result') {
    const { outcome } = msg.report;
    // Left with the user, who didn't finish it while we watched: it already waits for them on the site.
    // afterSubmit: a failure after pressing submit is never retried; the API asks the user instead.
    if (!(t.handed && outcome === t.reason)) await report(t.taskId, { ...msg.report, afterSubmit: t.phase === 'submitted' });
    if (!(t.handed && outcome === t.reason)) await addLog(t, outcome);
    await drop(tabId);
    // Leave the tab open when the user is (or may be) looking at it.
    if (!t.handed && !['captcha', 'login_required'].includes(outcome)) chrome.tabs.remove(tabId).catch(() => {});
    await step();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  serial(async () => {
    if (msg.type === 'session') {
      await onSession(msg.session);
      await step();
    } else if (msg.type === 'pause') {
      await store.set('paused', msg.paused);
      await store.set('pausedBy', null);
      await setStatus({});
      if (!msg.paused) await step();
    } else if (msg.type === 'disconnect') {
      const device = await store.get('device');
      await chrome.storage.local.set({ device: null, optedOut: true, paused: true, pausedBy: null, log: [] });
      if (device) await revoke(device.token);
      await setStatus({ running: null, error: null, email: null });
    } else if (msg.type === 'connect') {
      // The popup's Connect: the next session from the site connects this browser.
      await store.set('optedOut', false);
      await setStatus({ error: null });
    } else if (msg.type === 'whoami') {
      return (await store.get('device'))?.id ?? null;
    } else if (msg.type === 'kick') {
      await step();
    } else if (sender.tab?.id !== undefined) {
      await onFillerMessage(msg, sender.tab.id);
    }
  }).then(
    (value) => reply({ ok: true, value }),
    () => reply({ ok: false }),
  );
  return true;
});

chrome.notifications.onClicked.addListener(async (id) => {
  const tabId = Number(id.replace(/^user-/, ''));
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab) chrome.windows.update(tab.windowId, { focused: true });
});

chrome.alarms.create('step', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => a.name === 'step' && serial(step));
chrome.runtime.onStartup.addListener(() => serial(step));
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  await store.set('paused', true);
  chrome.tabs.create({ url: `${CONFIG.jobsUrl}/auto-apply` });
});
