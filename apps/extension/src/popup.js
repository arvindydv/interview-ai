import { CONFIG } from './config.js';

const OUTCOMES = {
  submitted: 'Submitted',
  unverified: 'Sent, confirm it',
  captcha: 'Needs a check',
  login_required: 'Needs sign-in',
  needs_answers: 'Needs answers',
  failed: 'Failed',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const send = (msg) => chrome.runtime.sendMessage(msg);

/** Whether Auto Apply is on for the account, and how many applications are ready to send. */
async function account(device) {
  try {
    const res = await fetch(`${CONFIG.apiUrl}/v1/auto-apply/device`, { headers: { authorization: `Bearer ${device.token}` } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

let accountInfo = null;

async function render() {
  const { device, optedOut, paused = true, pausedBy, status = {}, log = [] } = await chrome.storage.local.get([
    'device', 'optedOut', 'paused', 'pausedBy', 'status', 'log',
  ]);
  const app = document.getElementById('app');
  if (!device) {
    app.innerHTML = optedOut
      ? `<p>This browser is disconnected from Friday, so it doesn’t send applications.</p>
         ${status.error ? `<div class="err">${esc(status.error)}</div>` : ''}
         <button id="connect" class="primary">Connect this browser</button>`
      : `<p>Sign in on Friday Jobs and this extension connects on its own.</p>
         ${status.error ? `<div class="err">${esc(status.error)}</div>` : ''}
         <a class="btn" href="${CONFIG.jobsUrl}/auto-apply" target="_blank">Open Friday Jobs</a>`;
    const connect = document.getElementById('connect');
    if (connect) {
      connect.onclick = async () => {
        await send({ type: 'connect' });
        chrome.tabs.create({ url: `${CONFIG.jobsUrl}/auto-apply` });
      };
    }
    return;
  }
  const state = paused ? (pausedBy === 'signout' ? 'Paused (signed out of Friday Jobs)' : 'Paused') : 'Running';
  const now = paused ? '—' : status.running ? `${esc(status.running.title)} at ${esc(status.running.company)}` : status.idle ? 'Nothing ready to send' : 'Waiting';
  app.innerHTML = `
    <div class="row"><span class="muted">Signed in</span><span>${esc(device.email)}</span></div>
    <div class="row"><span class="muted">State</span><span>${state}</span></div>
    <div class="row"><span class="muted">Now</span><span>${now}</span></div>
    ${accountInfo ? `<div class="row"><span class="muted">Ready to send</span><span>${accountInfo.prepared}</span></div>` : ''}
    ${accountInfo && !accountInfo.enabled ? `<div class="warn">Auto Apply is off for your account. Turn it on in Friday Jobs to send applications.</div>` : ''}
    ${status.waitingForUser ? '<div class="warn">A job board is asking you for a check. Click the notification or the open tab to finish it.</div>' : ''}
    ${status.error ? `<div class="err">${esc(status.error)}</div>` : ''}
    <button id="toggle" class="${paused ? 'primary' : ''}">${paused ? 'Start sending applications' : 'Pause'}</button>
    <a class="btn" href="${CONFIG.jobsUrl}/auto-apply" target="_blank">Review applications</a>
    ${log.length ? `<p class="muted" style="margin-top:12px">Recent</p><ol>${log.slice(-8).reverse().map((l) => `<li>${esc(l.company)}: ${OUTCOMES[l.outcome] ?? esc(l.outcome)}</li>`).join('')}</ol>` : ''}
    <p class="muted" style="margin-top:12px;font-size:12px">Applications are sent from this browser while it’s open. Friday never gets past a CAPTCHA for you; it waits for you instead.</p>
    <button id="disconnect" class="link">Disconnect this browser</button>`;
  document.getElementById('toggle').onclick = async () => {
    await send({ type: 'pause', paused: !paused });
    render();
  };
  document.getElementById('disconnect').onclick = async () => {
    await send({ type: 'disconnect' });
    render();
  };
}

render();
chrome.storage.onChanged.addListener(render);
chrome.storage.local.get('device').then(async ({ device }) => {
  if (!device) return;
  accountInfo = await account(device);
  render();
});
