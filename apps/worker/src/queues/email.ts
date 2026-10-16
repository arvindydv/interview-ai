import { UnrecoverableError, Worker } from 'bullmq';
import { emails, type EmailJob } from '@parakeet/emails';
import { env } from '../env.js';
import { isPermanentSmtpError, transport } from '../mailer.js';

export const EMAIL_QUEUE = 'email';

function redact(address: string) {
  const [user, domain] = address.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

/** Renders a product email and sends it. Retries/backoff are set by the producer (apps/api). */
export function startEmailWorker() {
  const worker = new Worker<EmailJob>(
    EMAIL_QUEUE,
    async (job) => {
      const { template, to, props } = job.data;
      const render = emails[template] as (p: typeof props) => ReturnType<(typeof emails)[typeof template]>;
      const { subject, html, text } = await render(props);
      try {
        const info = await transport.sendMail({
          from: env.EMAIL_FROM,
          to,
          replyTo: env.EMAIL_REPLY_TO,
          subject,
          html,
          text,
          headers: {
            // Brevo groups stats by tag in its dashboard.
            'X-Mailin-Tag': template,
            // Stable ID lets the provider and our logs dedupe a retried job.
            'X-Entity-Ref-ID': `${template}-${job.id}`,
          },
        });
        return { messageId: info.messageId };
      } catch (err) {
        if (isPermanentSmtpError(err)) throw new UnrecoverableError((err as Error).message);
        throw err;
      }
    },
    { connection: { url: env.REDIS_URL }, concurrency: 5 },
  );

  worker.on('completed', (job) => console.log(`[email] ${job.data.template} → ${redact(job.data.to)} sent (#${job.id})`));
  worker.on('failed', (job, err) =>
    console.error(
      `[email] ${job?.data.template} → ${job ? redact(job.data.to) : '?'} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    ),
  );
  return worker;
}
