import nodemailer from 'nodemailer';
import { env } from './env.js';

const useBrevo = Boolean(env.BREVO_SMTP_LOGIN && env.BREVO_SMTP_KEY);

/**
 * Pooled SMTP transport. Brevo on 587 with mandatory STARTTLS; in dev without credentials, Mailpit
 * (enabled via supabase/config.toml [inbucket] smtp_port) so nothing leaves the machine.
 */
export const transport = useBrevo
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      requireTLS: true,
      auth: { user: env.BREVO_SMTP_LOGIN, pass: env.BREVO_SMTP_KEY },
      pool: true,
      maxConnections: 3,
      // Stay under Brevo's per-second limits during bursts.
      rateDelta: 1000,
      rateLimit: 10,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : nodemailer.createTransport({ host: '127.0.0.1', port: 54325, secure: false, ignoreTLS: true });

export const mailerLabel = useBrevo ? `Brevo (${env.SMTP_HOST}:${env.SMTP_PORT})` : 'Mailpit (dev, 127.0.0.1:54325)';

export async function verifyMailer() {
  try {
    await transport.verify();
    console.log(`[mailer] ready via ${mailerLabel}`);
  } catch (err) {
    console.error(`[mailer] cannot reach ${mailerLabel}: ${(err as Error).message}`);
  }
}

/** SMTP 5xx = permanent (bad address, rejected sender, auth); retrying won't help. */
export function isPermanentSmtpError(err: unknown) {
  const code = (err as { responseCode?: number }).responseCode;
  return typeof code === 'number' && code >= 500;
}
