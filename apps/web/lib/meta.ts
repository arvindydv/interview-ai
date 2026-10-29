import { purchaseEventId, type CheckoutOrder, type CreateOrderInput } from '@parakeet/shared';

// Meta Pixel: marketing consent, loading the pixel, and the conversion events we send.
//
// Nothing loads or is sent until the visitor accepts marketing cookies (ConsentBanner). Pages with
// personal content (interviews, history, practice, resume, settings) and sign-in callbacks, whose
// URLs carry one-time codes, are never reported, and the pixel's automatic collection (button
// clicks, page metadata) is off, so only the events below and page views leave the browser.
// Purchases are also reported by the API (lib/metaCapi.ts) under the same event id; Meta keeps one.

export const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export type Consent = 'granted' | 'denied';
type MetaEvent = 'PageView' | 'CompleteRegistration' | 'InitiateCheckout' | 'Purchase';

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

const CONSENT_COOKIE = 'fa_consent';
const CONSENT_DAYS = 180;
const CONSENT_EVENT = 'fa-consent-change';
/** Path prefixes never reported to Meta. */
const PRIVATE_PATHS = ['/auth', '/desktop-auth', '/interviews', '/history', '/practice', '/resume', '/settings'];
/** A sign-up counts as just completed if the email was confirmed this recently. */
const REGISTRATION_WINDOW_MS = 10 * 60_000;
const PENDING_REGISTRATION_KEY = 'fa_meta_pending_registration';
const registeredKey = (userId: string) => `fa_meta_registered.${userId}`;

export function readCookie(name: string, cookies = document.cookie): string | undefined {
  for (const part of cookies.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** The visitor's choice, or null if they haven't made one. */
export function readConsent(): Consent | null {
  if (typeof document === 'undefined') return null;
  const v = readCookie(CONSENT_COOKIE);
  return v === 'granted' || v === 'denied' ? v : null;
}

/** Global Privacy Control: the browser already says no, so we don't ask. */
export const browserOptsOut = () =>
  typeof navigator !== 'undefined' && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

/** Consent in effect: an explicit choice, else denied under Global Privacy Control, else not yet asked. */
export const effectiveConsent = (): Consent | null => readConsent() ?? (browserOptsOut() ? 'denied' : null);

export function saveConsent(consent: Consent | null) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    consent === null
      ? `${CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`
      : `${CONSENT_COOKIE}=${consent}; Max-Age=${CONSENT_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
  if (consent !== 'granted') window.fbq?.('consent', 'revoke');
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

export function onConsentChange(cb: () => void) {
  window.addEventListener(CONSENT_EVENT, cb);
  return () => window.removeEventListener(CONSENT_EVENT, cb);
}

export const isTrackablePath = (pathname: string) =>
  !PRIVATE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const canTrack = () =>
  Boolean(PIXEL_ID) && typeof window !== 'undefined' && effectiveConsent() === 'granted' && isTrackablePath(location.pathname);

/** Installs the pixel (Meta's standard snippet, without the inline script) once consent is given. */
export function loadPixel(pixelId: string) {
  if (window.fbq) {
    window.fbq('consent', 'grant');
    return;
  }
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  // Page views are sent by MetaPixel on route changes (only for trackable pages), not by the pixel
  // watching history.pushState.
  fbq.disablePushState = true;
  window.fbq = window._fbq = fbq;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);
  fbq('consent', 'grant');
  // No automatic events or page-metadata scraping: only what we send explicitly.
  fbq('set', 'autoConfig', false, pixelId);
  fbq('init', pixelId);
}

/** Sends one event if allowed: consent given, pixel loaded, and not a private page. */
export function track(event: MetaEvent, params?: Record<string, unknown>, eventId?: string): boolean {
  if (!canTrack() || !window.fbq) return false;
  if (eventId) window.fbq('track', event, params ?? {}, { eventID: eventId });
  else if (params) window.fbq('track', event, params);
  else window.fbq('track', event);
  return true;
}

const randomId = () => crypto.randomUUID();

const checkoutParams = (order: Pick<CheckoutOrder, 'amount' | 'currency' | 'productId'>) => ({
  value: order.amount / 100,
  currency: order.currency,
  content_ids: [order.productId],
  content_type: 'product',
  num_items: 1,
});

/** Razorpay Checkout has opened for this order. Each opening is its own attempt. */
export const trackInitiateCheckout = (order: CheckoutOrder) =>
  track('InitiateCheckout', checkoutParams(order), `checkout.${randomId()}`);

/**
 * The API confirmed the payment. The API reports the same purchase server-side under the same
 * event id, so Meta counts it once whichever arrives.
 */
export const trackPurchase = (order: CheckoutOrder) => track('Purchase', checkoutParams(order), purchaseEventId(order.orderId));

/**
 * What the API needs to report the purchase to Meta, or nothing without consent. `_fbp`/`_fbc` are
 * the pixel's own first-party cookies.
 */
export function checkoutTracking(): CreateOrderInput['tracking'] {
  if (!PIXEL_ID || effectiveConsent() !== 'granted') return undefined;
  const fbp = readCookie('_fbp');
  const fbc = readCookie('_fbc');
  return { consent: true, ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}) };
}

function storage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

/**
 * Call after a sign-in succeeds. If it confirmed the email just now (a new account), reports
 * CompleteRegistration once per account and browser. Callback pages aren't reported, so there it is
 * held until the next trackable page (flushPendingRegistration).
 */
export function noteSignIn(user: { id: string; email_confirmed_at?: string | null }, now = Date.now()) {
  if (!user.email_confirmed_at) return;
  const confirmedAgo = now - Date.parse(user.email_confirmed_at);
  if (!(confirmedAgo >= -60_000 && confirmedAgo <= REGISTRATION_WINDOW_MS)) return;
  if (storage('localStorage')?.getItem(registeredKey(user.id))) return;
  storage('sessionStorage')?.setItem(PENDING_REGISTRATION_KEY, user.id);
  flushPendingRegistration();
}

export function flushPendingRegistration() {
  const session = storage('sessionStorage');
  const userId = session?.getItem(PENDING_REGISTRATION_KEY);
  if (!userId) return;
  if (effectiveConsent() === 'denied') return session!.removeItem(PENDING_REGISTRATION_KEY);
  if (!track('CompleteRegistration', { status: true }, `registration.${randomId()}`)) return;
  session!.removeItem(PENDING_REGISTRATION_KEY);
  storage('localStorage')?.setItem(registeredKey(userId), '1');
}
