// Runs on the Friday Jobs site: hands the extension the signed-in user's Supabase session, so the
// extension needs no separate sign-in. Only this site's own session is read; signing out there signs
// the extension out too.

function readSession() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!/^sb-.+-auth-token$/.test(key)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(key));
      if (s?.access_token && s?.refresh_token) {
        return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at, email: s.user?.email ?? '' };
      }
    } catch {
      // Not a session.
    }
  }
  return null;
}

let last = '';
function sync() {
  const session = readSession();
  const key = session ? session.refreshToken : 'signed-out';
  if (key === last) return;
  last = key;
  chrome.runtime.sendMessage({ type: 'session', session }).catch(() => {});
}

sync();
window.addEventListener('storage', sync);
setInterval(sync, 30_000);
