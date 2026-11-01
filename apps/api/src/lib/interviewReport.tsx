import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { HistorySessionSummary, SessionDebrief } from '@parakeet/shared';
import { Band, Box, Bullets, C, Footer, LogoMark, Ring, Stat, duration, printable, s, scoreLabel, tone } from './pdf.js';

// Feedback on a real interview (one the Friday desktop app helped with) as a downloadable PDF
// (GET /v1/history/:id/report.pdf): the same content as the History page (apps/web,
// app/history/[id]/page.tsx), in the same design as the practice report (lib/practiceReport.tsx).

/** Friday's suggested answers can run long; the report keeps the start of each. */
const MAX_SUGGESTION_CHARS = 1_200;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text);

interface ReportInput {
  session: HistorySessionSummary;
  summary: SessionDebrief;
  /** The questions asked (with text), in order, with Friday's suggested answer to each. */
  turns: { question: string; answer: string }[];
  candidateName: string;
}

function Question({ n, question, suggestion, answer }: {
  n: number;
  question: string;
  suggestion: string;
  answer?: NonNullable<SessionDebrief['performance']>['answers'][number];
}) {
  const scored = answer?.heard;
  return (
    <View style={[s.card, { marginBottom: 12 }]}>
      <View style={[s.row, { gap: 12 }]} wrap={false}>
        {answer && (
          <View
            style={{
              width: 40, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
              backgroundColor: scored ? C.brandTint : C.panel,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: 700, color: scored ? tone(answer.score * 10) : C.faint }}>
              {scored ? answer.score.toFixed(1) : '–'}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 7.5, color: C.faint, marginBottom: 2 }}>QUESTION {n + 1}</Text>
          <Text style={{ fontSize: 11, fontWeight: 600, color: C.ink, lineHeight: 1.4 }}>{question}</Text>
        </View>
      </View>
      {answer && (
        <>
          {answer.heard && answer.said ? (
            <View style={{ marginTop: 10 }} wrap={false}>
              <Text style={[s.eyebrow, { marginBottom: 3 }]}>What you said</Text>
              <Text style={s.p}>{answer.said}</Text>
            </View>
          ) : null}
          <Box title={answer.heard ? 'Feedback' : 'What a strong answer covers'} color={C.warn} tint={C.warnTint}>
            <Text style={s.p}>{answer.feedback}</Text>
          </Box>
        </>
      )}
      {suggestion ? (
        <Box title="Friday suggested" color={C.brand} tint={C.brandTint} wrap>
          <Text style={[s.p, { color: C.ink }]}>{clip(suggestion, MAX_SUGGESTION_CHARS)}</Text>
        </Box>
      ) : null}
    </View>
  );
}

function Report({ session, summary, turns, candidateName: name, generatedAt }: ReportInput & { generatedAt: Date }) {
  const started = new Date(session.startedAt);
  const date = started.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = started.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const p = summary.performance;
  const answers = new Map(p?.answers.map((a) => [a.question, a]) ?? []);
  const heard = p ? p.answers.filter((a) => a.heard).length : 0;

  return (
    <Document title={`Interview feedback · ${date}`} author="Friday AI" subject="Interview feedback" creator="Friday AI">
      <Page size="A4" style={s.page}>
        <Band />
        <Footer name={name} />

        {/* masthead */}
        <View style={[s.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
          <View style={[s.row, { alignItems: 'center', gap: 7 }]}>
            <LogoMark />
            <Text style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Friday AI</Text>
          </View>
          <Text style={{ fontSize: 8, color: C.faint }}>
            Generated {generatedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
          </Text>
        </View>

        <View style={{ marginTop: 26 }}>
          <Text style={[s.eyebrow, { color: C.brand }]}>Interview feedback report</Text>
          <Text style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginTop: 4, lineHeight: 1.2 }}>{name || 'Your interview'}</Text>
          <Text style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
            {[...session.interviews, date, time].join('  ·  ')}
          </Text>
        </View>

        {/* overall */}
        {p ? (
          <View style={[s.card, s.row, { marginTop: 20, gap: 20, alignItems: 'center' }]} wrap={false}>
            <Ring score={p.score * 10} />
            <View style={{ flex: 1 }}>
              <Text style={s.eyebrow}>How you answered</Text>
              <Text style={{ fontSize: 17, fontWeight: 700, color: tone(p.score * 10), marginTop: 2, lineHeight: 1.3 }}>{scoreLabel(p.score * 10)}</Text>
              <Text style={[s.p, { marginTop: 6 }]}>{p.summary}</Text>
            </View>
          </View>
        ) : null}

        <View style={[s.row, { gap: 8, marginTop: p ? 10 : 20 }]}>
          <Stat label="Questions asked" value={String(turns.length)} />
          <Stat label="Interview length" value={duration(session.seconds * 1000)} />
          {p ? <Stat label="Answers reviewed" value={`${heard} of ${turns.length}`} note={heard < turns.length ? 'Some answers weren’t heard' : undefined} /> : null}
          <Stat label="Topics covered" value={String(summary.topics.length)} />
        </View>

        {/* overview */}
        <View style={[s.card, { marginTop: 14 }]} wrap={false}>
          <Text style={[s.h2, { fontSize: 10.5, marginBottom: 6 }]}>What the interview covered</Text>
          <Text style={s.p}>{summary.overview}</Text>
          {summary.topics.length > 0 && (
            <View style={[s.row, { flexWrap: 'wrap', gap: 5, marginTop: 9 }]}>
              {summary.topics.map((t) => (
                <Text key={t} style={[s.pill, { color: C.muted, backgroundColor: C.panel, fontWeight: 500 }]}>
                  {t}
                </Text>
              ))}
            </View>
          )}
        </View>

        {p ? (
          <View style={[s.card, { marginTop: 14, gap: 12 }]} wrap={false}>
            <Bullets title="What went well" items={p.strengths} color={C.brand} />
            <View style={{ height: 0.6, backgroundColor: C.line }} />
            <Bullets title="Work on next" items={p.improvements} color={C.warn} />
          </View>
        ) : (
          <View style={{ marginTop: 14, borderRadius: 10, padding: 12, backgroundColor: C.panel }} wrap={false}>
            <Text style={[s.p, { fontSize: 8.5, color: C.muted }]}>
              Turn on “You” (your microphone) in the Friday desktop app next time, and this report will also score your own answers.
            </Text>
          </View>
        )}

        {/* revise */}
        {summary.weakSpots.length > 0 && (
          <View style={[s.card, { marginTop: 14 }]} wrap={false}>
            <Text style={[s.h2, { fontSize: 10.5, marginBottom: 4 }]}>Revise before the next round</Text>
            {summary.weakSpots.map((w) => (
              <Box key={w.topic} title={w.topic} color={C.warn} tint={C.warnTint}>
                <Text style={[s.p, { color: C.muted }]}>{w.why}</Text>
                <Text style={[s.p, { marginTop: 3 }]}>
                  <Text style={{ fontWeight: 600, color: C.ink }}>Study: </Text>
                  {w.study}
                </Text>
              </Box>
            ))}
          </View>
        )}

        {/* question by question, from a new page (react-pdf can't keep a heading with the start of a breakable card) */}
        {turns.length > 0 && (
          <View break>
            <Text style={[s.eyebrow, { color: C.brand }]}>Question by question</Text>
            <Text style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginTop: 3, marginBottom: 14 }}>
              {p ? 'Every answer, reviewed' : 'Every question you were asked'}
            </Text>
            {turns.map((t, n) => (
              <Question key={n} n={n} question={t.question} suggestion={t.answer} answer={p ? answers.get(n + 1) : undefined} />
            ))}
          </View>
        )}

        {/* thank-you email */}
        <View style={[s.card, { marginTop: 6 }]} wrap={false}>
          <Text style={[s.h2, { fontSize: 10.5, marginBottom: 6 }]}>Thank-you email to send today</Text>
          <Text style={{ fontSize: 8, color: C.faint }}>Subject</Text>
          <Text style={{ fontSize: 9.5, fontWeight: 600, color: C.ink, marginBottom: 6 }}>{summary.thankYouEmail.subject}</Text>
          <Text style={s.p}>{summary.thankYouEmail.body}</Text>
        </View>
      </Page>
    </Document>
  );
}

/** The interview's feedback as a PDF. */
export function interviewReportPdf(input: ReportInput) {
  const data = printable(input);
  return renderToBuffer(<Report {...data} candidateName={data.candidateName.trim()} generatedAt={new Date()} />);
}
