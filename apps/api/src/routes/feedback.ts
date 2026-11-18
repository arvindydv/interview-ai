import type { FastifyInstance } from 'fastify';
import type { FeedbackReceipt, MyReview, PublicReviews } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { MAX_FEEDBACK_PER_HOUR, feedbackBody } from '../lib/feedback.js';
import { redis } from '../lib/redis.js';

/** How many approved reviews the website shows. */
const PUBLIC_LIMIT = 12;
/** The public list is the same for everyone, so it is cached briefly instead of queried per visit. */
const PUBLIC_CACHE_MS = 60_000;
let publicCache: { at: number; value: PublicReviews } | null = null;

/** Counts a submission against the user's hourly budget. Returns false once it is spent. */
async function allowFeedback(userId: string) {
  const key = `feedback:${userId}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 3600);
  return n <= MAX_FEEDBACK_PER_HOUR;
}

/** Drops the cached public list, e.g. after an admin approves or hides a review. */
export function forgetPublicReviews() {
  publicCache = null;
}

/** Public: approved reviews their authors agreed to show. */
export async function publicReviewRoutes(app: FastifyInstance) {
  app.get('/v1/reviews', async (_req, reply): Promise<PublicReviews> => {
    reply.header('cache-control', 'public, max-age=60');
    if (publicCache && Date.now() - publicCache.at < PUBLIC_CACHE_MS) return publicCache.value;
    const [rows, [agg]] = await Promise.all([
      sql<{ id: string; rating: number; message: string; display_name: string; role: string; created_at: Date }[]>`
        select id, rating, message, display_name, role, created_at
        from public.feedback
        where kind = 'review' and publish and status = 'approved'
        order by rating desc, created_at desc
        limit ${PUBLIC_LIMIT}`,
      sql<{ count: number; average: string | null }[]>`
        select count(*)::int as count, round(avg(rating), 1)::text as average
        from public.feedback
        where kind = 'review' and publish and status = 'approved'`,
    ]);
    const value: PublicReviews = {
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        message: r.message,
        displayName: r.display_name,
        role: r.role,
        createdAt: r.created_at.toISOString(),
      })),
      count: agg.count,
      average: agg.average === null ? null : Number(agg.average),
    };
    publicCache = { at: Date.now(), value };
    return value;
  });
}

export default async function feedbackRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/feedback/review', async (req): Promise<MyReview | null> => {
    const [r] = await sql<
      { rating: number; message: string; display_name: string; role: string; publish: boolean; status: MyReview['status']; updated_at: Date }[]
    >`
      select rating, message, display_name, role, publish, status, updated_at
      from public.feedback where user_id = ${req.user.id} and kind = 'review'`;
    if (!r) return null;
    return {
      rating: r.rating,
      message: r.message,
      displayName: r.display_name,
      role: r.role,
      publish: r.publish,
      status: r.status,
      updatedAt: r.updated_at.toISOString(),
    };
  });

  app.post('/v1/feedback', async (req, reply): Promise<FeedbackReceipt | void> => {
    const body = feedbackBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid feedback' });
    }
    if (!(await allowFeedback(req.user.id))) {
      return reply.code(429).send({ error: 'rate_limited', message: 'You’ve sent a lot of feedback. Please try again in an hour.' });
    }
    const { kind, rating, message, displayName, role, publish } = body.data;

    await sql`
      insert into public.users (id, email, auth_provider)
      values (${req.user.id}, ${req.user.email}, ${req.user.provider})
      on conflict (id) do nothing`;
    const [row] =
      kind === 'review'
        ? await sql<{ id: string; created_at: Date }[]>`
            insert into public.feedback (user_id, kind, rating, message, display_name, role, publish)
            values (${req.user.id}, 'review', ${rating!}, ${message}, ${displayName}, ${role}, ${publish})
            on conflict (user_id) where kind = 'review' do update
              set rating = excluded.rating, message = excluded.message, display_name = excluded.display_name,
                  role = excluded.role, publish = excluded.publish,
                  -- An edited review goes back for approval before it is shown again.
                  status = 'new', updated_at = now()
            returning id, created_at`
        : await sql<{ id: string; created_at: Date }[]>`
            insert into public.feedback (user_id, kind, message)
            values (${req.user.id}, ${kind}, ${message})
            returning id, created_at`;
    if (kind === 'review') forgetPublicReviews();
    req.log.info({ feedbackId: row.id, kind, rating }, 'feedback received');
    return { id: row.id, createdAt: row.created_at.toISOString() };
  });
}
