import type { FormQuestion, PreparedAnswer } from '@parakeet/shared';

// One application sent through an ATS's own application API with a credential the employer (or a
// partner) granted us. Connectors are pure request/response translators: they never touch the database,
// never retry, and never log the credential. queues/submit.ts decides what each outcome means.

export interface SubmissionTask {
  applicationId: string;
  provider: string;
  /** job_sources.board: the employer's board/site token. */
  board: string;
  /** job_listings.external_id: the ATS's posting id. */
  externalId: string;
  title: string;
  company: string;
  form: FormQuestion[];
  answers: PreparedAnswer[];
  /** From the Application Profile, for fields the form didn't list. */
  candidate: { firstName: string; lastName: string; email: string; phone: string; city: string; country: string; linkedin: string; github: string; portfolio: string; website: string };
}

export interface SubmissionFile {
  name: string;
  mime: string;
  data: Buffer;
}

export interface SubmissionFiles {
  resume: SubmissionFile;
  coverLetter: SubmissionFile | null;
}

export type FailureCode =
  /** The ATS rejected a field (400/422 or an error body). It does not have the application. */
  | 'validation'
  /** The form needs something this API can't carry (custom questions Lever's API doesn't take…). Not sent. */
  | 'unsupported_form'
  /** 401/403: the credential is wrong, revoked or lacks permission. Not sent. */
  | 'auth'
  /** 404/410 or "not published": the job is gone. */
  | 'closed'
  /** 409 or "already applied": the candidate already has an application there. */
  | 'duplicate'
  /** 429. Not sent; retry after retryAfterMs. */
  | 'rate_limited'
  /** 500/503: the ATS failed before taking it. Retryable. */
  | 'server'
  /** The connection never got the request through (DNS, refused, TLS). Retryable. */
  | 'network';

export type SubmitResult =
  | { outcome: 'submitted'; externalId: string | null; httpStatus: number; evidence: string }
  | {
      outcome: 'failed';
      code: FailureCode;
      httpStatus: number | null;
      retryable: boolean;
      message: string;
      retryAfterMs?: number;
      /** Form keys the ATS named as invalid or missing. */
      fields?: string[];
    }
  /** The request may have reached the ATS (timeout after sending, reset, 502/504): never resent automatically. */
  | { outcome: 'uncertain'; httpStatus: number | null; message: string };

export interface SubmitOptions {
  /** Sent where the vendor supports one (none of the four documents an idempotency header as of 2026-11). */
  idempotencyKey: string;
  /** Aborts before the request is sent (user cancellation). */
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface AtsConnector {
  provider: string;
  /** Minimum gap between two submissions to this provider from one worker process. */
  minIntervalMs: number;
  timeoutMs: number;
  submit(task: SubmissionTask, files: SubmissionFiles, secret: string, opts: SubmitOptions): Promise<SubmitResult>;
}
