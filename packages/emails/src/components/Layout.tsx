import { Body, Column, Container, Font, Head, Html, Link, Preview, Row, Section, Text } from 'react-email';
import type { ReactNode } from 'react';
import { brand, color, font, gradient } from '../theme.js';

/** Logo built from HTML (no image), so it renders even when the client blocks remote images. */
export function Logo() {
  const bar = (h: number) => (
    <span
      style={{
        display: 'inline-block',
        width: '4px',
        height: `${h}px`,
        margin: '0 1.5px',
        borderRadius: '2px',
        backgroundColor: color.dark,
        verticalAlign: 'middle',
      }}
    />
  );
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
      <tbody>
        <tr>
          <td
            width={36}
            height={36}
            align="center"
            valign="middle"
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: color.cyan, backgroundImage: gradient, lineHeight: '36px' }}
          >
            {bar(10)}
            {bar(20)}
            {bar(13)}
          </td>
          <td style={{ paddingLeft: 10, fontFamily: font.sans, fontSize: 19, fontWeight: 700, color: color.ink, letterSpacing: '-0.3px' }}>
            {brand.name}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function Layout({
  preview,
  children,
  footerNote,
  appUrl,
}: {
  /** Base URL of the website, for footer links. */
  appUrl: string;
  /** Inbox preview line shown after the subject. */
  preview: string;
  children: ReactNode;
  /** Why the recipient got this email (security / compliance). */
  footerNote: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Helvetica"
          webFont={{ url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2', format: 'woff2' }}
          fontWeight={400}
          fontStyle="normal"
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, padding: '40px 12px', backgroundColor: color.page, fontFamily: font.sans }}>
        <Container style={{ maxWidth: 560, margin: '0 auto' }}>
          <Section style={{ padding: '0 8px 24px' }}>
            <Logo />
          </Section>

          <Section
            style={{
              backgroundColor: color.card,
              borderRadius: 18,
              border: `1px solid ${color.line}`,
              overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 12px 32px -12px rgba(16,24,40,0.12)',
            }}
          >
            {/* brand accent bar */}
            <Row>
              <Column style={{ height: 4, lineHeight: '4px', fontSize: 0, backgroundColor: color.brand, backgroundImage: gradient }}>
                &nbsp;
              </Column>
            </Row>
            <Section style={{ padding: '40px 40px 36px' }}>{children}</Section>
          </Section>

          <Section style={{ padding: '28px 16px 0', textAlign: 'center' }}>
            <Text style={{ margin: '0 0 8px', fontSize: 12, lineHeight: '18px', color: color.muted }}>{footerNote}</Text>
            <Text style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: color.faint }}>
              {brand.name} · {brand.tagline}
              <br />© {new Date().getFullYear()} {brand.company}.{' '}
              <Link href={`${appUrl}/privacy`} style={{ color: color.faint, textDecoration: 'underline' }}>
                Privacy
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
