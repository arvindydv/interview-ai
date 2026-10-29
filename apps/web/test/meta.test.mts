import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckoutOrder } from '@parakeet/shared';

// A minimal browser for lib/meta.ts: a cookie jar, location, storage, events and <script> tags.
const jar = new Map<string, string>();
const scripts: { src: string }[] = [];
class MemoryStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, String(v));
  removeItem = (k: string) => void this.m.delete(k);
  clear = () => this.m.clear();
}
const events = new EventTarget();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { protocol: 'https:', pathname: '/' };
g.localStorage = new MemoryStorage();
g.sessionStorage = new MemoryStorage();
g.addEventListener = events.addEventListener.bind(events);
g.removeEventListener = events.removeEventListener.bind(events);
g.dispatchEvent = events.dispatchEvent.bind(events);
g.document = {
  get cookie() {
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  },
  set cookie(raw: string) {
    const [pair, ...attrs] = raw.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0')) jar.delete(name);
    else jar.set(name, pair.slice(i + 1).trim());
  },
  createElement: () => ({}),
  head: { appendChild: (s: { src: string }) => scripts.push(s) },
};

const PIXEL = '1583041433148120';
process.env.NEXT_PUBLIC_META_PIXEL_ID = PIXEL;
const meta = await import('../lib/meta.js');
const { purchaseEventId } = await import('@parakeet/shared');

const order: CheckoutOrder = {
  orderId: 'order_Abc123',
  keyId: 'rzp_test_x',
  amount: 2999_00,
  currency: 'INR',
  productId: 'monthly',
  description: 'Monthly plan',
  email: 'priya@example.com',
};

const win = globalThis as unknown as Window;
/** Calls made to fbq so far (the pixel library never loads here, so they stay queued). */
const calls = () => win.fbq?.queue ?? [];
const tracked = (event: string) => calls().filter((c) => c[0] === 'track' && c[1] === event);
const setGpc = (on: boolean) => Object.defineProperty(navigator, 'globalPrivacyControl', { value: on, configurable: true });

function reset() {
  jar.clear();
  scripts.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  delete win.fbq;
  delete win._fbq;
  (location as { pathname: string }).pathname = '/';
  setGpc(false);
}

function grantAndLoad() {
  meta.saveConsent('granted');
  meta.loadPixel(PIXEL);
}

beforeEach(reset);

describe('consent', () => {
  test('nothing is decided until the visitor chooses', () => {
    assert.equal(meta.readConsent(), null);
    assert.equal(meta.effectiveConsent(), null);
  });

  test('the choice is kept in a cookie and announced', () => {
    let changes = 0;
    const off = meta.onConsentChange(() => changes++);
    meta.saveConsent('granted');
    assert.equal(meta.readConsent(), 'granted');
    meta.saveConsent(null);
    assert.equal(meta.readConsent(), null);
    off();
    assert.equal(changes, 2);
  });

  test('Global Privacy Control counts as declining, unless the visitor accepted explicitly', () => {
    setGpc(true);
    assert.equal(meta.effectiveConsent(), 'denied');
    meta.saveConsent('granted');
    assert.equal(meta.effectiveConsent(), 'granted');
  });

  test('withdrawing consent tells a loaded pixel to stop', () => {
    grantAndLoad();
    meta.saveConsent('denied');
    assert.deepEqual(calls().at(-1), ['consent', 'revoke']);
    assert.equal(meta.track('PageView'), false);
  });
});

describe('loading the pixel', () => {
  test('loads fbevents.js with automatic collection and history tracking off', () => {
    grantAndLoad();
    assert.deepEqual(scripts.map((s) => s.src), ['https://connect.facebook.net/en_US/fbevents.js']);
    assert.equal(win.fbq!.disablePushState, true);
    assert.deepEqual(calls(), [
      ['consent', 'grant'],
      ['set', 'autoConfig', false, PIXEL],
      ['init', PIXEL],
    ]);
  });

  test('loading twice does not add a second script', () => {
    grantAndLoad();
    meta.loadPixel(PIXEL);
    assert.equal(scripts.length, 1);
  });
});

describe('track', () => {
  test('sends nothing without consent', () => {
    meta.loadPixel(PIXEL);
    assert.equal(meta.track('PageView'), false);
    meta.saveConsent('denied');
    assert.equal(meta.track('PageView'), false);
    assert.equal(tracked('PageView').length, 0);
  });

  test('sends a PageView with consent', () => {
    grantAndLoad();
    assert.equal(meta.track('PageView'), true);
    assert.deepEqual(tracked('PageView'), [['track', 'PageView']]);
  });

  test('never reports private pages or sign-in callbacks', () => {
    grantAndLoad();
    for (const path of ['/auth/callback', '/desktop-auth', '/interviews/42', '/history', '/practice/x', '/resume', '/settings']) {
      (location as { pathname: string }).pathname = path;
      assert.equal(meta.track('PageView'), false, path);
    }
    for (const path of ['/', '/pricing', '/signup', '/billing', '/dashboard', '/authors']) {
      assert.equal(meta.isTrackablePath(path), true, path);
    }
  });
});

describe('checkout events', () => {
  test('InitiateCheckout carries the order value in rupees and a fresh id per opening', () => {
    grantAndLoad();
    meta.trackInitiateCheckout(order);
    meta.trackInitiateCheckout(order);
    const [a, b] = tracked('InitiateCheckout');
    assert.deepEqual(a[2], { value: 2999, currency: 'INR', content_ids: ['monthly'], content_type: 'product', num_items: 1 });
    const ids = [a, b].map((c) => (c[3] as { eventID: string }).eventID);
    assert.notEqual(ids[0], ids[1]);
    assert.ok(ids.every((id) => id.startsWith('checkout.')));
  });

  test('Purchase uses the same event id as the server-side event, for deduplication', () => {
    grantAndLoad();
    meta.trackPurchase(order);
    const [p] = tracked('Purchase');
    assert.deepEqual(p[2], { value: 2999, currency: 'INR', content_ids: ['monthly'], content_type: 'product', num_items: 1 });
    assert.deepEqual(p[3], { eventID: purchaseEventId(order.orderId) });
    assert.equal(purchaseEventId(order.orderId), 'purchase.order_Abc123');
  });

  test('no personal data goes into any event', () => {
    grantAndLoad();
    meta.trackInitiateCheckout(order);
    meta.trackPurchase(order);
    const sent = JSON.stringify(calls());
    for (const secret of [order.email, order.keyId]) assert.ok(!sent.includes(secret), secret);
  });

  test('the API gets the Meta cookies only with consent', () => {
    jar.set('_fbp', 'fb.1.1761730000000.1234567890');
    jar.set('_fbc', 'fb.1.1761730000000.IwAR0abc');
    assert.equal(meta.checkoutTracking(), undefined);
    meta.saveConsent('denied');
    assert.equal(meta.checkoutTracking(), undefined);
    meta.saveConsent('granted');
    assert.deepEqual(meta.checkoutTracking(), {
      consent: true, fbp: 'fb.1.1761730000000.1234567890', fbc: 'fb.1.1761730000000.IwAR0abc',
    });
    jar.delete('_fbc');
    assert.deepEqual(meta.checkoutTracking(), { consent: true, fbp: 'fb.1.1761730000000.1234567890' });
  });
});

describe('CompleteRegistration', () => {
  const now = Date.parse('2026-10-29T10:00:00Z');
  const justConfirmed = { id: 'user-1', email_confirmed_at: '2026-10-29T09:59:30Z' };

  test('is sent when the email was just confirmed, once per account', () => {
    grantAndLoad();
    meta.noteSignIn(justConfirmed, now);
    meta.noteSignIn(justConfirmed, now);
    const sent = tracked('CompleteRegistration');
    assert.equal(sent.length, 1);
    assert.match((sent[0][3] as { eventID: string }).eventID, /^registration\./);
  });

  test('is not sent for an existing account signing in', () => {
    grantAndLoad();
    meta.noteSignIn({ id: 'user-2', email_confirmed_at: '2026-09-01T00:00:00Z' }, now);
    meta.noteSignIn({ id: 'user-3', email_confirmed_at: null }, now);
    assert.equal(tracked('CompleteRegistration').length, 0);
  });

  test('from a sign-in callback it waits for the next page, so the one-time code in the URL is never sent', () => {
    grantAndLoad();
    (location as { pathname: string }).pathname = '/auth/callback';
    meta.noteSignIn(justConfirmed, now);
    assert.equal(tracked('CompleteRegistration').length, 0);
    (location as { pathname: string }).pathname = '/dashboard';
    meta.flushPendingRegistration();
    assert.equal(tracked('CompleteRegistration').length, 1);
  });

  test('is dropped, not kept for later, when consent is declined', () => {
    meta.saveConsent('denied');
    meta.noteSignIn(justConfirmed, now);
    meta.saveConsent('granted');
    meta.loadPixel(PIXEL);
    meta.flushPendingRegistration();
    assert.equal(tracked('CompleteRegistration').length, 0);
  });
});
