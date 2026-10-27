'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Cloudflare Turnstile on the sign-in forms, so accounts can't be created by script. Off unless
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; Supabase checks the token when its own captcha setting is on
// (Authentication → Attack Protection, with the same widget's secret key). Turn both on together.

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;
function loadTurnstile() {
  return (loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to load')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(s);
  }));
}

/**
 * The captcha token for the next auth request (undefined when captcha is off). Tokens are single
 * use: call `reset()` after each request that sent one.
 */
export function useCaptcha() {
  const [token, setToken] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    let cancelled = false;
    loadTurnstile().then(
      (t) => {
        if (cancelled || !box.current) return;
        widget.current = t.render(box.current, {
          sitekey: SITE_KEY,
          theme: 'dark',
          // Invisible unless Cloudflare wants the person to click.
          appearance: 'interaction-only',
          callback: (t: string) => setToken(t),
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    if (!SITE_KEY) return;
    setToken(null);
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);

  /** Throws if captcha is on and the check hasn't finished yet. */
  const require = useCallback(() => {
    if (!SITE_KEY) return undefined;
    if (!token) throw new Error('Please wait a moment for the security check, then try again.');
    return token;
  }, [token]);

  const element = SITE_KEY ? <div ref={box} className="mt-4 flex justify-center empty:hidden" /> : null;
  return { enabled: Boolean(SITE_KEY), element, require, reset };
}
