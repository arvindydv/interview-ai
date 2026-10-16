import { DEFAULT_SETTINGS, type AppSettings } from '@parakeet/shared';
import { sql } from './db.js';

// Runtime settings edited from the admin console. Cached briefly so the live path never waits on
// Postgres; edits take effect on every API instance within CACHE_MS.
const CACHE_MS = 5_000;
let cached: { value: AppSettings; at: number } | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from public.app_settings`;
  const value = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) value[r.key] = r.value;
  cached = { value: value as unknown as AppSettings, at: Date.now() };
  return cached.value;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const entries = Object.entries(patch).filter(([k, v]) => k in DEFAULT_SETTINGS && v !== undefined);
  for (const [key, value] of entries) {
    await sql`
      insert into public.app_settings (key, value) values (${key}, ${sql.json(value as never)})
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
  }
  cached = null;
  return getSettings();
}
