import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '@/components/landing/legal';
import { company } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy · Friday AI',
  description: 'How cancellations and refunds work for Friday AI pay-per-minute, monthly and yearly plans.',
};

/** A plan bought within this many days, with at most REFUND_MAX_MINUTES used, is fully refundable. */
const REFUND_DAYS = 7;
const REFUND_MAX_MINUTES = 30;

const sections: [string, string][] = [
  ['trial', 'Try before you pay'],
  ['cancel', 'Cancelling a plan'],
  ['refunds', 'When you can get a refund'],
  ['not', 'When refunds are not given'],
  ['how', 'How to request a refund'],
  ['timeline', 'Refund timelines'],
];

export default function RefundsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Refund & Cancellation Policy"
      intro={<p>We want you to pay only for what is useful to you. Here is how cancelling and refunds work for each plan.</p>}
      sections={sections}
    >
      <LegalSection id="trial" title="1. Try before you pay">
        <p>
          Every new account gets free live session minutes, with no card needed. Please use them to check that{' '}
          {company.brand} works with your computer, your call app and your interview setup before you buy a plan. See the{' '}
          <Link href="/pricing">pricing page</Link> for the current allowance.
        </p>
      </LegalSection>

      <LegalSection id="cancel" title="2. Cancelling a plan">
        <ul>
          <li>
            <strong>Pay per minute:</strong> there is nothing to cancel. You pay only for the minutes you buy, and you can
            stop using them at any time.
          </li>
          <li>
            <strong>Monthly and yearly plans:</strong> each plan is a single payment for a fixed period (30 or 365 days) and
            does not renew automatically, so you do not need to cancel anything to avoid future charges. If you set up a
            recurring payment, you can cancel it at any time by emailing us. The plan then stays
            active until the end of the period you have paid for, and you will not be charged again.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="refunds" title="3. When you can get a refund">
        <ul>
          <li>
            <strong>Change of mind:</strong> you get a full refund of a purchase if you ask within {REFUND_DAYS} days of
            paying and have used no more than {REFUND_MAX_MINUTES} minutes of live session time since then. This applies
            to a minute pack, a monthly plan or a yearly plan, and to one purchase per account.
          </li>
          <li>
            <strong>Duplicate or failed payments:</strong> if you were charged twice, or money was taken from your account
            but the plan or minutes were not added, we refund the extra or failed amount in full.
          </li>
          <li>
            <strong>Problems on our side:</strong> if a session failed because of a fault with {company.brand}, not your
            internet connection or setup, we will add back the minutes you lost. If we cannot fix the problem, we will
            refund the affected amount.
          </li>
          <li>
            <strong>Account closed by us:</strong> if we close your account when you have not broken our{' '}
            <Link href="/terms">Terms</Link>, we refund the unused part of your plan or prepaid minutes.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="not" title="4. When refunds are not given">
        <ul>
          <li>Minutes that have already been used, apart from the cases above.</li>
          <li>The unused part of a monthly or yearly plan once the {REFUND_DAYS}-day refund window has passed.</li>
          <li>Accounts suspended for breaking our Terms, including misuse of the free trial.</li>
          <li>
            Dissatisfaction with the result of an interview. AI answers are suggestions, and we cannot guarantee an outcome.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="how" title="5. How to request a refund">
        <p>
          Email <a href={`mailto:${company.email}`}>{company.email}</a> from the address on your account and include:
        </p>
        <ul>
          <li>the date and amount of the payment;</li>
          <li>the Razorpay payment ID (it starts with <code className="text-fg">pay_</code>) from your receipt, if you have it;</li>
          <li>a short reason for the request.</li>
        </ul>
        <p>We will reply within {company.responseDays} working days to tell you whether the refund is approved.</p>
      </LegalSection>

      <LegalSection id="timeline" title="6. Refund timelines">
        <p>
          Approved refunds are sent back to the payment method you used, through Razorpay, within{' '}
          <strong>5 to 7 working days</strong> of approval. Your bank or card issuer may take a few more days to show the
          money in your account. UPI refunds usually arrive sooner.
        </p>
        <p>
          When a refund is processed, the refunded plan or minutes are removed from your account. We cannot refund to a
          different account or payment method.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
