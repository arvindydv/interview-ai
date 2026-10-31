// Friday Jobs plans: how many applications Auto Apply sends a day and how many resumes a user keeps.
// Bought like the interview plans (one Razorpay payment for 30 days, extended by buying again), but a
// separate entitlement (users.jobs_plan). Prices are in paise.

export const JOBS_PLAN_IDS = ['basic', 'standard', 'premium'] as const;
export type JobsPlanId = (typeof JOBS_PLAN_IDS)[number];

export interface JobsPlan {
  id: JobsPlanId | 'free';
  name: string;
  /** Paise for 30 days; 0 for free. */
  amount: number;
  /** Auto Apply applications a day. */
  dailyApplications: number;
  /** Resumes: the main one plus role-specific ones. */
  resumes: number;
  highlights: string[];
}

export const JOBS_PLAN_DAYS = 30;

export const JOBS_PLANS: Record<JobsPlan['id'], JobsPlan> = {
  free: {
    id: 'free',
    name: 'Free',
    amount: 0,
    dailyApplications: 5,
    resumes: 1,
    highlights: ['5 applications a day', 'Resume tailored to every job', 'Cover letter for every job'],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    amount: 999_00,
    dailyApplications: 20,
    resumes: 1,
    highlights: ['20 applications a day', 'Resume tailored to every job', 'Cover letter for every job', 'Swipe review'],
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    amount: 2499_00,
    dailyApplications: 100,
    resumes: 5,
    highlights: ['100 applications a day', '5 resumes for different roles', 'Everything in Basic', 'Analytics'],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    amount: 6999_00,
    dailyApplications: 500,
    resumes: 10,
    highlights: ['500 applications a day', '10 resumes for different roles', 'Everything in Standard'],
  },
};

export const isJobsPlanId = (id: unknown): id is JobsPlanId => JOBS_PLAN_IDS.includes(id as JobsPlanId);

/** The user's plan as stored (users.jobs_plan, jobs_plan_expires_at), free once it has expired. */
export function activeJobsPlan(plan: string | null | undefined, expiresAt: Date | string | null | undefined): JobsPlan {
  if (!isJobsPlanId(plan) || !expiresAt || new Date(expiresAt).getTime() <= Date.now()) return JOBS_PLANS.free;
  return JOBS_PLANS[plan];
}

/** GET /v1/jobs-plan */
export interface JobsPlanStatus {
  plan: JobsPlan;
  expiresAt: string | null;
  plans: JobsPlan[];
}

/** A role-specific resume for job applications (GET /v1/job-resumes), besides the main resume. */
export interface JobResume {
  id: string;
  /** e.g. "Backend". */
  name: string;
  /** Job titles it's for; jobs whose title shares words with these are tailored from it. */
  targetRoles: string[];
  fileName: string;
  status: 'parsing' | 'ready' | 'failed';
  error: string | null;
  createdAt: string;
}

export interface JobResumeList {
  main: { fileName: string; status: 'parsing' | 'ready' | 'failed'; hasFile: boolean } | null;
  items: JobResume[];
  /** Resumes the plan allows in all, the main one included. */
  limit: number;
}
