import { Column, Row, Section, Text } from 'react-email';
import { Layout } from '../components/Layout.js';
import { Button, Divider, Eyebrow, P, Title } from '../components/blocks.js';
import { brand, color, font } from '../theme.js';

export interface WelcomeEmailProps {
  name: string;
  email: string;
  appUrl: string;
}

const steps = [
  ['Install the desktop app', 'Windows, macOS and Linux. Sign in once with this account.'],
  ['Add your resume', 'Your projects and STAR stories make every answer sound like you.'],
  ['Set up your interview', 'Paste the job description. We prepare everything before the call.'],
];

export function WelcomeEmail({ name, email, appUrl }: WelcomeEmailProps) {
  return (
    <Layout
      appUrl={appUrl}
      preview={`Welcome to ${brand.name}. Here’s how to get ready for your next interview in 3 steps.`}
      footerNote={<>You’re receiving this because you created a {brand.name} account with {email}.</>}
    >
      <Eyebrow>Welcome</Eyebrow>
      <Title>You’re in, {name}.</Title>
      <P>
        {brand.name} listens to your interview, spots each question and puts a clear, personal answer on a private overlay
        in under a second. Here’s how to be ready before your next call:
      </P>

      <Section style={{ margin: '24px 0 8px' }}>
        {steps.map(([title, body], i) => (
          <Row key={title} style={{ marginBottom: 14 }}>
            <Column width={44} valign="top">
              <Text
                style={{
                  margin: 0,
                  width: 30,
                  height: 30,
                  lineHeight: '30px',
                  borderRadius: 15,
                  textAlign: 'center',
                  fontFamily: font.mono,
                  fontSize: 13,
                  fontWeight: 700,
                  color: color.brandDark,
                  backgroundColor: color.brandTint,
                  border: `1px solid ${color.brandLine}`,
                }}
              >
                {i + 1}
              </Text>
            </Column>
            <Column valign="top">
              <Text style={{ margin: '4px 0 2px', fontSize: 15, fontWeight: 600, color: color.ink }}>{title}</Text>
              <Text style={{ margin: 0, fontSize: 14, lineHeight: '21px', color: color.muted }}>{body}</Text>
            </Column>
          </Row>
        ))}
      </Section>

      <Button href={`${appUrl}/dashboard`}>Open your dashboard</Button>
      <Divider />
      <P style={{ fontSize: 14, color: color.muted, margin: 0 }}>
        Questions or feedback? Just reply to this email. A real person reads every message.
      </P>
    </Layout>
  );
}
