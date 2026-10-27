import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '@/components/landing/legal';
import { company } from '@/lib/company';
import { pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Terms & Conditions',
  description: 'The terms that apply when you create a Friday AI account, use the app or buy a plan.',
  path: '/terms',
});

const sections: [string, string][] = [
  ['about', 'About these terms'],
  ['service', 'The service'],
  ['account', 'Your account'],
  ['use', 'Acceptable use'],
  ['ai', 'AI-generated answers'],
  ['payments', 'Plans and payments'],
  ['content', 'Your content'],
  ['ip', 'Our intellectual property'],
  ['third-party', 'Third-party services'],
  ['termination', 'Suspension and termination'],
  ['disclaimer', 'Disclaimers'],
  ['liability', 'Limitation of liability'],
  ['indemnity', 'Indemnity'],
  ['law', 'Governing law and disputes'],
  ['changes', 'Changes to these terms'],
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms & Conditions"
      intro={<p>Please read these terms before using Friday AI. By creating an account or using the app, you agree to them.</p>}
      sections={sections}
    >
      <LegalSection id="about" title="1. About these terms">
        <p>
          These Terms &amp; Conditions (&ldquo;Terms&rdquo;) are an agreement between you and{' '}
          <strong>{company.legalName}</strong>, an individual based in India who operates {company.brand}{' '}
          (&ldquo;{company.brand}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). They cover the {company.brand} website,
          the desktop app and every related service (together, the &ldquo;Service&rdquo;).
        </p>
        <p>
          Our <Link href="/privacy">Privacy Policy</Link> and <Link href="/refunds">Refund &amp; Cancellation Policy</Link>{' '}
          are part of these Terms. If you do not agree with them, please do not use the Service.
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. The service">
        <p>
          {company.brand} is AI software for interview preparation and assistance. Depending on your plan, it can transcribe
          the audio of a call you are on, suggest answers based on your resume and the job description, solve problems
          from screenshots you take, and run practice interviews.
        </p>
        <p>
          We are improving the Service all the time, so features may be added, changed or removed. We will try to tell you
          in advance about any change that significantly reduces what a paid plan includes.
        </p>
      </LegalSection>

      <LegalSection id="account" title="3. Your account">
        <ul>
          <li>You must be at least 18 years old and able to enter into a binding contract under Indian law.</li>
          <li>Give us an email address that you own and keep it up to date. We use it to sign you in and for billing.</li>
          <li>
            Keep your sign-in secure. You are responsible for everything done through your account. Tell us right away if
            you think someone else has access to it.
          </li>
          <li>
            Accounts are personal. Do not share, sell or transfer your account, and do not create accounts to get extra
            free trial minutes.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="use" title="4. Acceptable use">
        <p>
          <strong>You are responsible for how you use {company.brand}.</strong> Some employers, schools, exam bodies and
          interview platforms do not allow AI tools during interviews or assessments. It is up to you to know the rules of
          each process you take part in and to follow them, as well as any laws on recording or transcribing
          conversations. {company.brand} cannot tell whether a particular use is allowed.
        </p>
        <p>You agree not to:</p>
        <ul>
          <li>use the Service for anything illegal, fraudulent or harmful, or to impersonate anyone;</li>
          <li>transcribe or capture a conversation where the law requires a participant&rsquo;s consent and you do not have it;</li>
          <li>upload content you do not have the right to use, or content that is unlawful, abusive or infringing;</li>
          <li>
            reverse engineer, decompile, scrape or resell the Service, or work around usage metering, trial limits or
            security measures;
          </li>
          <li>overload, disrupt or try to gain unauthorised access to the Service or the systems behind it.</li>
        </ul>
      </LegalSection>

      <LegalSection id="ai" title="5. AI-generated answers">
        <p>
          Answers, transcripts and solutions are produced automatically by AI models and speech-to-text services. They can
          be incomplete, inaccurate or out of date. Treat them as suggestions and check them before you rely on them.
        </p>
        <p>
          We do not guarantee any result, including getting an interview, passing a round or receiving a job offer.
        </p>
      </LegalSection>

      <LegalSection id="payments" title="6. Plans and payments">
        <ul>
          <li>
            <strong>Free trial.</strong> Each person gets a one-time free allowance of live session minutes, shown on the{' '}
            <Link href="/pricing">pricing page</Link>, the first time they sign in to the desktop app. It is given once per
            person, email address and computer, and not to temporary email addresses. No payment details are needed for the
            trial.
          </li>
          <li>
            <strong>Paid plans.</strong> You can pay per minute of live session time or buy a monthly or yearly plan. The
            current prices are on the pricing page. Prices are in Indian rupees (INR), and any applicable taxes are shown at
            checkout before you pay.
          </li>
          <li>
            <strong>Metering.</strong> Billable time is the time a live session is running. It is measured by our servers,
            and our records are final unless they are clearly wrong.
          </li>
          <li>
            <strong>Payment processing.</strong> Payments are processed by Razorpay Software Private Limited. We never see
            or store your full card, UPI or bank details. Your payment is also subject to Razorpay&rsquo;s terms.
          </li>
          <li>
            <strong>Plan period.</strong> A monthly plan lasts 30 days and a yearly plan lasts 365 days from the time the
            payment succeeds. Plans do not renew automatically unless you set up a recurring payment and we tell you so
            at checkout.
          </li>
          <li>
            <strong>Price changes.</strong> We may change prices. A change does not affect a plan or minutes you have
            already paid for.
          </li>
          <li>
            <strong>Refunds.</strong> Cancellations and refunds follow our{' '}
            <Link href="/refunds">Refund &amp; Cancellation Policy</Link>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="7. Your content">
        <p>
          You own the resumes, job descriptions, questions and other material you add to the Service (&ldquo;Your
          Content&rdquo;). You give us a limited licence to store and process Your Content only to provide the Service to
          you, including sending it to the AI and speech-to-text providers listed in our{' '}
          <Link href="/privacy">Privacy Policy</Link>. We do not sell Your Content.
        </p>
        <p>You are responsible for making sure you have the right to use Your Content with the Service.</p>
      </LegalSection>

      <LegalSection id="ip" title="8. Our intellectual property">
        <p>
          The Service, including its software, design, logo and the {company.brand} name, belongs to us and our licensors.
          We give you a personal, non-exclusive, non-transferable right to use the Service under these Terms, for as long
          as your account is in good standing. We keep all other rights.
        </p>
      </LegalSection>

      <LegalSection id="third-party" title="9. Third-party services">
        <p>
          The Service relies on third parties for hosting, sign-in, speech-to-text, AI models and payments. Their
          availability affects ours, and we are not responsible for services we do not control. Links to other websites
          are only for convenience.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="10. Suspension and termination">
        <p>
          You can stop using the Service at any time, and you can ask us to delete your account by writing to{' '}
          <a href={`mailto:${company.email}`}>{company.email}</a>.
        </p>
        <p>
          We may suspend or close an account that breaks these Terms, misuses the free trial, or puts the Service or other
          users at risk. Where reasonable, we will tell you first and give you a chance to fix the problem. If we close
          your account without a breach on your part, we will refund the unused part of any paid plan or prepaid minutes.
        </p>
      </LegalSection>

      <LegalSection id="disclaimer" title="11. Disclaimers">
        <p>
          To the extent the law allows, the Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We do
          not promise that it will be uninterrupted, error-free or suitable for a particular purpose. Features such as
          hiding the overlay from screen sharing depend on your operating system and the app you share from, and may not
          work in every setup.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="12. Limitation of liability">
        <p>
          To the extent the law allows, we are not liable for indirect, incidental, special or consequential losses, such
          as lost opportunities, lost income or lost data. Our total liability for any claim relating to the Service is
          limited to the amount you paid us in the three months before the event that gave rise to the claim.
        </p>
        <p>Nothing in these Terms limits liability that cannot be limited under Indian law.</p>
      </LegalSection>

      <LegalSection id="indemnity" title="13. Indemnity">
        <p>
          You agree to compensate us for claims, losses and reasonable costs that arise from your breach of these Terms or
          your misuse of the Service, including use that breaks the rules of a third party or the law.
        </p>
      </LegalSection>

      <LegalSection id="law" title="14. Governing law and disputes">
        <p>
          These Terms are governed by the laws of India. Please contact us first so we can try to resolve any issue
          informally. If a dispute cannot be resolved, the courts at {company.jurisdiction}, India, have exclusive
          jurisdiction.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="15. Changes to these terms">
        <p>
          We may update these Terms from time to time. The date at the top of this page shows the latest version. If a
          change is significant, we will tell you by email or in the app before it takes effect. If you keep using the
          Service after a change, you accept the updated Terms.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
