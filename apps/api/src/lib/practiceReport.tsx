import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import {
  PRACTICE_DIFFICULTIES, ROUND_TYPES,
  type PracticeAnswer, type PracticeFeedback, type PracticeQuestion, type PracticeQuestionKind, type PracticeScores,
  type PracticeSession, type ReadingVerdict,
} from '@parakeet/shared';
import { Band, Bar, Box, Bullets, C, Footer, LogoMark, Ring, Stat, duration, printable, s, scoreLabel, tone } from './pdf.js';

// The practice debrief as a downloadable PDF (GET /v1/practice/:id/report.pdf): the same content as
// the debrief page (apps/web, components/practice/Debrief.tsx), laid out as a printable A4 report in
// the site's light theme.

const KIND_LABEL: Record<PracticeQuestionKind, string> = {
  opener: 'Opener', behavioral: 'Behavioural', role: 'Technical', situational: 'Situational', follow_up: 'Follow-up', closing: 'Closing',
};

const READING: Record<ReadingVerdict, { label: string; color: string; tint: string }> = {
  natural: { label: 'Sounded natural', color: C.brand, tint: C.brandTint },
  possibly_reading: { label: 'May have been reading', color: C.brand2, tint: C.cyanTint },
  likely_reading: { label: 'Sounded read out', color: C.warn, tint: C.warnTint },
};

const CATEGORIES: { key: keyof PracticeScores; label: string }[] = [
  { key: 'confidence', label: 'Confidence' },
  { key: 'relevance', label: 'Relevance' },
  { key: 'structure', label: 'Structure' },
  { key: 'specificity', label: 'Specificity' },
  { key: 'clarity', label: 'Clarity' },
];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** One answer's score out of 10, weighted like the overall score (apps/worker, queues/practice.ts). */
const answerScore = (s: PracticeScores) => {
  const content = mean([s.relevance, s.structure, s.specificity, s.clarity]);
  return s.confidence === undefined ? content : 0.6 * content + 0.4 * s.confidence;
};
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function ScoreBars({ scores, compact }: { scores: Partial<PracticeScores>; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? 5 : 9 }}>
      {CATEGORIES.filter((k) => scores[k.key] !== undefined).map(({ key, label }) => {
        const v = scores[key]!;
        return (
          <View key={key} style={[s.row, { alignItems: 'center', gap: 8 }]}>
            <Text style={{ width: compact ? 58 : 70, fontSize: compact ? 7.5 : 8.5, color: C.muted }}>{label}</Text>
            <Bar value={v} color={tone(v * 10)} height={compact ? 4 : 6} />
            <Text style={{ width: 22, textAlign: 'right', fontSize: compact ? 7.5 : 8.5, fontWeight: 600, color: C.ink }}>{v.toFixed(1)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Question({ n, q, a, f }: { n: number; q: PracticeQuestion; a: PracticeAnswer | null; f: PracticeFeedback }) {
  const skipped = !a || a.skipped;
  const score = answerScore(f.scores);
  const facts = a && !skipped
    ? [
        `${a.words} words`,
        duration(a.durationMs),
        a.wpm && `${a.wpm} wpm`,
        a.delivery && `${seconds(a.delivery.thinkMs)} to start`,
        a.delivery?.longPauses && `${a.delivery.longPauses} long pause${a.delivery.longPauses === 1 ? '' : 's'}`,
        a.fillers.length > 0 && `fillers: ${a.fillers.map((x) => `“${x.word}” ×${x.count}`).join(', ')}`,
        a.delivery && a.delivery.hedges.length > 0 && `hedges: ${a.delivery.hedges.map((x) => `“${x.word}” ×${x.count}`).join(', ')}`,
      ].filter(Boolean)
    : [];
  return (
    <View style={[s.card, { marginBottom: 14 }]}>
      <View wrap={false}>
      <View style={[s.row, { gap: 12 }]}>
        <View
          style={{
            width: 40, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
            backgroundColor: skipped ? C.panel : C.brandTint,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: 700, color: skipped ? C.faint : tone(score * 10) }}>{skipped ? '–' : score.toFixed(1)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 7.5, color: C.faint, marginBottom: 2 }}>
            QUESTION {n + 1}  ·  {KIND_LABEL[q.kind].toUpperCase()}  ·  {f.verdict}
          </Text>
          <Text style={{ fontSize: 11, fontWeight: 600, color: C.ink, lineHeight: 1.4 }}>{q.question}</Text>
        </View>
      </View>

      <View style={[s.row, { gap: 16, marginTop: 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.eyebrow, { marginBottom: 4 }]}>Your answer</Text>
          <Text style={[s.p, { color: skipped ? C.faint : C.body }]}>{skipped ? 'Skipped' : a!.text}</Text>
          {facts.length > 0 && <Text style={[s.p, { fontSize: 7.5, color: C.faint, marginTop: 4 }]}>{facts.join('  ·  ')}</Text>}
        </View>
        <View style={{ width: 150 }}>
          <ScoreBars scores={f.scores} compact />
          {q.lookingFor ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[s.eyebrow, { marginBottom: 3 }]}>What they look for</Text>
              <Text style={[s.p, { fontSize: 8, color: C.muted }]}>{q.lookingFor}</Text>
            </View>
          ) : null}
        </View>
      </View>
      </View>

      <Box title="Feedback" color={C.warn} tint={C.warnTint}>
        <Text style={s.p}>{f.feedback}</Text>
      </Box>
      {f.delivery ? (
        <Box
          title="How you said it"
          color={C.brand2}
          tint={C.cyanTint}
          badge={
            f.reading && f.reading !== 'natural' ? (
              <Text style={[s.pill, { color: READING[f.reading].color, backgroundColor: '#ffffff', paddingVertical: 1.5 }]}>{READING[f.reading].label}</Text>
            ) : undefined
          }
        >
          <Text style={s.p}>{f.delivery}</Text>
        </Box>
      ) : null}
      <Box title="A stronger answer" color={C.brand} tint={C.brandTint}>
        <Text style={[s.p, { color: C.ink }]}>{f.betterAnswer}</Text>
      </Box>
    </View>
  );
}

function Report({ session, name, generatedAt }: { session: PracticeSession; name: string; generatedAt: Date }) {
  const result = session.result!;
  const round = ROUND_TYPES.find((r) => r.id === session.roundType)?.label ?? session.roundType;
  const difficulty = PRACTICE_DIFFICULTIES.find((d) => d.id === session.difficulty)?.label ?? session.difficulty;
  const answered = session.answers.map((a, n) => ({ a, f: result.questions[n] })).filter(({ a }) => a && !a.skipped);
  const categories = Object.fromEntries(
    CATEGORIES.filter(({ key }) => answered.some(({ f }) => f.scores[key] !== undefined)).map(({ key }) => [
      key,
      mean(answered.map(({ f }) => f.scores[key] ?? 0)),
    ]),
  ) as Partial<PracticeScores>;
  const spoken = session.answers.filter((a): a is PracticeAnswer => Boolean(a && !a.skipped && a.wpm));
  const pace = spoken.length ? Math.round(mean(spoken.map((a) => a.wpm!))) : null;
  const fillers = session.answers.reduce((n, a) => n + (a?.fillers.reduce((m, f) => m + f.count, 0) ?? 0), 0);
  const talking = session.answers.reduce((n, a) => n + (a?.durationMs ?? 0), 0);
  const delivered = session.answers.filter((a): a is PracticeAnswer => Boolean(a && !a.skipped && a.delivery));
  const think = delivered.length ? mean(delivered.map((a) => a.delivery!.thinkMs)) : null;
  const pauses = delivered.reduce((n, a) => n + a.delivery!.longPauses, 0);
  const hedges = delivered.reduce((n, a) => n + a.delivery!.hedges.reduce((m, h) => m + h.count, 0), 0);
  const date = new Date(session.completedAt ?? session.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const c = result.confidence;

  return (
    <Document title={`Interview feedback · ${session.title}`} author="Friday AI" subject="Mock interview feedback" creator="Friday AI">
      <Page size="A4" style={s.page}>
        <Band />
        <Footer name={name} />

        {/* masthead */}
        <View style={[s.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
          <View style={[s.row, { alignItems: 'center', gap: 7 }]}>
            <LogoMark />
            <Text style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Friday AI</Text>
          </View>
          <Text style={{ fontSize: 8, color: C.faint }}>Generated {generatedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </View>

        <View style={{ marginTop: 26 }}>
          <Text style={[s.eyebrow, { color: C.brand }]}>Interview feedback report</Text>
          <Text style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginTop: 4, lineHeight: 1.2 }}>{name || 'Your mock interview'}</Text>
          <Text style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
            {[session.title, `${round} round`, difficulty, session.durationMinutes && `${session.durationMinutes} minutes`, date].filter(Boolean).join('  ·  ')}
          </Text>
        </View>

        {/* overall */}
        <View style={[s.card, s.row, { marginTop: 20, gap: 20, alignItems: 'center' }]}>
          <Ring score={result.score} />
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>Overall</Text>
            <Text style={{ fontSize: 17, fontWeight: 700, color: tone(result.score), marginTop: 2, lineHeight: 1.3 }}>{scoreLabel(result.score)}</Text>
            <Text style={[s.p, { marginTop: 6 }]}>{result.summary}</Text>
          </View>
        </View>

        <View style={[s.row, { gap: 8, marginTop: 10 }]}>
          <Stat label="Questions answered" value={`${answered.length} of ${session.questions.length}`} />
          <Stat
            label="Speaking pace"
            value={pace ? `${pace} wpm` : '–'}
            note={pace ? (pace < 110 ? 'A little slow' : pace > 170 ? 'A little fast' : 'Comfortable') : 'Typed answers'}
          />
          <Stat label="Filler words" value={String(fillers)} note={fillers > 6 ? 'Try pausing instead' : undefined} />
          <Stat label="Talking time" value={duration(talking)} />
        </View>

        {/* confidence */}
        {c && (
          <View style={[s.card, { marginTop: 14 }]} wrap={false}>
            <View style={[s.row, { gap: 20 }]}>
              <View style={{ width: 150 }}>
                <Text style={s.eyebrow}>Confidence</Text>
                <Text style={{ fontSize: 24, fontWeight: 700, color: tone(c.score * 10), marginTop: 4, lineHeight: 1.1 }}>
                  {c.score.toFixed(1)}
                  <Text style={{ fontSize: 10, fontWeight: 400, color: C.faint }}> /10</Text>
                </Text>
                <View style={[s.row, { marginTop: 8 }]}>
                  <Bar value={c.score} color={tone(c.score * 10)} height={6} />
                </View>
                <Text style={[s.pill, { marginTop: 10, color: READING[c.reading].color, backgroundColor: READING[c.reading].tint }]}>
                  {READING[c.reading].label}
                </Text>
                {c.readingEvidence ? <Text style={[s.p, { fontSize: 8, color: C.muted, marginTop: 5 }]}>{c.readingEvidence}</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.p}>{c.summary}</Text>
                {delivered.length > 0 && (
                  <View style={[s.row, { gap: 6, marginTop: 9 }]}>
                    <Stat label="Time to start" value={seconds(think!)} note={think! > 6000 ? 'Start sooner' : 'Good'} />
                    <Stat label="Long pauses" value={String(pauses)} />
                    <Stat label="Hedges" value={String(hedges)} note={hedges > 3 ? '“I think”, “maybe”…' : undefined} />
                  </View>
                )}
              </View>
            </View>
            {c.tips.length > 0 && (
              <View style={{ marginTop: 12, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: 600, color: C.ink, marginBottom: 6 }}>Sound more confident next time</Text>
                {c.tips.map((t, n) => (
                  <View key={n} style={[s.row, { gap: 8, marginBottom: 5 }]}>
                    <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: C.warnTint, alignItems: 'center', justifyContent: 'center', marginTop: 0.5 }}>
                      <Text style={{ fontSize: 7, fontWeight: 700, color: C.warn, lineHeight: 1 }}>{n + 1}</Text>
                    </View>
                    <Text style={[s.p, { flex: 1 }]}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* across answers */}
        <View style={[s.card, s.row, { marginTop: 14, gap: 24 }]} wrap={false}>
          <View style={{ width: 150 }}>
            <Text style={[s.h2, { fontSize: 10.5, marginBottom: 4 }]}>Across your answers</Text>
            <Text style={[s.p, { fontSize: 8, color: C.muted }]}>
              Average out of 10 over the {answered.length === 1 ? 'question' : `${answered.length} questions`} you answered.
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <ScoreBars scores={categories} />
          </View>
        </View>
        <View style={[s.card, { marginTop: 14, gap: 12 }]} wrap={false}>
          <Bullets title="What went well" items={result.strengths} color={C.brand} />
          <View style={{ height: 0.6, backgroundColor: C.line }} />
          <Bullets title="Work on next" items={result.improvements} color={C.warn} />
        </View>

        {/* question by question, from a new page (react-pdf can't keep a heading with the start of a breakable card) */}
        <View break>
          <Text style={[s.eyebrow, { color: C.brand }]}>Question by question</Text>
          <Text style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginTop: 3, marginBottom: 14 }}>Every answer, reviewed</Text>
          {session.questions.map((q, n) => (
            <Question key={n} n={n} q={q} a={session.answers[n]} f={result.questions[n]} />
          ))}
        </View>

        <View style={{ marginTop: 6, borderRadius: 10, padding: 14, backgroundColor: C.panel }} wrap={false}>
          <Text style={{ fontSize: 10.5, fontWeight: 600, color: C.ink }}>Keep practising</Text>
          <Text style={[s.p, { marginTop: 3, color: C.muted }]}>
            Pick one or two points from “Work on next” and run another round on friday-ai.in/practice. Confidence grows fastest with short, frequent sessions.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/** The scored session as a PDF. */
export function practiceReportPdf(session: PracticeSession, candidateName: string) {
  return renderToBuffer(<Report session={printable(session)} name={printable(candidateName).trim()} generatedAt={new Date()} />);
}
