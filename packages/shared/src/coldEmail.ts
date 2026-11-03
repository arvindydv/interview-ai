// Friday Jobs cold email: an email to a company's recruiter or hiring manager about one job, written by
// the worker (apps/worker/src/queues/coldEmail.ts) and sent from the candidate's own Gmail by the API
// (apps/api/src/routes/coldEmail.ts) with their resume tailored to that job attached.

export type ColdEmailStatus = 'drafting' | 'ready' | 'sent' | 'failed';

/** Where a contact came from: the job description, the email finder (Hunter.io), or the candidate. */
export type ContactSource = 'posting' | 'finder' | 'user';

export interface ColdEmailContact {
  email: string;
  name: string | null;
  /** e.g. "Talent Acquisition Lead". */
  position: string | null;
  source: ContactSource;
  /** The finder's confidence that the address is right, 0–100. Null for the posting's own addresses. */
  confidence: number | null;
}

export interface ColdEmail {
  id: string;
  listingId: string | null;
  title: string;
  company: string;
  status: ColdEmailStatus;
  /** Hiring contacts found for the company, best first. The draft is addressed to the first one. */
  contacts: ColdEmailContact[];
  to: string | null;
  toName: string | null;
  subject: string;
  body: string;
  /** The resume's match with the job when the email was written, 0–100. */
  matchScore: number | null;
  /** The attached resume's file name: tailored to the job, or the candidate's own when tailoring failed. */
  attachment: string | null;
  attachmentTailored: boolean;
  error: string | null;
  sentAt: string | null;
  /** Opens the sent email in Gmail. */
  gmailUrl: string | null;
  updatedAt: string;
}

export interface GmailStatus {
  /** False until GOOGLE_CLIENT_ID/SECRET and GMAIL_TOKEN_KEY are set on the API. */
  available: boolean;
  /** The connected address, or null. */
  email: string | null;
  sentToday: number;
  dailyLimit: number;
}

export const COLD_EMAIL_LIMITS = {
  /** Emails sent a day per user. Well under Gmail's own limit, so cold email never looks like spam. */
  sendsPerDay: 20,
  /** Drafts written a day per user (each one is a model call, and maybe a tailoring and a finder lookup). */
  draftsPerDay: 40,
  /** Rewriting the same job's email waits this long. */
  retrySeconds: 30,
  /** A draft still 'drafting' after this is treated as lost (worker restart): it can be written again. */
  draftingSeconds: 600,
  maxSubjectChars: 200,
  maxBodyChars: 5000,
} as const;

/**
 * Addresses in job descriptions that are never a hiring contact: accommodation, privacy, security,
 * legal and the like. Cold-emailing them is wrong, and they're the most common addresses in postings.
 */
const NOT_HIRING =
  /accommodat|accessib|privacy|gdpr|dpo|security|legal|compliance|abuse|fraud|support|help|billing|press|media|invest|noreply|no-reply|donotreply|unsubscribe|ethics|whistle|benefits|payroll|disclos|sales|info|contact|operations|marketing|partner|^(name|first|firstname|your|you|user|someone|email)([._-]|$)/i;

/** Mailbox names that do take applications. */
const HIRING = /^(hr|hiring|jobs?|careers?|recruit(ing|ment|er|ers)?|talent|people|resumes?|cv|apply|applications?|join|work|hello|team)([._-].*)?$/i;

/** Words around an address that say it takes applications ("send your CV to priya@…"). */
const APPLY_CONTEXT = /\b(resume|résumé|cv|apply|applying|application|send|reach out|get in touch|interested|hiring)\b/i;
/** Words around an address that say it's for something else: accommodations, scam warnings, disability support. */
const OTHER_CONTEXT = /accommodat|disabilit|handicap|fraud|scam|phishing|impersonat|claiming to be|law enforcement|privacy|personal data|assistance/i;

/**
 * A hiring address from a job description, or null when the address is for something else.
 * `context` is the text just before the address: a person's address counts only when it says to apply there.
 */
export function hiringAddress(email: string, context = ''): string | null {
  const address = email.trim().toLowerCase().replace(/[.,;:)]+$/, '');
  const [local, domain] = address.split('@');
  if (!local || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  const mailbox = local.split('+')[0];
  if (NOT_HIRING.test(mailbox) || /(^|\.)(example|email|domain|company)\.com$/.test(domain)) return null;
  if (OTHER_CONTEXT.test(context)) return null;
  if (HIRING.test(mailbox) || /\b(hiring|recruit|careers?|jobs?)\b/.test(local.replace(/[+._-]/g, ' '))) return address;
  // A person's address: only when the posting says to send applications there.
  return /^[a-z]+([._-][a-z]+)?$/.test(mailbox) && APPLY_CONTEXT.test(context) ? address : null;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** The sentence an address is in, up to the address. */
function sentenceBefore(text: string, at: number) {
  const before = text.slice(Math.max(0, at - 300), at);
  const ends = [...before.matchAll(/[.!?](\s|$)|\n/g)];
  return ends.length ? before.slice(ends[ends.length - 1].index + 1) : before;
}

/** The hiring addresses in a job description, in order of appearance. */
export function postingContacts(description: string): string[] {
  const found = [...description.matchAll(EMAIL)].map((m) => hiringAddress(m[0], sentenceBefore(description, m.index)));
  return [...new Set(found.filter((e): e is string => e !== null))];
}

/** "Arvind" + "Yadav", without doubling a last name that's already in the first name field ("Arvind Yadav" + "Yadav"). */
export function senderName(first: string | null | undefined, last: string | null | undefined) {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (!l || f.toLowerCase().endsWith(l.toLowerCase())) return f;
  return f ? `${f} ${l}` : l;
}
