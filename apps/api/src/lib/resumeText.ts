import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import { PROFILE_LIMITS, RESUME_TYPES } from '@parakeet/shared';

export class ResumeTextError extends Error {}

/** Picks the parser from the MIME type, falling back to the file extension (OSes report types inconsistently). */
export function resumeKind(fileName: string, mimeType: string) {
  const byType = RESUME_TYPES[mimeType];
  if (byType) return byType;
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'txt' || ext === 'md') return 'text';
  return null;
}

function normalise(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extracts plain text from a PDF, DOCX or text resume. Throws ResumeTextError with a user-facing message. */
export async function extractResumeText(kind: 'pdf' | 'docx' | 'text', file: Buffer): Promise<string> {
  let raw: string;
  try {
    if (kind === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(file));
      raw = (await extractText(pdf, { mergePages: true })).text;
    } else if (kind === 'docx') {
      raw = (await mammoth.extractRawText({ buffer: file })).value;
    } else {
      raw = file.toString('utf8');
    }
  } catch {
    throw new ResumeTextError("We couldn't read this file. Make sure it isn't password-protected or damaged.");
  }
  const text = normalise(raw);
  if (text.length < PROFILE_LIMITS.minResumeChars) {
    throw new ResumeTextError(
      kind === 'pdf'
        ? "This PDF has almost no selectable text (it may be a scan). Export your resume as a text-based PDF or DOCX."
        : 'This file has almost no text in it.',
    );
  }
  return text.slice(0, PROFILE_LIMITS.maxResumeChars);
}
