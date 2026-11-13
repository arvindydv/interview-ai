import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { sql } from '../db.js';
import { env } from '../env.js';

// Employer/partner credentials for an ATS's application API (public.ats_credentials). They are API keys
// an employer or ATS partnership issued to Friday with written permission (agreement_ref); never a
// candidate's password. Encrypted with ATS_CREDENTIALS_KEY (AES-256-GCM: iv | tag | ciphertext), the
// same format as apps/api/src/lib/atsCredentials.ts, which writes them.

function key(raw = env.ATS_CREDENTIALS_KEY) {
  const k = Buffer.from(raw ?? '', 'base64');
  if (k.length !== 32) throw new Error('ATS_CREDENTIALS_KEY must be 32 bytes, base64');
  return k;
}

export const credentialsConfigured = () => Buffer.from(env.ATS_CREDENTIALS_KEY ?? '', 'base64').length === 32;

export function encryptSecret(secret: string, raw?: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(raw), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

export function decryptSecret(blob: Buffer, raw?: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key(raw), blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
}

export interface AtsCredential {
  id: string;
  provider: string;
  board: string;
  /** Decrypted; never logged. */
  secret: string;
  /** Applications a day this employer agreed to receive through its API (India calendar day). */
  dailyCap: number;
}

/** Whether an unrevoked credential exists (no decryption: for choosing a channel). */
export async function hasCredential(provider: string, board: string | null): Promise<boolean> {
  if (!board || !credentialsConfigured()) return false;
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.ats_credentials
    where provider = ${provider} and board = ${board} and revoked_at is null and last_error is null`;
  return row.n > 0;
}

/** The usable credential for a board, decrypted; null when none, revoked, flagged or undecryptable. */
export async function loadCredential(provider: string, board: string | null): Promise<AtsCredential | null> {
  if (!board || !credentialsConfigured()) return null;
  const [row] = await sql<{ id: string; secret_enc: Buffer; daily_cap: number }[]>`
    select id, secret_enc, daily_cap from public.ats_credentials
    where provider = ${provider} and board = ${board} and revoked_at is null and last_error is null`;
  if (!row) return null;
  try {
    return { id: row.id, provider, board, secret: decryptSecret(row.secret_enc), dailyCap: row.daily_cap };
  } catch {
    await flagCredential(row.id, 'Could not decrypt (ATS_CREDENTIALS_KEY changed?)');
    return null;
  }
}

/** The ATS refused the credential: it isn't used again until an admin re-verifies or replaces it. */
export async function flagCredential(id: string, error: string) {
  await sql`update public.ats_credentials set last_error = ${error.slice(0, 500)}, updated_at = now() where id = ${id}`;
}
