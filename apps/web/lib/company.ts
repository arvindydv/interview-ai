// Business and contact details shown on the legal and contact pages (and checked by Razorpay during
// account activation). They must match the Razorpay KYC exactly: for an individual account, the
// legal name is your full name as printed on your PAN card.

export const company = {
  brand: 'Friday AI',
  legalName: 'Arvind Kumar Yadav',
  email: 'support@friday-ai.in',
  phone: '+91 6396510275',
  address: ['F94 M block', 'New Palam Vihar', 'Haryana 122017', 'India'],
  /** City whose courts have jurisdiction over disputes (Terms § Governing law). */
  jurisdiction: 'Gurugram',
  /** Grievance Officer under the IT Rules, 2021 and the DPDP Act, 2023. Usually you, for an individual account. */
  grievanceOfficer: 'Arvind Kumar Yadav',
  supportHours: 'Monday to Saturday, 10:00 am to 6:00 pm IST',
  /** Working days we take to reply to support email. */
  responseDays: 2,
} as const;

/** Shown as "Last updated" on every legal page. Bump it whenever a policy changes. */
export const LEGAL_UPDATED = '21 October 2026';
