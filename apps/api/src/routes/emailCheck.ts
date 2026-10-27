import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EmailCheck } from '@parakeet/shared';
import { isDisposableEmail } from '../lib/freeTrial.js';

// Lets the sign-up form turn away temporary inboxes before a code is sent. Not a security boundary
// (anyone can call Supabase directly): the free trial is still refused for them in lib/freeTrial.ts.

const body = z.object({ email: z.email().max(320) });

export default async function emailCheckRoutes(app: FastifyInstance) {
  app.post('/v1/auth/email-check', async (req, reply): Promise<EmailCheck | void> => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Enter a valid email address.' });
    if (isDisposableEmail(parsed.data.email)) {
      return { ok: false, message: 'Temporary email addresses can’t be used. Please sign up with your own email.' };
    }
    return { ok: true };
  });
}
