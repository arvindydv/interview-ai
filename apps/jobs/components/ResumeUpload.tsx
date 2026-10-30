'use client';
import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { PROFILE_LIMITS, RESUME_TYPES, type Resume, type ResumeUpload as Upload } from '@parakeet/shared';
import { Spinner } from './ui';
import { api } from '@/lib/api';
import { useJobs } from '@/lib/jobs';

// Uploads through the same endpoint as the main site: the resume replaces the one Friday AI already
// uses for interviews, and the worker analyses it before matching.

const ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
const EXTENSIONS = ['pdf', 'docx', 'txt', 'md'];

function fileProblem(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!RESUME_TYPES[file.type] && !EXTENSIONS.includes(ext)) {
    return ext === 'doc' ? 'Old .doc files aren’t supported. Save it as .docx or PDF and try again.' : 'Upload a PDF, DOCX or TXT file.';
  }
  if (file.size > PROFILE_LIMITS.maxResumeBytes) return 'Resumes can be up to 5 MB.';
  if (file.size === 0) return 'This file is empty.';
  return null;
}

async function toUpload(file: File): Promise<Upload> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, mimeType: file.type, data };
}

export function ResumeUploadButton({ label = 'Upload resume', className = 'btn btn-primary' }: { label?: string; className?: string }) {
  const { reload } = useJobs();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await api<{ resume: Resume }>('/v1/resume', { method: 'POST', body: JSON.stringify(await toUpload(file)) });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={className}>
        {busy ? <Spinner /> : <FileUp size={16} />} {busy ? 'Uploading…' : label}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
