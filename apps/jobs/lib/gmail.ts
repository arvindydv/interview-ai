'use client';
import type { GmailStatus } from '@parakeet/shared';
import { api, ApiError } from './api';

// Connecting Gmail for cold email: Google sends the candidate back with ?gmail_code=…, which only their own
// signed-in session can claim (POST /v1/cold-email/gmail/complete), or with ?gmail=<problem>.

export const GMAIL_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Gmail connected. You can send cold emails from any job.' },
  cancelled: { ok: false, text: 'Gmail wasn’t connected.' },
  no_send: { ok: false, text: 'Friday needs permission to send email. Connect again and leave “Send email on your behalf” ticked.' },
  expired: { ok: false, text: 'That took too long. Connect Gmail again.' },
  failed: { ok: false, text: 'Gmail couldn’t be connected. Try again.' },
};

let completing: Promise<string | null> | null = null;

/**
 * Claims a connection Google just approved, once per page load, and takes the code out of the address
 * bar. Returns the result to show ("connected", "expired"…), or null when there was nothing to finish.
 */
function finishConnect(): Promise<string | null> {
  return (completing ??= (async () => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('gmail_code');
    let result = url.searchParams.get('gmail');
    if (!code && !result) return null;
    url.searchParams.delete('gmail_code');
    url.searchParams.delete('gmail');
    window.history.replaceState(window.history.state, '', url.toString());
    if (code) {
      try {
        await api('/v1/cold-email/gmail/complete', { method: 'POST', body: JSON.stringify({ code }) });
        result = 'connected';
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          GMAIL_RESULT.wrong_account = { ok: false, text: e.message };
          result = 'wrong_account';
        } else {
          result = e instanceof ApiError && e.status === 410 ? 'expired' : 'failed';
        }
      }
    }
    return result;
  })());
}

/** The candidate's Gmail connection, after finishing one that Google just sent them back from. */
export async function gmailStatus(): Promise<{ status: GmailStatus; result: string | null }> {
  const result = await finishConnect();
  return { status: await api<GmailStatus>('/v1/cold-email/gmail'), result };
}

/** Sends the candidate to Google to allow sending; they come back to `returnTo`. */
export async function connectGmail(returnTo: string) {
  const { url } = await api<{ url: string }>('/v1/cold-email/gmail/connect', {
    method: 'POST',
    body: JSON.stringify({ returnTo }),
  });
  window.location.assign(url);
}
