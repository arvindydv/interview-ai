import { z } from 'zod';
import { REPORT_LIMITS, REPORT_REASONS } from '@parakeet/shared';

// Validation for reports of AI-generated answers (POST /v1/reports). Kept free of database and Redis
// imports so it can be unit-tested on its own.

/** Reports one user may file per hour; generous for real use, a ceiling on scripted abuse. */
export const MAX_REPORTS_PER_HOUR = 30;

export const reportBody = z.object({
  turnId: z.string().trim().min(1).max(128),
  reason: z.enum(REPORT_REASONS, 'Choose a reason: harmful, inappropriate, misleading or other'),
  details: z
    .string()
    .max(REPORT_LIMITS.maxDetailsChars, `Keep the details under ${REPORT_LIMITS.maxDetailsChars} characters`)
    .default('')
    .transform((s) => s.trim()),
  question: z.string().default('').transform((s) => s.slice(0, REPORT_LIMITS.maxQuestionChars)),
  answer: z.string().default('').transform((s) => s.slice(0, REPORT_LIMITS.maxAnswerChars)),
});
export type ReportBody = z.infer<typeof reportBody>;

export const reportPatch = z.object({
  status: z.enum(['open', 'actioned', 'dismissed']).optional(),
  adminNote: z.string().max(2000).optional(),
});
