/**
 * AlertsService - Generates actionable alerts from venue sensor data
 *
 * Alert types:
 * - capacity: crowd at or over venue capacity
 * - dwell: avg guest stay dropped vs last week
 * - pulse: pulse score below threshold
 * - connection: data feed went stale
 * - pos: drink count vs POS variance (when POS configured)
 */

import venueSettingsService from './venue-settings.service';
import authService from './auth.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  type: 'capacity' | 'dwell' | 'pulse' | 'connection' | 'pos' | 'custom';
  severity: AlertSeverity;
  title: string;
  body: string;
  timestamp: Date;
  read: boolean;
  actionLabel?: string;
  actionTab?: string;
}

export interface AlertPreferences {
  capacityEnabled: boolean;
  capacityThresholdPct: number;   // alert at X% of capacity
  dwellEnabled: boolean;
  dwellDropPct: number;           // alert when dwell drops by X%
  pulseEnabled: boolean;
  pulseThreshold: number;         // alert when score < X
  connectionEnabled: boolean;
  connectionStaleMinutes: number; // alert when data > X minutes old
  posEnabled: boolean;
  posVariancePct: number;         // alert when variance > X%
  emailEnabled: boolean;
  emailAddress: string;
}

const DEFAULT_PREFS: AlertPreferences = {
  capacityEnabled: true,
  capacityThresholdPct: 90,
  dwellEnabled: true,
  dwellDropPct: 20,
  pulseEnabled: true,
  pulseThreshold: 30,
  connectionEnabled: true,
  connectionStaleMinutes: 10,
  posEnabled: true,
  posVariancePct: 15,
  emailEnabled: false,
  emailAddress: '',
};

const PREFS_KEY = 'pulse_alert_prefs';
const DISMISSED_KEY = 'pulse_alerts_dismissed';

// ── Service ───────────────────────────────────────────────────────────────────

class AlertsService {
  // ─ Preferences ─

  getPreferences(): AlertPreferences {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULT_PREFS };
  }

  savePreferences(prefs: AlertPreferences): void {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  // ─ Dismissed set (IDs of alerts permanently dismissed this session) ─

  private getDismissed(): Set<string> {
    try {
      const raw = sessionStorage.getItem(DISMISSED_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set();
  }

  dismiss(id: string): void {
    const set = this.getDismissed();
    set.add(id);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  }

  // ─ Alert generation ─

  generateAlerts(params: {
    occupancy?: number;
    pulseScore?: number | null;
    dataAgeSeconds?: number;
    avgStayMinutes?: number | null;
    avgStayDelta?: number | null;    // percentage vs last period
    posVariancePct?: number | null;  // VenueScope vs POS variance
  }): Alert[] {
    const prefs = this.getPreferences();
    const dismissed = this.getDismissed();
    const user = authService.getStoredUser();
    const capacity = user?.venueId
      ? venueSettingsService.getCapacity(user.venueId) ?? 0
      : 0;

    const alerts: Alert[] = [];
    const now = new Date();

    // ── Capacity ──
    if (prefs.capacityEnabled && capacity > 0 && params.occupancy != null) {
      const pct = (params.occupancy / capacity) * 100;
      if (pct >= prefs.capacityThresholdPct) {
        const id = `capacity-${Math.floor(now.getTime() / 300000)}`; // dedupe per 5min window
        if (!dismissed.has(id)) {
          alerts.push({
            id,
            type: 'capacity',
            severity: pct >= 100 ? 'critical' : 'warning',
            title: pct >= 100 ? 'Venue at capacity' : 'Approaching capacity',
            body: `${params.occupancy} guests — ${Math.round(pct)}% of your ${capacity} limit. Consider managing entry.`,
            timestamp: now,
            read: false,
            actionLabel: 'View Live',
            actionTab: 'live',
          });
        }
      }
    }

    // ── Dwell time drop ──
    if (prefs.dwellEnabled && params.avgStayDelta != null) {
      if (params.avgStayDelta <= -prefs.dwellDropPct) {
        const id = `dwell-${now.toDateString()}`;
        if (!dismissed.has(id)) {
          alerts.push({
            id,
            type: 'dwell',
            severity: 'warning',
            title: 'Guest dwell time down',
            body: `Average stay dropped ${Math.abs(params.avgStayDelta).toFixed(0)}% vs last week. Check music and environment.`,
            timestamp: now,
            read: false,
            actionLabel: 'View Results',
            actionTab: 'analytics',
          });
        }
      }
    }

    // ── Pulse score ──
    if (prefs.pulseEnabled && params.pulseScore != null) {
      if (params.pulseScore < prefs.pulseThreshold) {
        const id = `pulse-${Math.floor(now.getTime() / 600000)}`; // dedupe per 10min
        if (!dismissed.has(id)) {
          alerts.push({
            id,
            type: 'pulse',
            severity: params.pulseScore < 20 ? 'critical' : 'warning',
            title: 'Low Pulse Score',
            body: `Score is ${params.pulseScore} — below your threshold of ${prefs.pulseThreshold}. Check crowd, sound, and light levels.`,
            timestamp: now,
            read: false,
            actionLabel: 'View Live',
            actionTab: 'live',
          });
        }
      }
    }

    // ── Connection stale ──
    if (prefs.connectionEnabled && params.dataAgeSeconds != null) {
      const staleThreshold = prefs.connectionStaleMinutes * 60;
      if (params.dataAgeSeconds >= staleThreshold) {
        const id = `conn-${Math.floor(now.getTime() / 300000)}`;
        if (!dismissed.has(id)) {
          const mins = Math.floor(params.dataAgeSeconds / 60);
          alerts.push({
            id,
            type: 'connection',
            severity: params.dataAgeSeconds > staleThreshold * 2 ? 'critical' : 'warning',
            title: 'Sensor data stale',
            body: `Last reading was ${mins} minutes ago. Check your Pulse device is powered on and connected to WiFi.`,
            timestamp: now,
            read: false,
          });
        }
      }
    }

    // ── POS variance ──
    if (prefs.posEnabled && params.posVariancePct != null) {
      if (Math.abs(params.posVariancePct) >= prefs.posVariancePct) {
        const id = `pos-${now.toDateString()}`;
        if (!dismissed.has(id)) {
          alerts.push({
            id,
            type: 'pos',
            severity: Math.abs(params.posVariancePct) >= 30 ? 'critical' : 'warning',
            title: 'POS vs Camera mismatch',
            body: `${Math.abs(params.posVariancePct).toFixed(0)}% variance between your POS and VenueScope drink count. Review for discrepancies.`,
            timestamp: now,
            read: false,
            actionLabel: 'View Analytics',
            actionTab: 'analytics',
          });
        }
      }
    }

    return alerts;
  }
}

const alertsService = new AlertsService();
export default alertsService;
