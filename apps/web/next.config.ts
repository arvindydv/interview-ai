import path from 'node:path';
import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

/** Origins the browser talks to besides our own: Supabase (REST + realtime) and the Parakeet API. */
function connectSources() {
  const out = new Set<string>(["'self'"]);
  for (const raw of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_API_URL]) {
    if (!raw) continue;
    const u = new URL(raw);
    out.add(u.origin);
    out.add(`${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`);
  }
  if (dev) out.add('ws://localhost:*'); // hot reload
  return [...out].join(' ');
}

// Razorpay Checkout: its script, the payment iframe it opens, and its telemetry endpoint.
const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com';
const RAZORPAY_FRAMES = 'https://api.razorpay.com https://checkout.razorpay.com';
const RAZORPAY_CONNECT = 'https://lumberjack.razorpay.com';
// Cloudflare Turnstile on the sign-in forms (lib/captcha.tsx): its script and challenge iframe.
const TURNSTILE = 'https://challenges.cloudflare.com';

// Next's inline bootstrap scripts need 'unsafe-inline' unless every page is rendered with a nonce;
// the rest of the policy (no framing, no plugins, no other foreign scripts/forms) still applies.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} ${RAZORPAY_SCRIPT} ${TURNSTILE}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Practice questions are read aloud from audio fetched with the user's token and played as a blob.
  "media-src 'self' blob:",
  `connect-src ${connectSources()} ${RAZORPAY_CONNECT}`,
  `frame-src ${RAZORPAY_FRAMES} ${TURNSTILE}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// The microphone is for spoken answers in practice mode (app/practice).
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(self "https://api.razorpay.com")' },
  ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
];

const nextConfig: NextConfig = {
  transpilePackages: ['@parakeet/shared'],
  poweredByHeader: false,
  // Self-contained server for the Docker image (see /Dockerfile); traced from the monorepo root so
  // workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
