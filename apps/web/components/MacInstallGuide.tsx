import { ShieldCheck } from 'lucide-react';

// The macOS build isn't notarized yet, so Gatekeeper blocks the first launch with "Friday AI Not
// Opened". These are Apple's own steps for opening it anyway. Remove once the DMG is notarized.
const STEPS: React.ReactNode[] = [
  <>Download Friday AI for macOS.</>,
  <>
    Open the <b>.dmg</b> file and drag <b>Friday AI</b> into the <b>Applications</b> folder.
  </>,
  <>Try opening Friday AI.</>,
  <>
    If macOS shows <b>“Friday AI Not Opened”</b>, click <b>Done</b>.
  </>,
  <>
    Open <b>System Settings → Privacy &amp; Security</b>.
  </>,
  <>
    Scroll to the <b>Security</b> section and click <b>Open Anyway</b> next to Friday AI.
  </>,
  <>Confirm with your Mac password or Touch ID if prompted.</>,
];

function Steps() {
  return (
    <ol className="space-y-2.5">
      {STEPS.map((step, i) => (
        <li key={i} className="flex gap-3 text-sm text-muted [&_b]:font-medium [&_b]:text-fg/90">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/5 text-xs font-semibold text-fg ring-1 ring-line">
            {i + 1}
          </span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

const footnote = 'You only need to do this once. After that, Friday AI opens normally.';

/** Step-by-step help for Gatekeeper's first-launch block. `compact` folds it behind a summary. */
export function MacInstallGuide({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <details id="install-macos" className="group max-w-md rounded-xl border border-line bg-white/[0.02] p-4 text-left">
        <summary className="cursor-pointer list-none text-sm font-medium text-fg marker:hidden">
          Installing on macOS? <span className="text-muted group-open:hidden">Show the steps</span>
        </summary>
        <div className="mt-4">
          <Steps />
          <p className="mt-3 text-xs text-faint">{footnote}</p>
        </div>
      </details>
    );
  }
  return (
    <div id="install-macos" className="mx-auto mt-12 max-w-xl scroll-mt-24 rounded-2xl border border-line bg-bg/40 p-6 text-left sm:p-8">
      <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <ShieldCheck size={18} className="text-brand" /> How to install Friday AI on macOS
      </h3>
      <div className="mt-5">
        <Steps />
      </div>
      <p className="mt-4 text-xs text-faint">{footnote}</p>
    </div>
  );
}
