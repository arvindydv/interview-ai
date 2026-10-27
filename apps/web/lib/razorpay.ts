'use client';
import type { CheckoutOrder, VerifyPaymentInput } from '@parakeet/shared';
import { company } from './company';

// Razorpay Standard Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
// The script is loaded on demand, only when someone starts a payment.

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (r: { error: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: object) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

function loadScript() {
  if (window.Razorpay) return Promise.resolve();
  return (loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('Could not load the payment window. Check your connection and try again.'));
    };
    document.body.appendChild(s);
  }));
}

export type CheckoutOutcome =
  | { status: 'paid'; response: VerifyPaymentInput }
  | { status: 'dismissed' }
  | { status: 'failed'; message: string };

/**
 * Opens Checkout for an order and resolves once the user pays or closes it. A failed attempt is
 * reported but leaves the window open so they can retry with another method; closing it afterwards
 * resolves with that failure.
 */
export async function openCheckout(order: CheckoutOrder): Promise<CheckoutOutcome> {
  await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error('The payment window is blocked by a browser extension. Allow checkout.razorpay.com and try again.');
  return new Promise((resolve) => {
    let lastError: string | null = null;
    const rzp = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: company.brand,
      description: order.description,
      prefill: { email: order.email },
      notes: { product: order.productId },
      theme: { color: '#34d399' },
      handler: (response: VerifyPaymentInput) => resolve({ status: 'paid', response }),
      modal: {
        ondismiss: () => resolve(lastError ? { status: 'failed', message: lastError } : { status: 'dismissed' }),
      },
    });
    rzp.on('payment.failed', (r) => {
      lastError = r.error.description ?? 'The payment failed.';
    });
    rzp.open();
  });
}
