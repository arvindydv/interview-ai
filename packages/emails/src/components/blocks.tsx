import { Button as EmailButton, Heading, Hr, Section, Text } from 'react-email';
import type { CSSProperties, ReactNode } from 'react';
import { color, font } from '../theme.js';

export function Title({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h1"
      style={{ margin: '0 0 12px', fontSize: 26, lineHeight: '34px', fontWeight: 700, color: color.ink, letterSpacing: '-0.5px' }}
    >
      {children}
    </Heading>
  );
}

export function P({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <Text style={{ margin: '0 0 16px', fontSize: 15, lineHeight: '24px', color: color.body, ...style }}>{children}</Text>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        margin: '0 0 10px',
        fontSize: 11,
        lineHeight: '16px',
        fontWeight: 700,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: color.brandDark,
      }}
    >
      {children}
    </Text>
  );
}

/** One-time code, large and easy to copy. Monospace with wide tracking so digits never blur together. */
export function CodeBox({ code, caption }: { code: string; caption?: string }) {
  return (
    <Section
      style={{
        margin: '28px 0',
        padding: '22px 16px',
        textAlign: 'center',
        borderRadius: 14,
        backgroundColor: color.brandTint,
        border: `1px solid ${color.brandLine}`,
      }}
    >
      <Text
        style={{
          margin: 0,
          fontFamily: font.mono,
          fontSize: 36,
          lineHeight: '44px',
          fontWeight: 700,
          letterSpacing: '10px',
          color: color.ink,
          paddingLeft: 10, // balances the trailing letter-spacing
        }}
      >
        {code}
      </Text>
      {caption && <Text style={{ margin: '8px 0 0', fontSize: 12, lineHeight: '18px', color: color.muted }}>{caption}</Text>}
    </Section>
  );
}

export function Button({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: '28px 0' }}>
      <EmailButton
        href={href}
        style={{
          display: 'inline-block',
          padding: '14px 26px',
          borderRadius: 12,
          backgroundColor: color.dark,
          color: '#ffffff',
          fontSize: 15,
          fontWeight: 600,
          lineHeight: '20px',
          textDecoration: 'none',
        }}
      >
        {children}
      </EmailButton>
    </Section>
  );
}

/** Raw URL under a button, for clients that strip buttons or users who prefer to paste. */
export function FallbackLink({ href }: { href: string }) {
  return (
    <Text style={{ margin: '-12px 0 24px', fontSize: 12, lineHeight: '18px', color: color.muted, wordBreak: 'break-all' }}>
      Button not working? Paste this link into your browser:
      <br />
      <span style={{ color: color.brandDark }}>{href}</span>
    </Text>
  );
}

export function Callout({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' }) {
  const warn = tone === 'warn';
  return (
    <Section
      style={{
        margin: '8px 0 0',
        padding: '14px 16px',
        borderRadius: 12,
        backgroundColor: warn ? color.warnTint : '#f7f8fb',
        border: `1px solid ${warn ? color.warnLine : color.line}`,
      }}
    >
      <Text style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: warn ? color.warnInk : color.body }}>{children}</Text>
    </Section>
  );
}

export function Divider() {
  return <Hr style={{ margin: '28px 0', border: 'none', borderTop: `1px solid ${color.line}` }} />;
}

/** Label/value rows, e.g. sign-in details in a security alert. */
export function Details({ rows }: { rows: [string, string][] }) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: '20px 0', borderCollapse: 'separate', border: `1px solid ${color.line}`, borderRadius: 12 }}
    >
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={label}>
            <td
              style={{
                padding: '12px 16px',
                fontSize: 13,
                color: color.muted,
                borderTop: i ? `1px solid ${color.line}` : 'none',
                width: '38%',
              }}
            >
              {label}
            </td>
            <td
              style={{
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: color.ink,
                borderTop: i ? `1px solid ${color.line}` : 'none',
              }}
            >
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
