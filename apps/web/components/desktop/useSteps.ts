import { Download, LogIn, Play, UserPlus } from 'lucide-react';

// The four steps from sign-up to a live answer. A plain module (not 'use client') so both the
// landing page's server components and the client-side download dialog can read it.
export const USE_STEPS = [
  { icon: UserPlus, title: 'Create your account', body: 'Sign up here and add your resume and the job, so answers sound like you.' },
  { icon: Download, title: 'Install the desktop app', body: 'Windows, macOS or Linux. It’s what helps you during the live interview.' },
  { icon: LogIn, title: 'Sign in with the same account', body: 'Your resume, interviews and minutes are already there.' },
  { icon: Play, title: 'Join your call, press Start session', body: 'Open Zoom, Meet or Teams. Friday listens and answers on your overlay.' },
] as const;
