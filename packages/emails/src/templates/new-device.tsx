import { Layout } from '../components/Layout.js';
import { Button, Callout, Details, Eyebrow, P, Title } from '../components/blocks.js';
import { brand } from '../theme.js';

export interface NewDeviceEmailProps {
  email: string;
  appUrl: string;
  os: string;
  osVersion?: string;
  appVersion?: string;
  /** Already formatted, e.g. "15 Oct 2026, 22:41 UTC". */
  when: string;
}

const osLabel: Record<string, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

export function NewDeviceEmail({ email, appUrl, os, osVersion, appVersion, when }: NewDeviceEmailProps) {
  const device = osVersion || osLabel[os] || os;
  return (
    <Layout
      appUrl={appUrl}
      preview={`New sign-in to ${brand.name} on ${device}`}
      footerNote={<>Security alert for {email}. We send these for every new device and can’t turn them off.</>}
    >
      <Eyebrow>Security alert</Eyebrow>
      <Title>New sign-in on {osLabel[os] ?? os}</Title>
      <P>Your {brand.name} account was just signed in to the desktop app on a new device.</P>
      <Details
        rows={[
          ['Device', device],
          ['App version', appVersion ? `v${appVersion}` : 'Unknown'],
          ['When', when],
          ['Account', email],
        ]}
      />
      <P>If this was you, there’s nothing else to do.</P>
      <Callout tone="warn">
        Don’t recognise this? Sign out of all devices from your dashboard and contact us right away by replying to this
        email.
      </Callout>
      <Button href={`${appUrl}/dashboard`}>Review account activity</Button>
    </Layout>
  );
}
