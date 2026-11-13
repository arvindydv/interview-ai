import { redactSensitive } from '@parakeet/shared';
import { sql } from './db.js';

// Audit trail (public.audit_logs): who did what to whose data. Detail is redacted before it is stored,
// and a failed audit write never fails the request it describes.

export type AuditActor = 'user' | 'admin' | 'worker' | 'applier' | 'system';

export async function audit(entry: {
  userId: string | null;
  actor: AuditActor;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: unknown;
  ip?: string | null;
}) {
  try {
    await sql`
      insert into public.audit_logs (user_id, actor, action, target_type, target_id, detail, ip)
      values (${entry.userId}, ${entry.actor}, ${entry.action}, ${entry.targetType ?? null}, ${entry.targetId ?? null},
              ${entry.detail === undefined ? null : sql.json(redactSensitive(entry.detail) as never)}, ${entry.ip ?? null})`;
  } catch (err) {
    console.error('[audit] could not record', entry.action, (err as Error).message);
  }
}
