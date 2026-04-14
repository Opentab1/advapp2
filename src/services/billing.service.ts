/**
 * billing.service.ts
 *
 * Reads billing/subscription status from the VenueScopeBilling DynamoDB table
 * via the admin Lambda. Caches locally to avoid hammering the API on every
 * page load. Cache is refreshed every 5 minutes.
 */

const ADMIN_API = import.meta.env.VITE_ADMIN_API_URL ?? '';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface BillingStatus {
  venueId: string;
  subscriptionStatus: 'trial' | 'active' | 'past_due' | 'cancelled' | 'trial_expired';
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  trialEndsAt: number;       // epoch seconds
  currentPeriodEnd: number;  // epoch seconds
  gracePeriodEnd: number;    // epoch seconds
  planId: string;
  cancelAtPeriodEnd: boolean;
  hasAccess: boolean;
  trialDaysLeft: number;
  graceDaysLeft: number;
}

interface CacheEntry {
  status: BillingStatus;
  fetchedAt: number;
}

const _cache: Record<string, CacheEntry> = {};

async function fetchStatus(venueId: string): Promise<BillingStatus> {
  const res = await fetch(`${ADMIN_API}/billing/status?venueId=${encodeURIComponent(venueId)}`);
  if (!res.ok) throw new Error(`Billing status fetch failed: ${res.status}`);
  return res.json();
}

const billingService = {
  /**
   * Get billing status for a venue. Reads from cache if fresh, otherwise fetches.
   */
  async getStatus(venueId: string): Promise<BillingStatus | null> {
    try {
      const cached = _cache[venueId];
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.status;
      }
      const status = await fetchStatus(venueId);
      _cache[venueId] = { status, fetchedAt: Date.now() };
      return status;
    } catch (err) {
      console.warn('[billing] getStatus failed:', err);
      return _cache[venueId]?.status ?? null;
    }
  },

  /** Force-refresh billing status (call after successful payment) */
  async refresh(venueId: string): Promise<BillingStatus | null> {
    delete _cache[venueId];
    return billingService.getStatus(venueId);
  },

  /** Redirect to Stripe Checkout to subscribe */
  async redirectToCheckout(venueId: string): Promise<void> {
    const successUrl = `${window.location.origin}/settings?billing=success`;
    const cancelUrl  = `${window.location.origin}/settings?billing=cancelled`;
    const res = await fetch(`${ADMIN_API}/billing/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId, successUrl, cancelUrl }),
    });
    if (!res.ok) throw new Error(`Checkout creation failed: ${res.status}`);
    const { url } = await res.json();
    window.location.href = url;
  },

  /** Redirect to Stripe Customer Portal to manage billing */
  async redirectToPortal(venueId: string): Promise<void> {
    const returnUrl = `${window.location.origin}/settings`;
    const res = await fetch(`${ADMIN_API}/billing/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId, returnUrl }),
    });
    if (!res.ok) throw new Error(`Portal session failed: ${res.status}`);
    const { url } = await res.json();
    window.location.href = url;
  },

  /** Returns true if the venue currently has platform access */
  hasAccess(status: BillingStatus | null): boolean {
    if (!status) return true; // fail open — don't lock out on network error
    return status.hasAccess;
  },

  statusLabel(status: BillingStatus | null): string {
    if (!status) return 'Unknown';
    return {
      trial:         `Trial — ${status.trialDaysLeft} day${status.trialDaysLeft !== 1 ? 's' : ''} left`,
      active:        'Active',
      past_due:      `Past Due — ${status.graceDaysLeft} day${status.graceDaysLeft !== 1 ? 's' : ''} grace period`,
      cancelled:     'Cancelled',
      trial_expired: 'Trial Expired',
    }[status.subscriptionStatus] ?? status.subscriptionStatus;
  },

  statusColor(status: BillingStatus | null): 'green' | 'yellow' | 'red' {
    if (!status) return 'yellow';
    return { trial: 'yellow', active: 'green', past_due: 'red', cancelled: 'red', trial_expired: 'red' }[status.subscriptionStatus] as 'green' | 'yellow' | 'red' ?? 'yellow';
  },
};

export default billingService;
