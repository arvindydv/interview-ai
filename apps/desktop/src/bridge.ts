// Typed wrapper around the Rust commands and events in src-tauri/src/lib.rs.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { Interview, ReportReceipt, Resume } from '@parakeet/shared';
import type { AudioStatus, AuthState, LiveEvent, LiveStatus, OverlayCommand, ParakeetApi, Protection, Screenshot } from './types';

/** Adapts Tauri's async `listen` to a synchronous unsubscribe function. */
function subscribe<T>(event: string, cb: (payload: T) => void) {
  const unlisten = listen<T>(event, (e) => cb(e.payload));
  return () => {
    unlisten.then((fn) => fn());
  };
}

/** Rust commands reject with a plain string; surface it as an Error with that message. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : String(e));
  }
}

const ua = navigator.userAgent;

export const parakeet: ParakeetApi = {
  auth: {
    get: () => call<AuthState>('auth_get'),
    signIn: () => call<AuthState>('auth_sign_in'),
    signOut: () => call('auth_sign_out'),
    onChange: (cb) => subscribe<AuthState>('auth:changed', cb),
  },
  api: {
    me: () => call('api_me'),
    health: () => call('api_health'),
  },
  profile: {
    resume: () => call<{ resume: Resume | null }>('profile_resume').then((r) => r.resume),
    uploadResume: (file) => call<{ resume: Resume }>('profile_resume_upload', { ...file }).then((r) => r.resume),
    deleteResume: () => call<void>('profile_resume_delete'),
    interview: () => call<{ interview: Interview | null }>('profile_interview').then((r) => r.interview),
    saveInterview: (interview) => call<{ interview: Interview }>('profile_interview_save', { interview }).then((r) => r.interview),
  },
  reports: {
    submit: (report) => call<ReportReceipt>('report_answer', { report }),
  },
  live: {
    connect: () => call('live_connect'),
    disconnect: () => call('live_disconnect'),
    ask: (text, imageIds) => call<string>('live_ask', { text, imageIds }),
    cancel: (turnId) => call('live_cancel', { turnId }),
    status: () => call<LiveStatus>('live_status'),
    onStatus: (cb) => subscribe<LiveStatus>('live:status', cb),
    onMessage: (cb) => subscribe<LiveEvent>('live:message', cb),
    onAsked: (cb) => subscribe<{ turnId: string; text: string; imageCount: number; auto?: boolean }>('live:asked', cb),
  },
  audio: {
    status: () => call<AudioStatus>('audio_status'),
    set: (settings) => call('audio_set', { ...settings }),
    onStatus: (cb) => subscribe<AudioStatus>('audio:status', cb),
  },
  overlay: {
    toggle: () => call('overlay_toggle'),
    show: () => call('overlay_show'),
    close: () => call('overlay_close'),
    onCommand: (cb) => subscribe<OverlayCommand>('overlay:command', cb),
  },
  screenshot: {
    capture: () => call<Screenshot>('screenshot_capture'),
    discard: (id) => call('screenshot_discard', { id }),
  },
  app: {
    protection: () => call<Protection>('screen_share_protection'),
    // Native clipboard: webview clipboard APIs are unreliable across WebView2/WKWebView/WebKitGTK.
    copy: (text) => writeText(text),
    showMain: () => call('main_window_show'),
    quit: () => call('app_quit'),
  },
  platform: ua.includes('Mac') ? 'darwin' : ua.includes('Windows') ? 'win32' : 'linux',
};
