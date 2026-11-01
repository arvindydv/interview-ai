import { createRequire } from 'node:module';
import type { ReactNode } from 'react';
import { Circle, Defs, Font, G, LinearGradient, Path, Rect, Stop, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { scoreOutOf10 } from '@parakeet/shared';

// The pieces every Friday PDF report shares (practice debriefs, lib/practiceReport.tsx, and real
// interview feedback, lib/interviewReport.tsx): the site's font and light theme, the masthead logo,
// the brand band, the footer with page numbers, and the score widgets.

const require = createRequire(import.meta.url);
Font.register({
  family: 'Inter',
  fonts: ([400, 500, 600, 700] as const).map((fontWeight) => ({
    src: require.resolve(`@fontsource/inter/files/inter-latin-${fontWeight}-normal.woff`),
    fontWeight,
  })),
});
// Whole words only: the default splits words at any syllable.
Font.registerHyphenationCallback((word) => [word]);

/** The light theme (apps/web, app/globals.css). */
/**
 * Text as the report's font can print it. The font carries Latin only, and models write narrow and
 * non-breaking spaces and non-breaking hyphens (U+202F, U+2011…), which would vanish and run words
 * together ("withEXPLAINto"). Applied to every string in a report's data.
 */
export function printable<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ').replace(/[\u2010\u2011]/g, '-').replace(/[\u200b-\u200d\u2060\ufeff]/g, '') as T;
  }
  if (Array.isArray(value)) return value.map(printable) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, printable(v)])) as T;
  return value;
}

export const C = {
  ink: '#0b1220',
  body: '#273247',
  muted: '#526077',
  faint: '#8590a3',
  line: '#e3e8f0',
  panel: '#f5f7fb',
  brand: '#059669',
  brandBright: '#10b981',
  brand2: '#0891b2',
  cyan: '#06b6d4',
  accent: '#7c3aed',
  violet: '#8b5cf6',
  warn: '#b45309',
  brandTint: '#ecfdf5',
  warnTint: '#fff7ed',
  cyanTint: '#ecfeff',
};

export const scoreLabel = (score: number) => (score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 45 ? 'Getting there' : 'Needs practice');
/** Colour for a 0–100 score. */
export const tone = (score: number) => (score >= 65 ? C.brand : score >= 45 ? C.brand2 : C.warn);
export const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const s = StyleSheet.create({
  page: { fontFamily: 'Inter', fontSize: 9.5, color: C.body, paddingTop: 46, paddingBottom: 54, paddingHorizontal: 42 },
  // Line height goes on each paragraph: set on the page (or a View) it hides react-pdf's page-number text.
  // A unitless lineHeight scales the Text's own fontSize (react-pdf's default 18 if only inherited), so both are set.
  p: { fontSize: 9.5, lineHeight: 1.5 },
  band: { position: 'absolute', top: 0, left: 0, right: 0 },
  footer: { position: 'absolute', bottom: 24, fontSize: 7.5, color: C.faint },
  eyebrow: { fontSize: 7.5, fontWeight: 600, color: C.muted, letterSpacing: 1, textTransform: 'uppercase' },
  h2: { fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 10 },
  card: { borderWidth: 0.8, borderColor: C.line, borderRadius: 10, padding: 16 },
  row: { flexDirection: 'row' },
  pill: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8, fontSize: 7.5, fontWeight: 600, alignSelf: 'flex-start' },
});

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Defs>
        <LinearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#34d399" />
          <Stop offset="0.55" stopColor="#22d3ee" />
          <Stop offset="1" stopColor="#a78bfa" />
        </LinearGradient>
        <LinearGradient id="ls" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#047857" />
          <Stop offset="1" stopColor="#155e75" />
        </LinearGradient>
      </Defs>
      <Rect x={0.5} y={0.5} width={31} height={31} rx={8} fill="#0b1411" />
      <G transform="translate(3.4 0) skewX(-10)">
        <Path d="M8 6h5.6v20.5a1.2 1.2 0 0 1-1.2 1.2H9.2A1.2 1.2 0 0 1 8 26.5z" fill="url(#lg)" />
        <Path d="M8 6h5.6l-5.6 5.6z" fill="url(#ls)" />
        <Path d="M13.6 6h11.2a.8.8 0 0 1 .6 1.3l-3.4 4.3H8z" fill="url(#lg)" />
        <Path d="M8 14.2h5.6l-5.6 5z" fill="url(#ls)" />
        <Path d="M13.6 14.2h6.6a.8.8 0 0 1 .6 1.3l-2.9 3.7H8z" fill="url(#lg)" />
      </G>
    </Svg>
  );
}

/** The brand gradient as a thin strip across the top of every page. */
export function Band() {
  return (
    <Svg style={s.band} width={595.28} height={5} fixed>
      <Defs>
        <LinearGradient id="band" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={C.brandBright} />
          <Stop offset="0.55" stopColor={C.cyan} />
          <Stop offset="1" stopColor={C.violet} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={595.28} height={5} fill="url(#band)" />
    </Svg>
  );
}

export function Footer({ name, title = 'Interview feedback' }: { name: string; title?: string }) {
  return (
    <>
      <View style={{ position: 'absolute', bottom: 40, left: 42, right: 42, height: 0.6, backgroundColor: C.line }} fixed />
      <Text style={[s.footer, { left: 42 }]} fixed>
        Friday AI · {title}
        {name ? ` for ${name}` : ''}
      </Text>
      <Text
        style={[s.footer, { left: 42, right: 42, textAlign: 'right' }]}
        fixed
        render={({ pageNumber, totalPages }) => `friday-ai.in  ·  Page ${pageNumber} of ${totalPages}`}
      />
    </>
  );
}

/** The overall score as a ring, out of 10. */
export function Ring({ score, size = 112 }: { score: number; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const angle = (Math.min(99.9, Math.max(0.1, score)) / 100) * 2 * Math.PI;
  const x = c + r * Math.sin(angle);
  const y = c - r * Math.cos(angle);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={r} stroke={C.line} strokeWidth={stroke} fill="none" />
        <Path
          d={`M ${c} ${c - r} A ${r} ${r} 0 ${angle > Math.PI ? 1 : 0} 1 ${x} ${y}`}
          stroke={tone(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: 700, color: C.ink, lineHeight: 1 }}>{scoreOutOf10(score)}</Text>
        <Text style={{ fontSize: 8, color: C.faint, marginTop: 4 }}>out of 10</Text>
      </View>
    </View>
  );
}

export function Bar({ value, color = C.brand, height = 5 }: { value: number; color?: string; height?: number }) {
  return (
    <View style={{ height, borderRadius: height, backgroundColor: C.line, flexGrow: 1 }}>
      {value > 0 && <View style={{ height, borderRadius: height, backgroundColor: color, width: `${Math.max(3, Math.min(100, value * 10))}%` }} />}
    </View>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.panel, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11 }}>
      <Text style={{ fontSize: 7.5, color: C.muted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginTop: 2 }}>{value}</Text>
      {note ? <Text style={{ fontSize: 7, color: C.faint, marginTop: 1 }}>{note}</Text> : null}
    </View>
  );
}

export function Bullets({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <View>
      <View style={[s.row, { alignItems: 'center', gap: 6, marginBottom: 8 }]}>
        <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: color }} />
        <Text style={{ fontSize: 10.5, fontWeight: 600, color: C.ink }}>{title}</Text>
      </View>
      {items.map((it, n) => (
        <View key={n} style={[s.row, { gap: 7, marginBottom: 6 }]} wrap={false}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color, marginTop: 5 }} />
          <Text style={[s.p, { flex: 1 }]}>{it}</Text>
        </View>
      ))}
    </View>
  );
}

/** `wrap`: may break across pages (long text); short boxes stay whole. */
export function Box({ title, color, tint, children, badge, wrap = false }: { title: string; color: string; tint?: string; children: ReactNode; badge?: ReactNode; wrap?: boolean }) {
  return (
    <View
      style={{ borderRadius: 8, padding: 11, backgroundColor: tint ?? C.panel, borderLeftWidth: 2.5, borderLeftColor: color, marginTop: 8 }}
      wrap={wrap}
    >
      <View style={[s.row, { alignItems: 'center', gap: 6, marginBottom: 3 }]}>
        <Text style={{ fontSize: 8, fontWeight: 600, color, letterSpacing: 0.4, textTransform: 'uppercase' }}>{title}</Text>
        {badge}
      </View>
      {children}
    </View>
  );
}

