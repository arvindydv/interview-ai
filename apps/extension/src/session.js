// Runs on the Friday Jobs site: hands the extension the signed-in user's session, which it uses once to
// get a token of its own (it never refreshes the site's session, so it can't sign the user out there).
// Signing out on the site pauses the extension; signing in as someone else connects it to them.
// It also marks the page (data-friday-extension, data-friday-device) so the Auto Apply page can tell
// the extension is installed and which connected browser is this one.

document.documentElement.dataset.fridayExtension = chrome.runtime.getManifest().version;

function readSession() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!/^sb-.+-auth-token$/.test(key)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(key));
      if (s?.access_token && s?.refresh_token) return { accessToken: s.access_token, email: s.user?.email ?? '' };
    } catch {
      // Not a session.
    }
  }
  return null;
}

let last = '';
function sync(force = false) {
  const session = readSession();
  const key = session ? session.accessToken : 'signed-out';
  if (key === last && !force) return;
  last = key;
  chrome.runtime
    .sendMessage({ type: 'session', session })
    .then(() => chrome.runtime.sendMessage({ type: 'whoami' }))
    .then((r) => {
      // Lets the Auto Apply page mark this browser in its list.
      if (r?.value) document.documentElement.dataset.fridayDevice = r.value;
      else delete document.documentElement.dataset.fridayDevice;
    })
    .catch(() => {});
}

sync();
window.addEventListener('storage', () => sync());
// Also after the extension was disconnected from the Auto Apply page, so it reconnects on its own.
setInterval(() => sync(true), 60_000);
