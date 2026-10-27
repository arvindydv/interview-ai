import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '@/components/landing/legal';
import { company } from '@/lib/company';
import { pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Privacy Policy',
  description: 'What Friday AI collects, why, who processes it, how long it is kept and how to control it. Audio is never recorded or stored.',
  path: '/privacy',
});

const sections: [string, string][] = [
  ['who', 'Who we are'],
  ['collect', 'What we collect'],
  ['use', 'How we use it'],
  ['processors', 'Who processes it'],
  ['retention', 'How long we keep it'],
  ['rights', 'Your rights'],
  ['security', 'Security'],
  ['cookies', 'Cookies and local storage'],
  ['children', 'Children'],
  ['changes', 'Changes to this policy'],
  ['grievance', 'Grievance Officer'],
];

const processors = [
  ['Supabase', 'Sign-in, account database and hosting of your account data'],
  ['Deepgram', 'Speech-to-text: turns the call audio into text in real time'],
  ['Anthropic and OpenRouter', 'AI models that write answers from your question, profile and screenshots'],
  ['Razorpay', 'Payment processing for paid plans'],
  ['Our email provider', 'Sign-in codes and account emails'],
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      intro={<p>What we collect, why we collect it, and the control you have over it, written in plain language.</p>}
      sections={sections}
    >
      <LegalSection id="who" title="1. Who we are">
        <p>
          {company.brand} is operated by <strong>{company.legalName}</strong>, an individual based in India
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;). We are the data fiduciary for your personal data under India&rsquo;s
          Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000 and its rules.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="2. What we collect">
        <ul>
          <li>
            <strong>Account details:</strong> your email address, how you sign in, your plan, and when you created your
            account.
          </li>
          <li>
            <strong>Interview profile:</strong> resumes you upload, the profile we build from them (skills, roles,
            projects, stories), and the company, role and job description you enter for each interview.
          </li>
          <li>
            <strong>Live session audio:</strong> while a live session is running, call audio is streamed to our
            speech-to-text provider to be transcribed. <strong>We do not record or store the audio.</strong>
          </li>
          <li>
            <strong>Questions and answers:</strong> the questions detected or typed during a session, the answers
            generated for them, and the AI model used. Screenshots you take are sent to the AI provider to answer the
            question. We keep only the number of screenshots, not the images.
          </li>
          <li>
            <strong>Usage and device data:</strong> session start and end times, minutes used, your operating system and
            version, and the app version. We use these for metering, trial limits and compatibility. To give one free trial
            per computer, the desktop app also sends a one-way hash of your computer&rsquo;s system ID, and we keep a
            one-way hash of the network address it was claimed from. Neither can be turned back into the original.
          </li>
          <li>
            <strong>Payment records:</strong> the plan you bought, the amount, the payment status, and Razorpay&rsquo;s
            order and payment IDs. Card, UPI and bank details go directly to Razorpay. We never receive or store them.
          </li>
          <li>
            <strong>Messages to us:</strong> anything you send when you contact support.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="use" title="3. How we use it">
        <ul>
          <li>to provide the Service: transcribe questions, generate answers that fit your profile, and run practice sessions;</li>
          <li>to meter session time, apply the free trial, and process payments and refunds;</li>
          <li>to keep the Service secure, prevent abuse of the free trial, and fix bugs;</li>
          <li>to send sign-in codes and important notices about your account, billing or these policies;</li>
          <li>to understand overall usage so we can improve the product.</li>
        </ul>
        <p>
          We process your data based on the consent you give when you create an account and use the Service, and where it
          is needed to meet a legal obligation. <strong>We do not sell your personal data</strong>, and we do not use it
          for advertising. We do not use your resumes, questions or answers to train our own AI models.
        </p>
      </LegalSection>

      <LegalSection id="processors" title="4. Who processes it">
        <p>
          We share data only with the service providers we need to run {company.brand}. They process it on our behalf,
          only for the purposes listed here.
        </p>
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface/60 text-fg">
              <tr>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {processors.map(([name, purpose]) => (
                <tr key={name}>
                  <td className="px-4 py-3 align-top text-fg">{name}</td>
                  <td className="px-4 py-3">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Some of these providers process data outside India. We may also disclose data when the law requires it, for
          example in response to a valid order from a court or government authority.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="5. How long we keep it">
        <ul>
          <li>We keep account, profile and session data while your account is open.</li>
          <li>
            You choose how long we keep the questions and answers from your live sessions (Settings, Privacy &amp; history):
            not at all, 7, 30 or 90 days, or until you delete them. Text older than your choice is deleted within 24 hours.
            Usage time is kept for billing. You can delete your history, or all your data, at any time.
          </li>
          <li>When you delete a resume, we delete it from our database.</li>
          <li>
            When you ask us to delete your account, we delete your account and everything linked to it within 30 days.
          </li>
          <li>
            We keep payment records for as long as Indian tax and accounting laws require, even after your account is
            deleted.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="rights" title="6. Your rights">
        <p>Under the Digital Personal Data Protection Act, 2023, you can:</p>
        <ul>
          <li>ask for a summary of the personal data we hold about you and how we use it;</li>
          <li>correct or update data that is wrong or incomplete;</li>
          <li>withdraw your consent and have your data erased. You will no longer be able to use the Service;</li>
          <li>nominate someone to exercise these rights for you if you die or become unable to act;</li>
          <li>raise a grievance with us, and then with the Data Protection Board of India if you are not satisfied.</li>
        </ul>
        <p>
          To use any of these rights, email <a href={`mailto:${company.email}`}>{company.email}</a> from the address on
          your account. We will reply within 30 days.
        </p>
      </LegalSection>

      <LegalSection id="security" title="7. Security">
        <p>
          Data is encrypted in transit over HTTPS. Access to our database is restricted, and the desktop app stores your
          sign-in tokens in your operating system&rsquo;s keychain. No system is perfectly secure. If a breach affects your
          personal data, we will tell you and the authorities as the law requires.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="8. Cookies and local storage">
        <p>
          We use only the cookies and browser storage needed to keep you signed in and remember your settings. We do not
          use advertising or third-party tracking cookies. Razorpay&rsquo;s checkout may set its own cookies when you pay.
        </p>
      </LegalSection>

      <LegalSection id="children" title="9. Children">
        <p>
          {company.brand} is only for people aged 18 and over. We do not knowingly collect data from children. If you
          believe a child has given us personal data, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="10. Changes to this policy">
        <p>
          We will update this policy when our practices change, and the date at the top of the page shows the latest
          version. If a change is significant, we will tell you by email or in the app.
        </p>
      </LegalSection>

      <LegalSection id="grievance" title="11. Grievance Officer">
        <p>
          Under the Information Technology Act, 2000, its rules, and the Digital Personal Data Protection Act, 2023, our
          Grievance Officer is:
        </p>
        <p>
          <strong>{company.grievanceOfficer}</strong>
          <br />
          Email: <a href={`mailto:${company.email}`}>{company.email}</a>
          <br />
          Address: {company.address.join(', ')}
        </p>
        <p>We acknowledge a grievance within 24 hours and try to resolve it within 15 days.</p>
      </LegalSection>
    </LegalPage>
  );
}
