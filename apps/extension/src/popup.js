import { CONFIG } from './config.js';

const OUTCOMES = { submitted: 'Submitted', captcha: 'Needs a check', login_required: 'Needs sign-in', needs_answers: 'Needs answers', failed: 'Failed' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function render() {
  const { session, paused = true, status = {}, log = [] } = await chrome.storage.local.get(['session', 'paused', 'status', 'log']);
  const app = document.getElementById('app');
  if (!session) {
    app.innerHTML = `<p>Sign in on Friday Jobs and this extension picks it up.</p>
      <a class="btn" href="${CONFIG.jobsUrl}/auto-apply" target="_blank">Open Friday Jobs</a>`;
    return;
  }
  const running = status.running ? `${esc(status.running.title)} at ${esc(status.running.company)}` : status.idle ? 'Nothing ready to send' : 'Waiting';
  app.innerHTML = `
    <div class="row"><span class="muted">Signed in</span><span>${esc(session.email)}</span></div>
    <div class="row"><span class="muted">State</span><span>${paused ? 'Paused' : 'Running'}</span></div>
    <div class="row"><span class="muted">Now</span><span>${paused ? '—' : running}</span></div>
    ${status.waitingForUser ? '<div class="warn">A job board is asking you for a check. Click the notification or the open tab to finish it.</div>' : ''}
    ${status.error ? `<div class="err">${esc(status.error)}</div>` : ''}
    <button id="toggle" class="${paused ? 'primary' : ''}">${paused ? 'Start sending applications' : 'Pause'}</button>
    <a class="btn" href="${CONFIG.jobsUrl}/auto-apply" target="_blank">Review applications</a>
    ${log.length ? `<p class="muted" style="margin-top:12px">Recent</p><ol>${log.slice(-8).reverse().map((l) => `<li>${esc(l.company)}: ${OUTCOMES[l.outcome] ?? esc(l.outcome)}</li>`).join('')}</ol>` : ''}
    <p class="muted" style="margin-top:12px;font-size:12px">Applications are sent from this browser while it’s open. Friday never gets past a CAPTCHA for you; it waits for you instead.</p>`;
  document.getElementById('toggle').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'pause', paused: !paused });
    render();
  };
}

render();
chrome.storage.onChanged.addListener(render);
