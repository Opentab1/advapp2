/**
 * Square POS frontend service.
 * Credentials stored in localStorage under 'venuescope_square_creds'.
 * NOTE: Square's Catalog/Orders API requires server-side calls in production
 * (CORS restrictions). This service supports both direct calls (for testing)
 * and a backend proxy pattern.
 */

const STORAGE_KEY = 'venuescope_square_creds';

export interface SquareCredentials {
  accessToken: string;
  locationId: string;
  environment: 'sandbox' | 'production';
}

export interface SquareMetrics {
  drinkCount: number;
  revenue: number;
  orderCount: number;
  avgOrderValue: number;
  topItems: Array<{ name: string; count: number; revenue: number }>;
  windowStart: string;
  windowEnd: string;
}

function getSquareBaseUrl(env: 'sandbox' | 'production'): string {
  return env === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

const squarePosService = {
  saveCredentials(creds: SquareCredentials): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  },

  getCredentials(): SquareCredentials | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SquareCredentials;
      if (!parsed.accessToken || !parsed.locationId) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  clearCredentials(): void {
    localStorage.removeItem(STORAGE_KEY);
  },

  isConfigured(): boolean {
    const creds = squarePosService.getCredentials();
    return !!(creds?.accessToken && creds?.locationId);
  },

  /**
   * Test the connection by fetching location info.
   * Tries the backend proxy first; falls back to Square API directly (sandbox only).
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const creds = squarePosService.getCredentials();
    if (!creds) return { ok: false, message: 'No credentials configured.' };

    // 1. Try backend proxy
    const proxyBase = (import.meta.env.VITE_VENUESCOPE_URL as string | undefined)?.replace(/\/$/, '');
    if (proxyBase) {
      try {
        const res = await fetch(`${proxyBase}/api/pos/square/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: creds.accessToken, locationId: creds.locationId, environment: creds.environment }),
        });
        if (res.ok) {
          const data = await res.json() as { ok?: boolean; message?: string };
          return { ok: data.ok ?? true, message: data.message ?? 'Connected via proxy.' };
        }
        if (res.status !== 404) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          return { ok: false, message: data.error ?? `Proxy error (${res.status})` };
        }
        // 404 → proxy not deployed, fall through to direct
      } catch {
        // Network error on proxy, fall through
      }
    }

    // 2. Direct Square API call (works in sandbox, blocked by CORS in production)
    try {
      const base = getSquareBaseUrl(creds.environment);
      const res = await fetch(`${base}/v2/locations/${creds.locationId}`, {
        headers: {
          'Authorization': `Bearer ${creds.accessToken}`,
          'Square-Version': '2024-01-18',
        },
      });
      if (res.ok) {
        const data = await res.json() as { location?: { name?: string } };
        const name = data.location?.name ?? creds.locationId;
        return { ok: true, message: `Connected — ${name}` };
      }
      const errData = await res.json().catch(() => ({})) as { errors?: Array<{ detail?: string }> };
      const detail = errData.errors?.[0]?.detail ?? `HTTP ${res.status}`;
      return { ok: false, message: detail };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('CORS') || msg.includes('fetch')) {
        return { ok: false, message: 'CORS blocked — production API requires backend proxy.' };
      }
      return { ok: false, message: msg };
    }
  },

  /**
   * Fetch order metrics for a time window.
   * Tries the backend proxy first; falls back to Square Orders API directly.
   */
  async getMetrics(startTime: Date, endTime: Date): Promise<SquareMetrics> {
    const creds = squarePosService.getCredentials();
    if (!creds) throw new Error('Square credentials not configured.');

    const windowStart = startTime.toISOString();
    const windowEnd   = endTime.toISOString();

    // 1. Try backend proxy
    const proxyBase = (import.meta.env.VITE_VENUESCOPE_URL as string | undefined)?.replace(/\/$/, '');
    if (proxyBase) {
      try {
        const res = await fetch(`${proxyBase}/api/pos/square/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: creds.accessToken,
            locationId: creds.locationId,
            environment: creds.environment,
            startTime: windowStart,
            endTime: windowEnd,
          }),
        });
        if (res.ok) {
          return await res.json() as SquareMetrics;
        }
        if (res.status !== 404) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? `Proxy error (${res.status})`);
        }
        // 404 → fall through
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('404') && !msg.includes('proxy')) throw err;
      }
    }

    // 2. Direct Square Orders API (sandbox only)
    const base = getSquareBaseUrl(creds.environment);
    const body = {
      location_ids: [creds.locationId],
      query: {
        filter: {
          date_time_filter: {
            created_at: {
              start_at: windowStart,
              end_at: windowEnd,
            },
          },
          state_filter: { states: ['COMPLETED'] },
        },
      },
      limit: 500,
    };

    const res = await fetch(`${base}/v2/orders/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({})) as { errors?: Array<{ detail?: string }> };
      const detail = errData.errors?.[0]?.detail ?? `HTTP ${res.status}`;
      throw new Error(detail);
    }

    const data = await res.json() as {
      orders?: Array<{
        total_money?: { amount?: number };
        line_items?: Array<{
          name?: string;
          quantity?: string;
          total_money?: { amount?: number };
        }>;
      }>;
    };

    const orders = data.orders ?? [];
    const orderCount = orders.length;
    // Square stores money in cents
    const revenue = orders.reduce((sum, o) => sum + ((o.total_money?.amount ?? 0) / 100), 0);
    const avgOrderValue = orderCount > 0 ? revenue / orderCount : 0;

    // Aggregate line items
    const itemMap = new Map<string, { count: number; revenue: number }>();
    for (const order of orders) {
      for (const item of order.line_items ?? []) {
        const name = item.name ?? 'Unknown';
        const qty  = parseFloat(item.quantity ?? '1') || 1;
        const rev  = (item.total_money?.amount ?? 0) / 100;
        const existing = itemMap.get(name);
        if (existing) {
          existing.count   += qty;
          existing.revenue += rev;
        } else {
          itemMap.set(name, { count: qty, revenue: rev });
        }
      }
    }

    const topItems = Array.from(itemMap.entries())
      .map(([name, { count, revenue: rev }]) => ({ name, count, revenue: rev }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const drinkCount = topItems.reduce((sum, i) => sum + i.count, 0);

    return { drinkCount, revenue, orderCount, avgOrderValue, topItems, windowStart, windowEnd };
  },
};

export default squarePosService;
