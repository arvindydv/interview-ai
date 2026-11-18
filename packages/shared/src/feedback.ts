// User reviews and feedback. Signed-in users rate Friday and/or send private feedback from the
// website (POST /v1/feedback). Reviews only appear on the public site after the user opted in AND an
// administrator approved them at /admin/feedback.

export const FEEDBACK_KINDS = ['review', 'idea', 'bug', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  review: 'Review',
  idea: 'Idea',
  bug: 'Problem',
  other: 'Other',
};

export const FEEDBACK_LIMITS = {
  minMessageChars: 10,
  maxMessageChars: 1_000,
  maxNameChars: 40,
  maxRoleChars: 60,
} as const;

/** Body of POST /v1/feedback. A review needs a rating; other kinds ignore rating, name, role and publish. */
export interface FeedbackInput {
  kind: FeedbackKind;
  /** 1–5 stars, reviews only. */
  rating?: number;
  message: string;
  /** Name shown with a public review, e.g. "Priya S." */
  displayName?: string;
  /** Optional role shown with a public review, e.g. "Software Engineer, Bengaluru". */
  role?: string;
  /** The user agrees to the review being shown on the website. */
  publish?: boolean;
}

export interface FeedbackReceipt {
  id: string;
  createdAt: string;
}

/** GET /v1/feedback/review: the signed-in user's own review, to edit it. */
export interface MyReview {
  rating: number;
  message: string;
  displayName: string;
  role: string;
  publish: boolean;
  status: FeedbackStatus;
  updatedAt: string;
}

/** A review shown on the website. */
export interface PublicReview {
  id: string;
  rating: number;
  message: string;
  displayName: string;
  role: string;
  createdAt: string;
}

/** GET /v1/reviews */
export interface PublicReviews {
  reviews: PublicReview[];
  /** Over every approved, public review (not only the ones returned). */
  count: number;
  average: number | null;
}

export type FeedbackStatus = 'new' | 'approved' | 'hidden' | 'done';

export interface AdminFeedback {
  id: string;
  userId: string;
  userEmail: string;
  kind: FeedbackKind;
  rating: number | null;
  message: string;
  displayName: string;
  role: string;
  publish: boolean;
  status: FeedbackStatus;
  adminNote: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
