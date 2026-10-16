// Supabase Auth emails. Supabase renders these with Go templates, so the default props are Go
// placeholders; scripts/build-supabase.ts writes them to supabase/templates/*.html.
// The preview script passes real-looking values instead.

import { Layout } from '../components/Layout.js';
import { Button, Callout, CodeBox, Divider, Eyebrow, FallbackLink, P, Title } from '../components/blocks.js';
import { brand, color } from '../theme.js';

export interface AuthEmailProps {
  token?: string;
  confirmationUrl?: string;
  siteUrl?: string;
  email?: string;
  newEmail?: string;
}

const go = {
  token: '{{ .Token }}',
  confirmationUrl: '{{ .ConfirmationURL }}',
  siteUrl: '{{ .SiteURL }}',
  email: '{{ .Email }}',
  newEmail: '{{ .NewEmail }}',
} satisfies Required<AuthEmailProps>;

const notYou = 'If you didn’t request this, you can safely ignore this email. Your account stays secure.';

/** Sign-in for an existing user (Supabase "magic_link" template), used by email-code sign-in. */
export function SignInEmail(props: AuthEmailProps) {
  const p = { ...go, ...props };
  return (
    <Layout appUrl={p.siteUrl} preview={`Your ${brand.name} sign-in code is ${p.token}`} footerNote={<>Sent to {p.email} because someone asked to sign in. {notYou}</>}>
      <Eyebrow>Sign in</Eyebrow>
      <Title>Your sign-in code</Title>
      <P>
        Enter this code in the {brand.name} window to finish signing in. It expires in 60 minutes, works once, and
        replaces any code we sent you before.
      </P>
      <CodeBox code={p.token} caption={`For ${p.email} · Never share this code. ${brand.name} will never ask you for it.`} />
      <Divider />
      <P style={{ fontSize: 14, color: color.muted, margin: '0 0 4px' }}>Signing in on this device? Skip the code:</P>
      <Button href={p.confirmationUrl}>Sign in to {brand.name}</Button>
    </Layout>
  );
}

/** First sign-in of a new account (Supabase "confirmation" template). */
export function ConfirmSignupEmail(props: AuthEmailProps) {
  const p = { ...go, ...props };
  return (
    <Layout appUrl={p.siteUrl} preview={`Welcome to ${brand.name}: your code is ${p.token}`} footerNote={<>Sent to {p.email} because this address was used to create a {brand.name} account. {notYou}</>}>
      <Eyebrow>Welcome aboard</Eyebrow>
      <Title>Confirm your email</Title>
      <P>
        You’re one step away from walking into interviews with a real-time copilot. Enter this code to confirm{' '}
        <strong style={{ color: color.ink }}>{p.email}</strong> and create your account.
      </P>
      <CodeBox code={p.token} caption={`For ${p.email} · Expires in 60 minutes`} />
      <Divider />
      <P style={{ fontSize: 14, color: color.muted, margin: '0 0 4px' }}>Or confirm with one click:</P>
      <Button href={p.confirmationUrl}>Confirm my email</Button>
    </Layout>
  );
}

/** Supabase "email_change" template. Sent to the new address. */
export function EmailChangeEmail(props: AuthEmailProps) {
  const p = { ...go, ...props };
  return (
    <Layout appUrl={p.siteUrl} preview={`Confirm your new ${brand.name} email address`} footerNote={<>Sent because someone asked to change the email on a {brand.name} account. {notYou}</>}>
      <Eyebrow>Account security</Eyebrow>
      <Title>Confirm your new email</Title>
      <P>
        You asked to change your {brand.name} email from <strong style={{ color: color.ink }}>{p.email}</strong> to{' '}
        <strong style={{ color: color.ink }}>{p.newEmail}</strong>. Enter this code to confirm:
      </P>
      <CodeBox code={p.token} caption="Expires in 60 minutes" />
      <Button href={p.confirmationUrl}>Confirm email change</Button>
      <Callout tone="warn">Didn’t ask for this? Don’t confirm. Sign in and review your account security.</Callout>
    </Layout>
  );
}

/** Supabase "reauthentication" template, for sensitive actions. */
export function ReauthenticationEmail(props: AuthEmailProps) {
  const p = { ...go, ...props };
  return (
    <Layout appUrl={p.siteUrl} preview={`Your ${brand.name} verification code is ${p.token}`} footerNote={<>Sent to {p.email}. {notYou}</>}>
      <Eyebrow>Verify it’s you</Eyebrow>
      <Title>Confirm this action</Title>
      <P>You’re making a sensitive change to your account. Enter this code to continue.</P>
      <CodeBox code={p.token} caption="Expires in 60 minutes" />
      <Callout tone="warn">If you didn’t start this, someone may know your sign-in details. Sign out of all devices.</Callout>
    </Layout>
  );
}

/** Supabase "invite" template, for team or college invites (Growth). */
export function InviteEmail(props: AuthEmailProps) {
  const p = { ...go, ...props };
  return (
    <Layout appUrl={p.siteUrl} preview={`You’ve been invited to ${brand.name}`} footerNote={<>Sent to {p.email} because someone invited you to {brand.name}. Not expecting it? Ignore this email.</>}>
      <Eyebrow>You’re invited</Eyebrow>
      <Title>Join {brand.name}</Title>
      <P>You’ve been invited to {brand.name}, the real-time AI copilot that helps you answer interview questions with confidence.</P>
      <Button href={p.confirmationUrl}>Accept invitation</Button>
      <FallbackLink href={p.confirmationUrl} />
    </Layout>
  );
}

/** Supabase "recovery" template. Parakeet is passwordless, but this keeps the flow branded if enabled. */
export function RecoveryEmail(props: AuthEmailProps) {
  const p = { ...go, ...props };
  return (
    <Layout appUrl={p.siteUrl} preview={`Recover access to your ${brand.name} account`} footerNote={<>Sent to {p.email}. {notYou}</>}>
      <Eyebrow>Account recovery</Eyebrow>
      <Title>Recover your account</Title>
      <P>Use this code or the button below to get back into {brand.name}.</P>
      <CodeBox code={p.token} caption="Expires in 60 minutes" />
      <Button href={p.confirmationUrl}>Recover account</Button>
    </Layout>
  );
}

/** Supabase template key → component + subject. */
export const supabaseTemplates = {
  // Code-first subjects: every email gets a unique subject, so Gmail never threads an old code above
  // the new one, and the code is readable straight from the notification.
  magic_link: { component: SignInEmail, subject: `${go.token} is your ${brand.name} sign-in code` },
  confirmation: { component: ConfirmSignupEmail, subject: `${go.token} is your ${brand.name} confirmation code` },
  email_change: { component: EmailChangeEmail, subject: `${go.token} is your code to confirm your new ${brand.name} email` },
  reauthentication: { component: ReauthenticationEmail, subject: `${go.token} is your ${brand.name} verification code` },
  invite: { component: InviteEmail, subject: `You’ve been invited to ${brand.name}` },
  recovery: { component: RecoveryEmail, subject: `${go.token} is your ${brand.name} recovery code` },
} as const;
