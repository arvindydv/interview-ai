import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Flag } from 'lucide-react';
import { REPORT_LIMITS, REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from '@parakeet/shared';
import { parakeet } from './bridge';
import { reportErrorMessage, reportInput, type ReportableAnswer } from './report';
import { Spinner } from './ui';

const REASON_HINTS: Record<ReportReason, string> = {
  harmful: 'Dangerous, hateful or encourages harm',
  inappropriate: 'Offensive, sexual or otherwise unsuitable',
  misleading: 'False, made up or deceptive',
  other: 'Something else is wrong',
};

/**
 * "Report response" form for one AI-generated answer. Sends the report to the Friday AI team through
 * the signed-in API and confirms (or explains the failure) in place.
 */
export function ReportForm({ answer, onClose }: { answer: ReportableAnswer; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'editing' | 'sending' | 'sent'>('editing');
  const [error, setError] = useState<string | null>(null);
  const firstRadio = useRef<HTMLInputElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);

  useEffect(() => firstRadio.current?.focus(), []);
  useEffect(() => {
    if (state === 'sent') doneButton.current?.focus();
  }, [state]);

  const submit = async () => {
    if (!reason || state === 'sending') return;
    setState('sending');
    setError(null);
    try {
      await parakeet.reports.submit(reportInput(answer, reason, details));
      setState('sent');
    } catch (e) {
      setError(reportErrorMessage(e));
      setState('editing');
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby="pk-report-title"
      // Keys typed here belong to the form, not to the window's shortcuts (e.g. Ctrl+⌫ clears answers).
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
      className="text-fg select-text"
    >
      {state === 'sent' ? (
        <div role="status" className="flex flex-col items-center gap-2 py-4 text-center">
          <CircleCheck size={26} className="text-brand" />
          <p id="pk-report-title" className="text-sm font-semibold">Thanks, your report was sent</p>
          <p className="max-w-xs text-[12.5px] leading-relaxed text-muted">
            The Friday AI team reviews every report and uses it to improve answers.
          </p>
          <button ref={doneButton} onClick={onClose} className="btn btn-secondary mt-2 !px-4 !py-1.5 text-[13px]">
            Done
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p id="pk-report-title" className="flex items-center gap-2 text-sm font-semibold">
            <Flag size={14} className="text-danger" /> Report this response
          </p>
          <p className="mt-1 text-[12.5px] text-muted">Tell us what’s wrong with this AI-generated answer.</p>

          <fieldset className="mt-3 grid gap-1.5 sm:grid-cols-2" disabled={state === 'sending'}>
            <legend className="sr-only">Reason</legend>
            {REPORT_REASONS.map((r, i) => (
              <label
                key={r}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 ring-1 transition ${
                  reason === r ? 'bg-danger/10 ring-danger/40' : 'bg-white/[0.03] ring-line hover:bg-white/[0.06]'
                }`}
              >
                <input
                  ref={i === 0 ? firstRadio : undefined}
                  type="radio"
                  name="pk-report-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="mt-0.5 accent-[var(--color-danger)]"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{REPORT_REASON_LABELS[r]}</span>
                  <span className="block text-[11.5px] leading-snug text-muted">{REASON_HINTS[r]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="mt-3 block">
            <span className="text-[12px] text-muted">Details (optional)</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={REPORT_LIMITS.maxDetailsChars}
              rows={3}
              disabled={state === 'sending'}
              placeholder="What was wrong with it?"
              className="input mt-1 !min-h-0 resize-none !py-2 !text-[13px]"
            />
            <span className="mt-0.5 block text-right text-[11px] text-faint tabular-nums">
              {details.length} / {REPORT_LIMITS.maxDetailsChars}
            </span>
          </label>

          {error && (
            <p role="alert" className="mt-1 text-[12.5px] text-danger">
              {error}
            </p>
          )}

          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost !px-3 !py-1.5 text-[13px]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason || state === 'sending'}
              className="btn btn-primary !px-4 !py-1.5 text-[13px]"
            >
              {state === 'sending' ? <Spinner className="!size-3.5" /> : <Flag size={13} />} Submit report
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
