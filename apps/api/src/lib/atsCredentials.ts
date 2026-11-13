import { createCipheriv, randomBytes } from 'node:crypto';
import { env } from '../env.js';

// Employer/partner ATS API keys (public.ats_credentials), encrypted here when an admin adds one and
// decrypted only by the worker that submits (apps/worker/src/submit/credentials.ts, same format:
// AES-256-GCM, iv | tag | ciphertext). The API never decrypts or returns them.

export const atsCredentialsConfigured = () => Buffer.from(env.ATS_CREDENTIALS_KEY ?? '', 'base64').length === 32;

export function encryptAtsSecret(secret: string): Buffer {
  const key = Buffer.from(env.ATS_CREDENTIALS_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('ATS_CREDENTIALS_KEY must be 32 bytes, base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

/** Last four characters, for recognising a key in the console. */
export const secretHint = (secret: string) => `…${secret.trim().slice(-4)}`;
