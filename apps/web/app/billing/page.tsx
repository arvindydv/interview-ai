'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays, CalendarRange, Check, CircleCheck, CircleX, Clock, CreditCard, Info, LifeBuoy, Minus, Plus,
  Receipt, ShieldCheck, Timer, X,
} from 'lucide-react';
import {
  MAX_MINUTES, MINUTE_PRESETS, MIN_MINUTES, PLANS, PRICE_PER_MINUTE, formatInr, isValidMinutes, minutesProduct,
  planLabel, productById, type BillingOverview, type CheckoutOrder, type CreateOrderInput, type Payment,
  type PaymentStatus, type Product, type ProductId, type VerifyPaymentInput,
} from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { checkoutTracking, trackInitiateCheckout, trackPurchase } from '@/lib/meta';
import { openCheckout } from '@/lib/razorpay';
import { supabase } from '@/lib/supabase';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Card, Pill, Spinner } from '@/components/ui';

type Tone = 'ok' | 'pending' | 'info' | 'warn' | 'bad';
type Notice = { tone: Tone; title: string; text: string };
type Pending = { error: 'payment_pending'; message: string };

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Confirmation is retried on network and server errors: the customer has already paid. */
const VERIFY_RETRY_MS = [1000, 3000, 6000];
/** While a payment is still processing, check for it this often, for up to POLL_FOR_MS. */
const POLL_EVERY_MS = 5000;
const POLL_FOR_MS = 3 * 60_000;

/** Where a failed or reversed debit ends up, said the same way everywhere. */
const BANK_RETURN = 'If any amount was debited, your bank returns it within 5–7 working days.';

const PRESET_MINUTES = [...MINUTE_PRESETS];
const DEFAULT_MINUTES = 60;

async function confirmPayment(response: VerifyPaymentInput): Promise<BillingOverview | Pending> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<BillingOverview | Pending>('/v1/billing/verify', { method: 'POST', body: JSON.stringify(response) });
    } catch (e) {
      const retryable = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      if (!retryable || attempt >= VERIFY_RETRY_MS.length) throw e;
      await sleep(VERIFY_RETRY_MS[attempt]);
    }
  }
}

function successNotice(product: Product, after: BillingOverview): Notice {
  if (product.kind === 'minutes') {
    return { tone: 'ok', title: 'Payment successful', text: `${product.minutes} minutes were added to your account.` };
  }
  if (product.kind === 'jobs_plan') return { tone: 'ok', title: 'Payment successful', text: `${product.name} is active for 30 days.` };
  const until = after.planExpiresAt ? ` until ${longDate(after.planExpiresAt)}` : '';
  return { tone: 'ok', title: 'Payment successful', text: `Your ${planLabel(product.plan)} plan is active${until}.` };
}

const NOTICE_STYLE: Record<Tone, { box: string; icon: React.ReactNode }> = {
  ok: { box: 'border-brand/30 bg-brand/[0.06] text-brand', icon: <CircleCheck size={18} /> },
  pending: { box: 'border-warn/30 bg-warn/[0.06] text-warn', icon: <Spinner className="mt-0.5" /> },
  info: { box: 'border-line bg-white/[0.03] text-fg', icon: <Info size={18} className="text-muted" /> },
  warn: { box: 'border-warn/30 bg-warn/[0.06] text-warn', icon: <Clock size={18} /> },
  bad: { box: 'border-danger/30 bg-danger/[0.06] text-danger', icon: <CircleX size={18} /> },
};

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose?: () => void }) {
  const { box, icon } = NOTICE_STYLE[notice.tone];
  return (
    <div role="status" aria-live="polite" className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${box}`}>
      <span className="mt-px shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{notice.title}</p>
        <p className="mt-0.5 text-sm opacity-90">{notice.text}</p>
      </div>
      {onClose && notice.tone !== 'pending' && (
        <button onClick={onClose} aria-label="Dismiss" className="shrink-0 rounded-md p-1 opacity-70 transition hover:bg-white/5 hover:opacity-100">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function AccountSummary({ overview }: { overview: BillingOverview }) {
  const unlimited = overview.plan !== 'free';
  const { totalSeconds, usedSeconds } = overview.minutes;
  const left = Math.floor(Math.max(totalSeconds - usedSeconds, 0) / 60);
  const usedShare = totalSeconds > 0 ? Math.min(usedSeconds / totalSeconds, 1) : 1;
  return (
    <Card>
      <div className="grid gap-5 sm:grid-cols-2 sm:divide-x sm:divide-line">
        <div>
          <p className="text-xs text-muted">Current plan</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-2xl font-semibold tracking-tight">{unlimited ? planLabel(overview.plan) : 'Pay per minute'}</span>
            {unlimited && <Pill tone="ok">Unlimited</Pill>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {unlimited
              ? overview.planExpiresAt ? `Active until ${longDate(overview.planExpiresAt)}` : 'No end date'
              : 'Live sessions use your minutes balance.'}
          </p>
        </div>
        <div className="sm:pl-5">
          <p className="text-xs text-muted">Minutes balance</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
            {left} <span className="text-sm font-normal text-muted">min left</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(1 - usedShare) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-faint">
            {unlimited ? 'Not used while your plan is active. They stay for later.' : left === 0 ? 'Buy minutes or a plan to keep using live sessions.' : 'Minutes never expire.'}
          </p>
        </div>
      </div>
    </Card>
  );
}

function MinutesPicker({
  minutes, setMinutes, highlighted, busy, disabled, onBuy, onSuggestPlan,
}: {
  minutes: string;
  setMinutes: (v: string) => void;
  highlighted: boolean;
  busy: boolean;
  disabled: boolean;
  onBuy: (p: Product) => void;
  onSuggestPlan: () => void;
}) {
  const n = Number(minutes);
  const valid = minutes !== '' && isValidMinutes(n);
  const product = valid ? minutesProduct(n) : null;
  const clamp = (v: number) => String(Math.min(Math.max(Math.round(v) || MIN_MINUTES, MIN_MINUTES), MAX_MINUTES));
  const step = (d: number) => setMinutes(clamp((valid ? n : MIN_MINUTES) + d));
  const planIsBetter = product !== null && product.amount >= PLANS.monthly.amount;

  return (
    <div id="buy-minutes" className={`glass flex flex-col rounded-[var(--radius-card)] p-5 transition ${highlighted ? 'ring-2 ring-brand/60' : ''}`}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-white/5 text-brand ring-1 ring-line">
          <Timer size={16} />
        </span>
        <div>
          <h3 className="text-sm font-semibold">Buy minutes</h3>
          <p className="text-xs text-muted">{formatInr(PRICE_PER_MINUTE * 100)} per minute · never expire</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label="Quick picks">
        {PRESET_MINUTES.map((m) => (
          <button
            key={m}
            onClick={() => setMinutes(String(m))}
            aria-pressed={n === m}
            className={`rounded-lg px-2 py-2 text-sm font-medium ring-1 transition ${
              n === m ? 'bg-brand/10 text-brand ring-brand/50' : 'bg-white/[0.03] text-muted ring-line hover:text-fg'
            }`}
          >
            {m} min
          </button>
        ))}
      </div>

      <label htmlFor="minutes" className="mt-5 text-xs text-muted">Or enter your own amount</label>
      <div className="mt-1.5 flex items-center gap-2">
        <button onClick={() => step(-10)} aria-label="10 minutes less" className="btn btn-secondary !size-10 !p-0" disabled={valid && n <= MIN_MINUTES}>
          <Minus size={16} />
        </button>
        <div className="relative flex-1">
          <input
            id="minutes"
            type="number"
            inputMode="numeric"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={() => minutes !== '' && setMinutes(clamp(n))}
            className="input !pr-12 text-center text-lg font-semibold tabular-nums"
            aria-describedby="minutes-help"
          />
          <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-faint">min</span>
        </div>
        <button onClick={() => step(10)} aria-label="10 minutes more" className="btn btn-secondary !size-10 !p-0" disabled={valid && n >= MAX_MINUTES}>
          <Plus size={16} />
        </button>
      </div>
      <input
        type="range"
        min={MIN_MINUTES}
        max={MAX_MINUTES}
        step={10}
        value={valid ? n : MIN_MINUTES}
        onChange={(e) => setMinutes(e.target.value)}
        className="mt-4 w-full accent-brand"
        aria-label="Minutes"
      />
      <p id="minutes-help" className={`mt-1 text-xs ${minutes !== '' && !valid ? 'text-danger' : 'text-faint'}`}>
        Between {MIN_MINUTES} and {MAX_MINUTES} minutes.
      </p>

      <div className="mt-5 flex items-end justify-between gap-3 border-t border-line pt-4">
        <div>
          <p className="text-xs text-muted">{valid ? `${n} min × ${formatInr(PRICE_PER_MINUTE * 100)}` : 'Total'}</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{product ? formatInr(product.amount) : '—'}</p>
        </div>
      </div>
      {planIsBetter && (
        <p className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-muted ring-1 ring-line">
          For {formatInr(PLANS.monthly.amount)} you get unlimited minutes for 30 days.{' '}
          <button onClick={onSuggestPlan} className="font-medium text-brand hover:underline">See the monthly plan</button>
        </p>
      )}
      <button onClick={() => product && onBuy(product)} disabled={disabled || !product} className="btn btn-primary mt-4 w-full">
        {busy ? <Spinner /> : <><CreditCard size={15} /> {product ? `Pay ${formatInr(product.amount)}` : 'Choose minutes'}</>}
      </button>
    </div>
  );
}

function PlanCard({
  product, icon: Icon, perks, badge, highlighted, busy, disabled, onBuy,
}: {
  product: Product & { kind: 'plan' };
  icon: typeof Timer;
  perks: string[];
  badge?: string;
  highlighted: boolean;
  busy: boolean;
  disabled: boolean;
  onBuy: () => void;
}) {
  return (
    <div
      id={`product-${product.id}`}
      className={`glass relative flex flex-col rounded-[var(--radius-card)] p-5 transition ${highlighted ? 'ring-2 ring-brand/60' : ''}`}
    >
      {badge && (
        <span className="absolute -top-2.5 right-4 rounded-full bg-brand-gradient px-2.5 py-0.5 text-[11px] font-semibold text-[#04120c]">
          {badge}
        </span>
      )}
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-white/5 text-brand ring-1 ring-line">
          <Icon size={16} />
        </span>
        <h3 className="text-sm font-semibold">{product.name}</h3>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">
        {formatInr(product.amount)}
        <span className="ml-1 text-sm font-normal text-muted">/ {product.days} days</span>
      </p>
      <p className="mt-1 text-xs text-faint">About {formatInr(Math.round(product.amount / product.days / 100) * 100)} a day</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-muted">
        {perks.map((p) => (
          <li key={p} className="flex gap-2">
            <Check size={15} strokeWidth={3} className="mt-0.5 shrink-0 text-brand" /> {p}
          </li>
        ))}
      </ul>
      <button onClick={onBuy} disabled={disabled} className={`btn mt-5 w-full ${highlighted || badge ? 'btn-primary' : 'btn-secondary'}`}>
        {busy ? <Spinner /> : <><CreditCard size={15} /> Pay {formatInr(product.amount)}</>}
      </button>
    </div>
  );
}

const STATUS: Record<PaymentStatus, { label: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }> = {
  paid: { label: 'Paid', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  refunded: { label: 'Refunded', tone: 'warn' },
  created: { label: 'Pending', tone: 'neutral' },
};

function History({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted">No payments yet. Your receipts will appear here.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {payments.map((p) => {
        const s = STATUS[p.status];
        return (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium">{productById(p.productId)?.name ?? p.productId}</p>
              <p className="mt-0.5 truncate text-xs text-faint">
                {shortDate(p.paidAt ?? p.createdAt)}
                {p.paymentId && <> · <span className="font-mono">{p.paymentId}</span></>}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm tabular-nums ${p.status === 'paid' ? '' : 'text-muted line-through decoration-faint'}`}>
                {formatInr(p.amount)}
              </span>
              <Pill tone={s.tone}>{s.label}</Pill>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Assurance() {
  return (
    <ul className="grid gap-3 text-xs text-muted sm:grid-cols-3">
      <li className="flex items-center gap-2"><ShieldCheck size={15} className="shrink-0 text-brand" /> Secure checkout by Razorpay</li>
      <li className="flex items-center gap-2"><CreditCard size={15} className="shrink-0 text-brand" /> UPI, cards, netbanking and wallets</li>
      <li className="flex items-center gap-2"><Check size={15} strokeWidth={3} className="shrink-0 text-brand" /> One-time payment, no auto-renewal</li>
    </ul>
  );
}

const HELP = [
  {
    q: 'Money was debited but nothing changed?',
    a: 'Some UPI and netbanking payments take a few minutes to confirm. Your account updates automatically as soon as they do; this page refreshes on its own.',
  },
  { q: 'My payment failed.', a: `Nothing was added to your account, and you can try again with another method. ${BANK_RETURN}` },
  { q: 'Can I get a refund?', a: 'See the refund policy. Refunded payments are marked here, and the minutes or plan days they added are removed.' },
];

function Billing() {
  const router = useRouter();
  const params = useSearchParams();
  const wanted = productById(params.get('product'));

  const [email, setEmail] = useState('');
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProductId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [minutes, setMinutes] = useState(String(wanted?.kind === 'minutes' ? wanted.minutes : DEFAULT_MINUTES));
  const [highlight, setHighlight] = useState<'minutes' | 'monthly' | 'yearly' | null>(
    wanted ? (wanted.kind === 'minutes' ? 'minutes' : wanted.kind === 'plan' ? wanted.plan : null) : null,
  );
  const noticeRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = () =>
    api<BillingOverview>('/v1/billing').then(
      (o) => {
        setOverview(o);
        setLoadError(null);
      },
      (e: Error) => setLoadError(e.message),
    );

  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!data.session) {
          return router.replace(`/login?${new URLSearchParams({ next: `/billing${location.search}` })}`);
        }
        setEmail(data.session.user.email ?? '');
        load();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bring the option picked on the pricing page into view.
  const scrollTo = (target: 'minutes' | 'monthly' | 'yearly') =>
    document.getElementById(target === 'minutes' ? 'buy-minutes' : `product-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  useEffect(() => {
    if (overview && highlight) scrollTo(highlight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview !== null]);

  useEffect(() => {
    if (notice) noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [notice]);

  /** Re-reads the account until `paymentId` shows up as paid (the webhook applied it), or gives up. */
  async function waitForPayment(paymentId: string, product: Product, order: CheckoutOrder) {
    for (const until = Date.now() + POLL_FOR_MS; Date.now() < until; ) {
      await sleep(POLL_EVERY_MS);
      if (!mounted.current) return;
      const o = await api<BillingOverview>('/v1/billing').catch(() => null);
      if (!o) continue;
      setOverview(o);
      const p = o.payments.find((x) => x.paymentId === paymentId);
      if (p?.status === 'paid') {
        trackPurchase(order);
        return setNotice(successNotice(product, o));
      }
      if (p?.status === 'failed') {
        return setNotice({ tone: 'bad', title: 'Payment failed', text: `Your bank declined payment ${paymentId}. ${BANK_RETURN}` });
      }
      if (p?.status === 'refunded') {
        return setNotice({ tone: 'warn', title: 'Payment refunded', text: `Payment ${paymentId} was refunded, so nothing was added.` });
      }
    }
    if (!mounted.current) return;
    setNotice({
      tone: 'warn',
      title: 'Still confirming your payment',
      text: `Payment ${paymentId} hasn't been confirmed by your bank yet. It is applied automatically once it is, usually within an hour. If it fails, ${BANK_RETURN.charAt(0).toLowerCase()}${BANK_RETURN.slice(1)} Contact support with this ID if you need help.`,
    });
  }

  async function buy(product: Product) {
    setBusy(product.id);
    setNotice(null);
    let paymentId: string | null = null;
    let order: CheckoutOrder | null = null;
    try {
      const input: CreateOrderInput = { productId: product.id, tracking: checkoutTracking() };
      order = await api<CheckoutOrder>('/v1/billing/orders', { method: 'POST', body: JSON.stringify(input) });
      const opened = order;
      const outcome = await openCheckout(order, () => trackInitiateCheckout(opened));
      if (outcome.status === 'dismissed') {
        setNotice({ tone: 'info', title: 'Payment cancelled', text: 'You closed the payment window. You have not been charged.' });
        return;
      }
      if (outcome.status === 'failed') {
        setNotice({ tone: 'bad', title: 'Payment failed', text: `${outcome.message} ${BANK_RETURN}` });
        return;
      }
      paymentId = outcome.response.razorpay_payment_id;
      setNotice({ tone: 'pending', title: 'Confirming your payment…', text: 'Please keep this page open for a moment.' });
      const result = await confirmPayment(outcome.response);
      if ('error' in result) {
        setNotice({ tone: 'pending', title: 'Payment processing', text: `${result.message} You can keep using the app meanwhile.` });
        await waitForPayment(paymentId, product, order);
        return;
      }
      setOverview(result);
      setNotice(successNotice(product, result));
      // Only a payment the API has applied counts (a refunded one also comes back as a 200).
      if (result.payments.some((p) => p.paymentId === paymentId && p.status === 'paid')) trackPurchase(order);
    } catch (e) {
      const message = (e as Error).message;
      const unreachable = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      if (paymentId && order && unreachable) {
        // Paid, but we couldn't confirm it from here: the webhook applies it.
        setNotice({
          tone: 'pending',
          title: 'Payment received, confirming',
          text: `We couldn't confirm payment ${paymentId} yet. It is applied automatically within a few minutes.`,
        });
        await waitForPayment(paymentId, product, order);
      } else {
        setNotice({
          tone: 'bad',
          title: paymentId ? 'Payment not applied' : 'Could not start the payment',
          text: paymentId && !message.includes(paymentId) ? `${message} (Payment ID ${paymentId})` : message,
        });
      }
    } finally {
      setBusy(null);
    }
  }

  if (!overview) {
    return (
      <div className="grid min-h-screen place-items-center">
        {loadError ? (
          <div className="text-center">
            <p className="text-sm text-danger">{loadError}</p>
            <button onClick={load} className="btn btn-secondary mt-3 text-sm">Try again</button>
          </div>
        ) : (
          <LogoMark size={40} />
        )}
      </div>
    );
  }

  const unlimited = overview.plan !== 'free';
  const disabled = !overview.enabled || busy !== null;
  const planProps = (id: 'monthly' | 'yearly') => ({
    product: PLANS[id],
    highlighted: highlight === id,
    busy: busy === id,
    disabled,
    onBuy: () => buy(PLANS[id]),
  });
  const yearlySaves = formatInr(PLANS.monthly.amount * 12 - PLANS.yearly.amount);

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-8 sm:py-10">
        <header className="animate-fade-up">
          <h1 className="text-3xl font-semibold tracking-tight">Plans & billing</h1>
          <p className="mt-1 text-sm text-muted">
            Buy exactly the minutes you need, or go unlimited for a month or a year. Every feature is included either way.
          </p>
        </header>

        <div ref={noticeRef} className="space-y-3 empty:hidden">
          {!overview.enabled && (
            <NoticeBanner
              notice={{ tone: 'warn', title: 'Payments are paused', text: 'Payments are not available right now. Please check back soon.' }}
            />
          )}
          {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}
        </div>

        <AccountSummary overview={overview} />

        <section aria-labelledby="choose">
          <h2 id="choose" className="text-base font-semibold">{unlimited ? 'Add more' : 'Choose how to pay'}</h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            {unlimited
              ? 'Buying a plan again adds to your remaining days. Minutes you buy are kept for after your plan ends.'
              : 'Minutes are best for a few interviews. Plans are best if you practise or interview every week.'}
          </p>
          <div className="grid gap-4 lg:grid-cols-3">
            <MinutesPicker
              minutes={minutes}
              setMinutes={(v) => {
                setMinutes(v);
                setHighlight(null);
              }}
              highlighted={highlight === 'minutes'}
              busy={busy?.startsWith('minutes_') ?? false}
              disabled={disabled}
              onBuy={buy}
              onSuggestPlan={() => {
                setHighlight('monthly');
                scrollTo('monthly');
              }}
            />
            <PlanCard
              {...planProps('monthly')}
              icon={CalendarDays}
              perks={['Unlimited live session minutes', 'All features included', 'Runs 30 days, no auto-renewal']}
            />
            <PlanCard
              {...planProps('yearly')}
              icon={CalendarRange}
              badge={`Save ${yearlySaves}`}
              perks={['Unlimited live session minutes', 'All features included', `${yearlySaves} less than 12 monthly plans`]}
            />
          </div>
          <div className="mt-5">
            <Assurance />
          </div>
        </section>

        <Card title="Payment history" icon={Receipt}>
          <History payments={overview.payments} />
        </Card>

        <Card title="Need help with a payment?" icon={LifeBuoy}>
          <dl className="space-y-4 text-sm">
            {HELP.map(({ q, a }) => (
              <div key={q}>
                <dt className="font-medium">{q}</dt>
                <dd className="mt-1 text-muted">{a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs text-faint">
            Read the <Link href="/refunds" className="text-brand hover:underline">refund policy</Link> or{' '}
            <Link href="/contact" className="text-brand hover:underline">contact support</Link> with your payment ID.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <Billing />
    </Suspense>
  );
}
