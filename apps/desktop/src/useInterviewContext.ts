import { useCallback, useEffect, useState } from 'react';
import { PROFILE_LIMITS, type Interview, type InterviewInput, type Resume } from '@parakeet/shared';
import { parakeet as p } from './bridge';

const ACCEPTED = ['pdf', 'docx', 'txt', 'md'];
export const RESUME_ACCEPT = '.pdf,.docx,.txt,.md';

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error("Couldn't read this file."));
    reader.readAsDataURL(file);
  });
}

export type ContextStrength = 'none' | 'basic' | 'strong';

/**
 * The resume and the interview being prepared for, shared by Home and Prepare. While the worker is
 * analysing a resume, polls until the analysis finishes.
 */
export function useInterviewContext() {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [interview, setInterview] = useState<Interview | null>(null);

  const reload = useCallback(() => {
    setLoadError(null);
    return Promise.all([p.profile.resume(), p.profile.interview()]).then(
      ([r, i]) => {
        setResume(r);
        setInterview(i);
        setLoaded(true);
      },
      (e) => {
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      },
    );
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const parsing = resume?.status === 'parsing';
  useEffect(() => {
    if (!parsing) return;
    const id = setInterval(() => p.profile.resume().then(setResume, () => {}), 2500);
    return () => clearInterval(id);
  }, [parsing]);

  /** Validates and uploads a resume; throws with a user-facing message. */
  const upload = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (!ACCEPTED.includes(ext)) throw new Error('Upload a PDF, DOCX or TXT file.');
    if (file.size > PROFILE_LIMITS.maxResumeBytes) throw new Error('Resumes can be up to 5 MB.');
    const data = await readBase64(file);
    setResume(await p.profile.uploadResume({ fileName: file.name, mimeType: file.type, data }));
  }, []);

  const remove = useCallback(async () => {
    await p.profile.deleteResume();
    setResume(null);
  }, []);

  const save = useCallback(async (input: InterviewInput) => {
    const saved = await p.profile.saveInterview(input);
    setInterview(saved);
    return saved;
  }, []);

  const hasResume = !!resume;
  const hasTarget = !!(interview?.role || interview?.company || interview?.field);
  const hasJobDescription = !!interview?.jobDescription;
  const strength: ContextStrength =
    hasResume && hasTarget && hasJobDescription ? 'strong' : hasResume || hasTarget || hasJobDescription ? 'basic' : 'none';

  return { loaded, loadError, reload, resume, interview, upload, remove, save, hasResume, hasTarget, hasJobDescription, strength };
}

export type InterviewContextState = ReturnType<typeof useInterviewContext>;
