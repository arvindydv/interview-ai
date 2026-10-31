import { CONFIG } from './config.js';

// Friday Jobs Auto Apply, in the user's browser. While the browser is open and Auto Apply is on, it
// takes one prepared application at a time from the API (POST /v1/auto-apply/claim), opens the job
// board's form in a background tab, lets filler.js fill and submit it, and reports what the job board
// said. It never solves or skips a CAPTCHA: when a job board asks for one, the tab is left open for the
// user and they're notified. State lives in chrome.storage, as the service worker can stop any time.

/** Time between applications, so a 100-job day doesn't hammer any one job board. */
const GAP_MS = [45_000, 90_000];
/** Give up on a tab that hasn't reported in this long (the API's lease is 15 minutes). */
const TASK_TIMEOUT_MS = 13 * 60_000;

const store = {
  get: (k) => chrome.storage.local.get(k).then((r) => r[k]),
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};

async function deviceId() {
  let id = await store.get('device');
  if (!id) await store.set('device', (id = `chrome-${crypto.randomUUID()}`));
  return id;
}

// ---- auth ----------------------------------------------------------------------------------------

async function token() {
  const s = await store.get('session');
  if (!s) return null;
  if (s.expiresAt && s.expiresAt * 1000 > Date.now() + 60_000) return s.accessToken;
  const res = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: CONFIG.supabaseKey, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refreshToken }),
  });
  if (!res.ok) {
    // The refresh token was used or revoked (e.g. signed out): wait for the site to send a new session.
    await store.set('session', null);
    return null;
  }
  const d = await res.json();
  await store.set('session', { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: d.expires_at, email: s.email });
  return d.access_token;
}

async function api(path, init = {}) {
  const t = await token();
  if (!t) throw new Error('signed_out');
  const res = await fetch(`${CONFIG.apiUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${t}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res;
}

// ---- the queue -----------------------------------------------------------------------------------

async function setStatus(patch) {
  const status = { ...(await store.get('status')), ...patch, updatedAt: Date.now() };
  await store.set('status', status);
  chrome.action.setBadgeText({ text: status.waitingForUser ? '!' : status.running ? '…' : '' });
  chrome.action.setBadgeBackgroundColor({ color: status.waitingForUser ? '#b45309' : '#059669' });
}

function toBase64(buffer) {
  let s = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function step() {
  // Paused until the user presses Start in the popup (the default after installing).
  if ((await store.get('paused')) !== false || !(await store.get('session'))) return;
  const running = await store.get('running');
  if (running) {
    const tabAlive = await chrome.tabs.get(running.tabId).then(() => true, () => false);
    if (tabAlive && Date.now() - running.startedAt < TASK_TIMEOUT_MS) return;
    // The tab was closed or stalled: report it so the API can hand the application out again.
    await finish(running, { outcome: 'failed', message: tabAlive ? 'Timed out' : 'The tab was closed before it finished' });
  }
  if (Date.now() < ((await store.get('nextAt')) ?? 0)) return;

  let task;
  try {
    ({ task } = await (await api('/v1/auto-apply/claim', { method: 'POST', body: JSON.stringify({ device: await deviceId() }) })).json());
  } catch (err) {
    await setStatus({ error: err.message === 'signed_out' ? 'Sign in on Friday Jobs to start.' : err.message });
    return;
  }
  if (!task) {
    await setStatus({ running: null, error: null, idle: true });
    return;
  }
  const resume = await (await api(task.resumePath)).arrayBuffer();
  const cover = task.coverLetterPath ? await (await api(task.coverLetterPath)).arrayBuffer().catch(() => null) : null;
  const tab = await chrome.tabs.create({ url: task.applyUrl, active: false });
  const job = { taskId: task.id, tabId: tab.id, startedAt: Date.now(), title: task.title, company: task.company };
  await store.set('running', job);
  await store.set(`task:${tab.id}`, {
    task,
    resume: { name: task.resumeFileName, base64: toBase64(resume) },
    coverLetter: cover ? { name: task.coverLetterFileName, base64: toBase64(cover) } : null,
  });
  await setStatus({ running: { title: task.title, company: task.company }, error: null, idle: false });
}

async function finish(job, report) {
  try {
    await api(`/v1/auto-apply/applications/${job.taskId}/report`, { method: 'POST', body: JSON.stringify(report) });
  } catch (err) {
    console.warn('report failed', err);
  }
  await store.set('running', null);
  await chrome.storage.local.remove(`task:${job.tabId}`);
  const [lo, hi] = GAP_MS;
  await store.set('nextAt', Date.now() + lo + Math.random() * (hi - lo));
  const log = ((await store.get('log')) ?? []).slice(-49);
  log.push({ at: Date.now(), title: job.title, company: job.company, outcome: report.outcome });
  await store.set('log', log);
  await setStatus({ running: null, waitingForUser: false });
}

// The form tab finished loading: fill it.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const running = await store.get('running');
  if (!running || running.tabId !== tabId || running.injected) return;
  await store.set('running', { ...running, injected: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['filler.js'] });
  const payload = await store.get(`task:${tabId}`);
  chrome.tabs.sendMessage(tabId, { type: 'fill', ...payload, submit: true });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'session') {
      await store.set('session', msg.session);
      await setStatus({ email: msg.session?.email ?? null, error: null });
      if (msg.session) step();
    } else if (msg.type === 'needs-user') {
      // A CAPTCHA challenge or sign-in: bring the tab forward and tell the user. filler.js keeps
      // watching and reports when they finish (or when it gives up).
      const running = await store.get('running');
      await setStatus({ waitingForUser: true });
      chrome.notifications.create(`user-${running?.taskId}`, {
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'Friday needs you for one application',
        message: `${running?.company ?? 'A job board'} is asking for ${msg.reason === 'login_required' ? 'a sign-in' : 'a quick check'}. Click to finish it.`,
        priority: 2,
      });
    } else if (msg.type === 'result') {
      const running = await store.get('running');
      if (running && sender.tab?.id === running.tabId) {
        await finish(running, msg.report);
        // Leave the tab open when the user still has something to do there.
        if (!['captcha', 'login_required'].includes(msg.report.outcome)) chrome.tabs.remove(running.tabId).catch(() => {});
        step();
      }
    } else if (msg.type === 'pause') {
      await store.set('paused', msg.paused);
      if (!msg.paused) step();
    } else if (msg.type === 'kick') {
      await step();
    }
    reply({ ok: true });
  })();
  return true;
});

chrome.notifications.onClicked.addListener(async () => {
  const running = await store.get('running');
  if (running) {
    const tab = await chrome.tabs.update(running.tabId, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  }
});

chrome.alarms.create('step', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => a.name === 'step' && step());
chrome.runtime.onStartup.addListener(step);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  await store.set('paused', true);
  chrome.tabs.create({ url: `${CONFIG.jobsUrl}/auto-apply` });
});
