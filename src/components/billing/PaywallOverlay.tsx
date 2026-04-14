/**
 * PaywallOverlay.tsx
 *
 * Full-screen overlay shown when a venue's subscription has lapsed.
 * Also exports a BillingBanner for the soft warning during grace period / trial ending.
 */
import { useState } from 'react';
import { CreditCard, Lock, AlertTriangle, X } from 'lucide-react';
import type { BillingStatus } from '../../services/billing.service';
import billingService from '../../services/billing.service';

// ── Hard paywall — shown when hasAccess = false ───────────────────────────────

export function PaywallOverlay({ venueId, status }: { venueId: string; status: BillingStatus | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSubscribe = async () => {
    setLoading(true); setError('');
    try { await billingService.redirectToCheckout(venueId); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Something went wrong'); setLoading(false); }
  };

  const label = !status || status.subscriptionStatus === 'trial_expired'
    ? 'Your free trial has ended.'
    : status.subscriptionStatus === 'past_due'
    ? 'Your payment is overdue and the grace period has expired.'
    : status.subscriptionStatus === 'cancelled'
    ? 'Your subscription has been cancelled.'
    : 'Your account is not active.';

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-whoop-panel border border-whoop-divider rounded-2xl max-w-md w-full p-8 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-teal/10 border border-teal/30 flex items-center justify-center mx-auto mb-5">
          <Lock className="w-7 h-7 text-teal" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Account Access Required</h2>
        <p className="text-sm text-text-muted mb-6">{label}</p>

        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full py-3 px-6 rounded-xl bg-teal text-black font-semibold text-sm hover:bg-teal/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mb-3"
        >
          <CreditCard className="w-4 h-4" />
          {loading ? 'Redirecting…' : 'Subscribe Now'}
        </button>

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

        <p className="text-[11px] text-text-muted mt-4">
          Secure checkout powered by Stripe. Cancel anytime.
        </p>
      </div>
    </div>
  );
}

// ── Soft banner — shown during trial or grace period ─────────────────────────

export function BillingBanner({ venueId, status, onDismiss }: {
  venueId: string;
  status: BillingStatus;
  onDismiss: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    try { await billingService.redirectToCheckout(venueId); }
    catch { setLoading(false); }
  };

  const handlePortal = async () => {
    setLoading(true);
    try { await billingService.redirectToPortal(venueId); }
    catch { setLoading(false); }
  };

  const isPastDue = status.subscriptionStatus === 'past_due';
  const isTrial   = status.subscriptionStatus === 'trial';

  const message = isPastDue
    ? `Payment failed — ${status.graceDaysLeft} day${status.graceDaysLeft !== 1 ? 's' : ''} until access is suspended.`
    : isTrial && status.trialDaysLeft <= 3
    ? `Your free trial ends in ${status.trialDaysLeft} day${status.trialDaysLeft !== 1 ? 's' : ''}.`
    : null;

  if (!message) return null;

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 text-sm rounded-xl border mb-4 ${
      isPastDue
        ? 'bg-red-500/10 border-red-500/30 text-red-300'
        : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
    }`}>
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {isPastDue ? (
        <button onClick={handlePortal} disabled={loading} className="text-xs font-semibold underline whitespace-nowrap">
          {loading ? '…' : 'Update Payment'}
        </button>
      ) : (
        <button onClick={handleSubscribe} disabled={loading} className="text-xs font-semibold underline whitespace-nowrap">
          {loading ? '…' : 'Subscribe'}
        </button>
      )}
      <button onClick={onDismiss} className="text-current opacity-60 hover:opacity-100 flex-shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
