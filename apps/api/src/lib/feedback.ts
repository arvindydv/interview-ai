import { z } from 'zod';
import { FEEDBACK_KINDS, FEEDBACK_LIMITS } from '@parakeet/shared';

// Validation for reviews and feedback (POST /v1/feedback). Kept free of database and Redis imports
// so it can be unit-tested on its own.

/** Submissions one user may send per hour. */
export const MAX_FEEDBACK_PER_HOUR = 10;

const L = FEEDBACK_LIMITS;
const text = (max: number) =>
  z
    .string()
    .max(max * 2) // generous before trimming; the exact limit is checked after
    .default('')
    .transform((s) => s.replace(/\s+/g, ' ').trim());

export const feedbackBody = z
  .object({
    kind: z.enum(FEEDBACK_KINDS, 'Choose review, idea, problem or other'),
    rating: z.number().int().min(1, 'Rating must be 1 to 5 stars').max(5, 'Rating must be 1 to 5 stars').optional(),
    message: z
      .string()
      .transform((s) => s.trim())
      .pipe(
        z
          .string()
          .min(L.minMessageChars, `Write at least ${L.minMessageChars} characters`)
          .max(L.maxMessageChars, `Keep it under ${L.maxMessageChars} characters`),
      ),
    displayName: text(L.maxNameChars),
    role: text(L.maxRoleChars),
    publish: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'review' && v.rating === undefined) {
      ctx.addIssue({ code: 'custom', path: ['rating'], message: 'Choose a star rating' });
    }
    if (v.displayName.length > L.maxNameChars) {
      ctx.addIssue({ code: 'custom', path: ['displayName'], message: `Keep the name under ${L.maxNameChars} characters` });
    }
    if (v.role.length > L.maxRoleChars) {
      ctx.addIssue({ code: 'custom', path: ['role'], message: `Keep the role under ${L.maxRoleChars} characters` });
    }
    if (v.kind === 'review' && v.publish && v.displayName.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['displayName'], message: 'Add the name to show with your review' });
    }
  })
  // Only reviews carry a rating, a public name or consent to publish.
  .transform((v) =>
    v.kind === 'review' ? v : { ...v, rating: undefined, displayName: '', role: '', publish: false },
  );
export type FeedbackBody = z.infer<typeof feedbackBody>;

export const feedbackPatch = z.object({
  status: z.enum(['new', 'approved', 'hidden', 'done']).optional(),
  adminNote: z.string().max(2000).optional(),
});
