import { z } from 'zod';
import { bulkModel, llmConfigured, structured } from '../llm.js';
import type { Question } from './answer.js';
import type { Config } from './config.js';

// Questions about the candidate's work ("Years with Spring Boot?", "Describe a Kafka project") answered
// from their resume with the bulk model, when their Application Profile lets Friday decide such
// questions. Never personal, legal or salary questions; the model must say it doesn't know when the
// resume doesn't show it, and then the job is skipped rather than guessed.

const PERSONAL = /\b(salary|ctc|notice|visa|sponsor|authori[sz]|gender|disabilit|veteran|race|relocat|criminal|background|age|date of birth|address|aadhaar|pan|last working day)\b/i;
const schema = z.object({ known: z.boolean(), answer: z.string() });
const cache = new Map<string, string | null>();

export async function answerFromResume(q: Question, config: Config): Promise<string | null> {
  if (!config.letAiDecide || !llmConfigured() || !config.resumeText.trim() || PERSONAL.test(q.label)) return null;
  const key = `${q.kind}|${q.label}|${(q.options ?? []).join('/')}|${config.resumeText.length}`;
  if (cache.has(key)) return cache.get(key)!;
  const { data } = await structured({
    model: bulkModel(),
    schema,
    name: 'answer',
    effort: 'low',
    maxTokens: 2000,
    system:
      'You answer one job application question for a candidate using ONLY facts in their resume. If the resume does not clearly support an answer, set known to false. Never invent experience, numbers or employers.',
    user: [
      q.kind === 'number' ? 'The answer must be a single number.' : '',
      q.options?.length ? `The answer must be exactly one of: ${q.options.filter(Boolean).join(' | ')}` : 'Keep it under 60 words, first person.',
      `Resume:\n${config.resumeText.slice(0, 12_000)}`,
      `Question: ${q.label}`,
    ].join('\n\n'),
  }).catch(() => ({ data: null }));
  const answer = data?.known && data.answer.trim() ? data.answer.trim() : null;
  cache.set(key, answer);
  return answer;
}
