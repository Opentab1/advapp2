/**
 * Venue Settings Service — cross-device persistence for operator-authored data.
 *
 * Any data a manager/owner/partner configures once and expects to see on their
 * phone, their laptop, and their teammates' devices belongs here — not in
 * localStorage. The DDB row is source of truth; localStorage is a read-through
 * cache for latency + offline mode only.
 *
 * Adding a new key requires a matching entry in the Lambda's
 * VENUE_SETTING_KEYS allowlist — server rejects unknown keys.
 */
import { adminFetch } from './admin.service';
import authService from './auth.service';

export type VenueSettingKey =
  | 'staffing'
  | 'hourlyRates'
  | 'reportSchedule'
  | 'calibration'
  | 'achievements';

const _lsKey = (venueId: string, key: VenueSettingKey) =>
  `vs_setting_${venueId}_${key}`;

const getVenueId = (): string => {
  const user = authService.getStoredUser();
  return user?.venueId || 'default';
};

/**
 * Load a setting. Strategy:
 *   1. Try the server (authoritative). If it responds, cache and return.
 *   2. If the network is down or the API isn't configured, fall back to the
 *      localStorage mirror so we still render something.
 */
export async function loadVenueSetting<T>(
  key: VenueSettingKey,
  fallback: T,
  venueId: string = getVenueId(),
): Promise<T> {
  // Read cache first so the UI can render optimistically while the fetch runs.
  let cached: T = fallback;
  try {
    const raw = localStorage.getItem(_lsKey(venueId, key));
    if (raw) cached = JSON.parse(raw) as T;
  } catch { /* ignore malformed cache */ }

  try {
    const r = await adminFetch(
      `/admin/venues/${encodeURIComponent(venueId)}/settings/${key}`,
    );
    const value = (r?.value ?? null) as T | null;
    if (value !== null && value !== undefined) {
      try { localStorage.setItem(_lsKey(venueId, key), JSON.stringify(value)); } catch {}
      return value;
    }
    // Server explicitly has nothing — if the cache has something, warm the
    // server with it so the owner doesn't re-enter data.
    if (cached !== fallback) {
      try { await saveVenueSetting(key, cached, venueId); } catch {}
      return cached;
    }
    return fallback;
  } catch {
    return cached;
  }
}

export async function saveVenueSetting<T>(
  key: VenueSettingKey,
  value: T,
  venueId: string = getVenueId(),
): Promise<void> {
  // Always write the cache first so offline edits aren't lost while the
  // server request is in flight.
  try { localStorage.setItem(_lsKey(venueId, key), JSON.stringify(value)); } catch {}

  await adminFetch(
    `/admin/venues/${encodeURIComponent(venueId)}/settings/${key}`,
    { method: 'POST', body: JSON.stringify({ value }) },
  );
}

/**
 * Synchronous read of the local cache only. For call sites that can't go
 * async yet — should only be used to hydrate initial render, followed by a
 * loadVenueSetting() in useEffect.
 */
export function peekVenueSetting<T>(
  key: VenueSettingKey,
  fallback: T,
  venueId: string = getVenueId(),
): T {
  try {
    const raw = localStorage.getItem(_lsKey(venueId, key));
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}
