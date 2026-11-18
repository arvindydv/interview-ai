'use client';
import { useEffect, useState } from 'react';
import { Bug, CircleCheck, Lightbulb, MessageCircle, Star } from 'lucide-react';
import { FEEDBACK_LIMITS, type FeedbackInput, type FeedbackKind, type FeedbackReceipt, type MyReview } from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
const RATING_WORDS = ['', 'Poor', 'Could be better', 'Good', 'Great', 'Excellent'];
const L = FEEDBACK_LIMITS;

const STATUS_TEXT: Record<MyReview['status'], string> = {
  new: 'Waiting for a quick check before it can appear on the website.',
  approved: 'Shown on the website. Thank you!',
  hidden: 'Not shown on the website. We still read every review.',
  done: '',
};

/** "Priya Sharma" → "Priya S." */
const shortName = (full: string) => {
  const [first, ...rest] = full.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0].toUpperCase()}.` : (first ?? '');
};

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Rating" className="flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className="rounded-md p-0.5 transition hover:scale-110"
          >
            <Star size={30} className={n <= shown ? 'text-warn' : 'text-line-strong'} fill={n <= shown ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
      <span className="text-sm text-muted">{RATING_WORDS[shown]}</span>
    </div>
  );
}

function ReviewForm({ email }: { email: string }) {
  const [mine, setMine] = useState<MyReview | null | undefined>(undefined);
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('');
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api<MyReview | null>('/v1/feedback/review').then(
      (r) => {
        setMine(r);
        if (r) {
          setRating(r.rating);
          setMessage(r.message);
          setDisplayName(r.displayName);
          setRole(r.role);
          setPublish(r.publish);
        } else {
          // A starting point for the public name; the user can change it.
          const base = email.split('@')[0].split(/[._+-]/)[0];
          setDisplayName(base ? base[0].toUpperCase() + base.slice(1) : '');
        }
      },
      () => setMine(null),
    );
  }, [email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) return setError('Choose a star rating.');
    setBusy(true);
    setError(null);
    try {
      const body: FeedbackInput = { kind: 'review', rating, message, displayName: shortName(displayName), role, publish };
      await api<FeedbackReceipt>('/v1/feedback', { method: 'POST', body: JSON.stringify(body) });
      setSent(true);
      setMine({ rating, message, displayName: shortName(displayName), role, publish, status: 'new', updatedAt: new Date().toISOString() });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (mine === undefined) return <Spinner className="text-muted" />;

  return (
    <form onSubmit={submit} className="space-y-5">
      {sent ? (
        <p className="flex items-center gap-2 rounded-lg border border-brand/25 bg-brand/10 px-3 py-2 text-sm text-brand">
          <CircleCheck size={16} /> Thanks for your review!{' '}
          {publish ? 'It will appear on the website after a quick check.' : 'Only our team will see it.'}
        </p>
      ) : (
        mine && STATUS_TEXT[mine.status] && (
          <p className="rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-sm text-muted">
            You reviewed Friday on {new Date(mine.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.{' '}
            {mine.publish ? STATUS_TEXT[mine.status] : 'Only our team can see it.'} Editing it below replaces it.
          </p>
        )
      )}

      <div>
        <p className="text-sm font-medium">How would you rate Friday?</p>
        <div className="mt-2">
          <StarPicker value={rating} onChange={setRating} />
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Your review</span>
        <textarea
          className="input mt-2 min-h-32"
          placeholder="What helped you most? How did your interview go?"
          value={message}
          minLength={L.minMessageChars}
          maxLength={L.maxMessageChars}
          required
          onChange={(e) => setMessage(e.target.value)}
        />
        <span className="mt-1 block text-right text-xs text-faint tabular-nums">
          {message.length}/{L.maxMessageChars}
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-xl border border-line bg-white/[0.02] p-4">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-brand)]" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        <span className="text-sm">
          <span className="font-medium">Show my review on the Friday website</span>
          <span className="mt-0.5 block text-muted">
            Only the name and role below are shown, never your email. You can change or turn this off any time.
          </span>
        </span>
      </label>

      {publish && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Name to show</span>
            <input
              className="input mt-2"
              value={displayName}
              maxLength={L.maxNameChars}
              placeholder="e.g. Priya Sharma"
              required
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <span className="mt-1 block text-xs text-faint">Shown as “{shortName(displayName) || '…'}”</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">
              Role <span className="font-normal text-faint">(optional)</span>
            </span>
            <input
              className="input mt-2"
              value={role}
              maxLength={L.maxRoleChars}
              placeholder="e.g. Software Engineer, Bengaluru"
              onChange={(e) => setRole(e.target.value)}
            />
          </label>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button disabled={busy} className="btn btn-primary">
        {busy ? <Spinner /> : mine ? 'Update review' : 'Submit review'}
      </button>
    </form>
  );
}

const KINDS: { id: Exclude<FeedbackKind, 'review'>; label: string; icon: typeof Bug; placeholder: string }[] = [
  { id: 'idea', label: 'Idea', icon: Lightbulb, placeholder: 'What would make Friday better for you?' },
  { id: 'bug', label: 'Problem', icon: Bug, placeholder: 'What went wrong? What were you doing, and on which device?' },
  { id: 'other', label: 'Other', icon: MessageCircle, placeholder: 'Anything you’d like to tell us.' },
];

function FeedbackForm() {
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('idea');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: FeedbackInput = { kind, message };
      await api<FeedbackReceipt>('/v1/feedback', { method: 'POST', body: JSON.stringify(body) });
      setSent(true);
      setMessage('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div role="radiogroup" aria-label="Type of feedback" className="grid grid-cols-3 gap-2">
        {KINDS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={kind === id}
            onClick={() => setKind(id)}
            className={`flex flex-col items-center gap-1.5 rounded-xl p-3 text-sm ring-1 transition ${
              kind === id ? 'bg-brand/10 text-brand ring-brand/40' : 'text-muted ring-line hover:text-fg'
            }`}
          >
            <Icon size={18} /> {label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="sr-only">Message</span>
        <textarea
          className="input min-h-36"
          placeholder={KINDS.find((k) => k.id === kind)!.placeholder}
          value={message}
          minLength={L.minMessageChars}
          maxLength={L.maxMessageChars}
          required
          onChange={(e) => {
            setMessage(e.target.value);
            setSent(false);
          }}
        />
        <span className="mt-1 block text-right text-xs text-faint tabular-nums">
          {message.length}/{L.maxMessageChars}
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {sent && (
        <p className="flex items-center gap-2 rounded-lg border border-brand/25 bg-brand/10 px-3 py-2 text-sm text-brand">
          <CircleCheck size={16} /> Thanks! Our team reads every message.
        </p>
      )}
      <button disabled={busy} className="btn btn-primary">
        {busy ? <Spinner /> : 'Send feedback'}
      </button>
      <p className="text-xs text-faint">This goes only to the Friday team. It is never shown publicly.</p>
    </form>
  );
}

export default function FeedbackPage() {
  const email = useRequireSession();
  const [tab, setTab] = useState<'review' | 'feedback'>('review');

  useEffect(() => {
    if (location.hash === '#feedback') setTab('feedback');
  }, []);

  if (email === null) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-10">
        <header className="animate-fade-up">
          <h1 className="text-3xl font-semibold tracking-tight">Feedback</h1>
          <p className="mt-1.5 text-sm text-muted">Tell us how Friday is working for you. It shapes what we build next.</p>
        </header>

        <div role="tablist" className="mt-6 flex gap-1 rounded-xl bg-white/[0.03] p-1 ring-1 ring-line">
          {(
            [
              ['review', 'Rate & review'],
              ['feedback', 'Ideas & problems'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                tab === id ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="glass mt-4 rounded-2xl p-5 sm:p-7">{tab === 'review' ? <ReviewForm email={email} /> : <FeedbackForm />}</section>
      </div>
    </AppShell>
  );
}
