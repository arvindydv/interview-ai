// Reporting an AI-generated answer (Microsoft Store policy 11.16). Pure helpers, unit-tested in
// test/report.test.ts; the form lives in reportForm.tsx.
import type { ReportInput, ReportReason } from '@parakeet/shared';

export interface ReportableAnswer {
  turnId: string;
  question?: string;
  text: string;
  done: boolean;
}

/** Only a finished answer with text can be reported: not one still streaming, nor an empty one. */
export function canReport(answer: ReportableAnswer | null | undefined): answer is ReportableAnswer {
  return Boolean(answer && answer.turnId && answer.done && answer.text.trim());
}

export function reportInput(answer: ReportableAnswer, reason: ReportReason, details: string): ReportInput {
  return {
    turnId: answer.turnId,
    reason,
    details: details.trim(),
    question: answer.question ?? '',
    answer: answer.text,
  };
}

/** The API's own messages are written for users; transport failures are not. */
export function reportErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (!message || /error sending request|connect|timed out|dns|HTTP 5\d\d/i.test(message)) {
    return 'Couldn’t send your report. Check your connection and try again.';
  }
  return message;
}
