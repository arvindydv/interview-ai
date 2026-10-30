'use client';
import { useRef } from 'react';

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const set = (next: string, focus: number) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    refs.current[Math.min(focus, length - 1)]?.focus();
    if (clean.length === length) onComplete?.(clean);
  };

  return (
    <div className="flex justify-between gap-2" onPaste={(e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text');
      set(text, text.replace(/\D/g, '').length);
    }}>
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={length}
          disabled={disabled}
          autoFocus={i === 0}
          value={value[i] ?? ''}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (!typed) return;
            // Typing (1 char) or browser autofill of the whole code into one box.
            set(value.slice(0, i) + typed + value.slice(i + typed.length), i + typed.length);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (value[i]) set(value.slice(0, i) + value.slice(i + 1), i);
              else if (i > 0) set(value.slice(0, i - 1) + value.slice(i), i - 1);
            } else if (e.key === 'ArrowLeft') refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight') refs.current[i + 1]?.focus();
          }}
          className="input h-14 !w-12 !p-0 text-center text-xl font-semibold sm:!w-14"
        />
      ))}
    </div>
  );
}
