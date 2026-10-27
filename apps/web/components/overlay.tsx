'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, CircleCheck, CircleX, X, type LucideIcon } from 'lucide-react';

// ---- toasts --------------------------------------------------------------------------------------

type Toast = { id: number; tone: 'ok' | 'bad'; text: string; action?: { label: string; run: () => void } };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Shows a short message at the bottom of the screen. Render <Toaster /> once on the page. */
export function toast(text: string, opts: { tone?: Toast['tone']; action?: Toast['action'] } = {}) {
  const t: Toast = { id: nextId++, tone: opts.tone ?? 'ok', text, action: opts.action };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), opts.action ? 6000 : 3500);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex max-w-md animate-fade-up items-center gap-3 rounded-xl border border-line-strong bg-surface-2/95 py-2.5 pr-2 pl-3.5 text-sm shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          {t.tone === 'ok' ? <CircleCheck size={16} className="shrink-0 text-brand" /> : <CircleX size={16} className="shrink-0 text-danger" />}
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded-md p-1 text-faint hover:bg-white/5 hover:text-fg">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- menu ----------------------------------------------------------------------------------------

export type MenuItem =
  | { label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean; checked?: boolean }
  | 'divider';

/** A dropdown of actions, opened from `trigger`. Arrow keys move, Escape closes. */
export function Menu({
  trigger,
  items,
  label,
  align = 'right',
  triggerClassName = 'btn btn-ghost !p-1.5',
}: {
  trigger: React.ReactNode;
  items: MenuItem[];
  label: string;
  align?: 'left' | 'right';
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          className={`absolute top-full z-40 mt-1.5 min-w-48 animate-fade-up rounded-xl border border-line-strong bg-surface-2/95 p-1 shadow-2xl shadow-black/60 backdrop-blur-xl [animation-duration:0.18s] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item, n) =>
            item === 'divider' ? (
              <div key={n} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition disabled:opacity-40 ${
                  item.danger ? 'text-danger hover:bg-danger/10 focus:bg-danger/10' : 'text-fg hover:bg-white/[0.06] focus:bg-white/[0.06]'
                }`}
              >
                {item.icon && <item.icon size={15} className={item.danger ? '' : 'text-muted'} />}
                <span className="flex-1">{item.label}</span>
                {item.checked && <Check size={14} className="text-brand" />}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---- confirm dialog ------------------------------------------------------------------------------

/** A modal yes/no question. Uses <dialog>, so focus is trapped and Escape cancels. */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  text: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => e.target === ref.current && onCancel()}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-surface-2 p-0 text-fg shadow-2xl shadow-black/60 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-fade-up"
    >
      <div className="p-6">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted">{text}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-secondary !py-2">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={`btn !py-2 ${danger ? 'bg-danger text-bg hover:brightness-110' : 'btn-primary'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
