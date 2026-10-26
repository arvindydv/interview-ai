// Reporting AI-generated answers (Microsoft Store policy 11.16): users flag an answer from the desktop
// app with POST /v1/reports; administrators review the reports at /admin/reports.

export const REPORT_REASONS = ['harmful', 'inappropriate', 'misleading', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harmful: 'Harmful',
  inappropriate: 'Inappropriate',
  misleading: 'Misleading',
  other: 'Other',
};

export const REPORT_LIMITS = {
  maxDetailsChars: 1_000,
  /** Fallback copy of the answer, used only when the server has no record of the turn. */
  maxAnswerChars: 20_000,
  maxQuestionChars: 4_000,
} as const;

/** Body of POST /v1/reports. */
export interface ReportInput {
  /** The answer's id: the `turnId` of the live turn that produced it. */
  turnId: string;
  reason: ReportReason;
  details?: string;
  /** What the user saw. The server prefers its own record of the turn and stores these only without one. */
  question?: string;
  answer?: string;
}

export interface ReportReceipt {
  id: string;
  createdAt: string;
}

export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface AdminReport {
  id: string;
  userId: string;
  userEmail: string;
  turnId: string;
  /** The recorded live turn, when the report matched one (null = answer text came from the client). */
  liveTurnId: string | null;
  reason: ReportReason;
  details: string;
  question: string;
  answer: string;
  model: string | null;
  status: ReportStatus;
  adminNote: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
