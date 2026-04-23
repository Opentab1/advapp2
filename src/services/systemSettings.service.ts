/**
 * System Settings Service — cross-device, cross-venue persistence for
 * admin-scope data (sales CRM, audit log, etc.). DDB is the source of truth;
 * localStorage is a write-through cache for latency and offline mode.
 *
 * Adding a new key requires a matching entry in the Lambda's
 * SYSTEM_SETTING_KEYS allowlist — the server rejects unknown keys.
 */
import { adminFetch } from './admin.service';

export type SystemSettingKey =
  | 'crmLeads'
  | 'auditLog';

const _lsKey = (key: SystemSettingKey) => `vs_system_${key}`;

export async function loadSystemSetting<T>(
  key: SystemSettingKey,
  fallback: T,
): Promise<T> {
  let cached: T = fallback;
  try {
    const raw = localStorage.getItem(_lsKey(key));
    if (raw) cached = JSON.parse(raw) as T;
  } catch { /* ignore malformed cache */ }

  try {
    const r = await adminFetch(`/admin/system/settings/${key}`);
    const value = (r?.value ?? null) as T | null;
    if (value !== null && value !== undefined) {
      try { localStorage.setItem(_lsKey(key), JSON.stringify(value)); } catch {}
      return value;
    }
    // Server has nothing — if cache has something, push it up so we don't
    // lose the admin's work on first-time cross-device migration.
    if (cached !== fallback) {
      try { await saveSystemSetting(key, cached); } catch {}
      return cached;
    }
    return fallback;
  } catch {
    return cached;
  }
}

export async function saveSystemSetting<T>(
  key: SystemSettingKey,
  value: T,
): Promise<void> {
  try { localStorage.setItem(_lsKey(key), JSON.stringify(value)); } catch {}
  await adminFetch(`/admin/system/settings/${key}`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}

export function peekSystemSetting<T>(
  key: SystemSettingKey,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(_lsKey(key));
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}
