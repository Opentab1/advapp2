/**
 * Admin Service - API calls for admin portal functionality
 *
 * All operations use the REST API at VITE_ADMIN_API_URL.
 * GraphQL calls have been replaced with direct REST calls via adminFetch().
 */

import cameraService from './camera.service';

// Admin API Lambda — set VITE_ADMIN_API_URL in Amplify environment variables
const ADMIN_API = (import.meta.env.VITE_ADMIN_API_URL ?? '').replace(/\/$/, '');

// Droplet webhook/ops server — same base URL as VITE_CALIBRATION_URL
const OPS_URL = (import.meta.env.VITE_CALIBRATION_URL ?? '').replace(/\/$/, '');

// Ops secret: prefer VITE_OPS_SECRET env var, fall back to localStorage so
// the user can enter it once in the UI without needing an Amplify rebuild.
const LS_SECRET_KEY = 'vs_ops_secret';
export function getOpsSecret(): string {
  return (import.meta.env.VITE_OPS_SECRET ?? localStorage.getItem(LS_SECRET_KEY) ?? '').trim();
}
export function saveOpsSecret(secret: string): void {
  localStorage.setItem(LS_SECRET_KEY, secret.trim());
}
export function clearOpsSecret(): void {
  localStorage.removeItem(LS_SECRET_KEY);
}

async function opsFetch(path: string, options?: RequestInit) {
  if (!OPS_URL) throw new Error('VITE_CALIBRATION_URL is not configured');
  const secret = getOpsSecret();
  if (!secret)  throw new Error('NO_SECRET');
  const res = await fetch(`${OPS_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Ops-Secret': secret,
      ...(options?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any).error ?? `HTTP ${res.status}`);
  return json;
}

// Shared-secret stop-gap auth (see lambda/admin-api/index.mjs comment).
// Real fix is a Cognito JWT authorizer; this just cuts off random scanners.
const ADMIN_KEY = (import.meta.env.VITE_ADMIN_KEY ?? '').trim();

export async function adminFetch(path: string, options?: RequestInit) {
  if (!ADMIN_API) throw new Error('VITE_ADMIN_API_URL is not configured');
  const res = await fetch(`${ADMIN_API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(ADMIN_KEY ? { 'x-admin-key': ADMIN_KEY } : {}),
      ...(options?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

// ============ TYPES ============

export interface EmailConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  reportType: 'full' | 'summary' | 'alerts';
  lastSentAt?: string;
}

export interface AdminVenue {
  venueId: string;
  venueName: string;
  displayName?: string;
  locationId?: string;
  locationName?: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  lastDataTimestamp?: string;
  userCount: number;
  deviceCount: number;
  plan: string;
  ownerEmail?: string;
  ownerName?: string;
  mqttTopic?: string;
  emailConfig?: EmailConfig | null;
  // Forecast onboarding profile
  capacity?: number | null;
  venueTier?: VenueTier | null;
  slowDayCovers?: number | null;
  busyDayCovers?: number | null;
}

export type VenueTier =
  | 'small_bar'
  | 'mid_bar'
  | 'large_bar'
  | 'restaurant'
  | 'nightclub'
  | 'mixed';

export interface VenueProfileInput {
  capacity?: number;
  venueTier?: VenueTier;
  slowDayCovers?: number;
  busyDayCovers?: number;
}

export interface AdminUser {
  userId: string;
  email: string;
  name: string;
  venueId: string;
  venueName: string;
  role: 'owner' | 'manager' | 'staff' | 'admin';
  status: 'active' | 'disabled' | 'pending';
  createdAt: string;
  lastLoginAt?: string;
  emailVerified: boolean;
}

export interface AdminDevice {
  deviceId: string;
  venueId: string;
  venueName: string;
  locationName: string;
  status: 'online' | 'offline' | 'error';
  lastHeartbeat: string;
  firmware: string;
  createdAt: string;
  cpuTemp?: number;
  diskUsage?: number;
  uptime?: string;
}

export interface AdminStats {
  totalVenues: number;
  activeVenues: number;
  totalUsers: number;
  activeUsers: number;
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  // VenueScope-specific
  activeCameras?: number;
  drinksToday?: number;
  theftAlertsToday?: number;
}

export interface CreateVenueInput {
  venueName: string;
  venueId: string;
  locationName?: string;
  locationId?: string;
  ownerEmail: string;
  ownerName: string;
  // Forecast onboarding profile (optional at venue creation, but strongly
  // recommended — a venue created without these fields falls back to the
  // generic industry prior for ~7 days of learning).
  capacity?: number;
  venueTier?: VenueTier;
  slowDayCovers?: number;
  busyDayCovers?: number;
}

export interface CreateUserInput {
  email: string;
  name: string;
  venueId: string;
  venueName: string;
  role: 'owner' | 'manager' | 'staff';
  tempPassword?: string;
}

export interface AdminCamera {
  cameraId: string;
  venueId: string;
  name: string;
  rtspUrl: string;
  modes: string;
  modelProfile: string;
  enabled: boolean;
  segmentSeconds: number;
  segmentInterval?: number;
  barConfigJson?: string;
  tableZonesJson?: string;
  createdAt?: string;
  notes?: string;
  // Layer 2 — zone alignment health check (written by the worker every ~2min).
  // True when a drink_count camera has been live 2+ hours in business hours
  // with zero drinks detected — zones likely mis-drawn or customer_side flipped.
  needsRecalibration?: boolean;
  recalCheckedAt?: number;     // unix seconds
  recalElapsedSec?: number;
  recalTotalDrinks?: number;
}

export interface AdminJob {
  venueId: string;
  jobId: string;
  clipLabel: string;
  analysisMode: string;
  status: string;
  totalDrinks: number;
  drinksPerHour: number;
  hasTheftFlag: boolean;
  unrungDrinks: number;
  confidenceScore: number;
  createdAt: number;
  finishedAt: number;
  elapsedSec: number;
  isLive: boolean;
  bartenderBreakdown?: string;
}

export interface AdminAlert {
  id: string;
  type: 'theft' | 'camera_error' | 'zero_drinks' | 'config_missing';
  severity: 'high' | 'medium' | 'low';
  venueId: string;
  title: string;
  detail: string;
  timestamp: number;
  jobId?: string;
}

export interface OpsStatus {
  worker: {
    status: string;      // 'active' | 'inactive' | 'failed' | 'unknown'
    startedAt: string;
    pid: string;
  };
  system: {
    cpu_pct: number;
    ram_used_mb: number;
    ram_total_mb: number;
    ram_pct: number;
    disk_used_gb: number;
    disk_total_gb: number;
    disk_pct: number;
  };
  liveJobs: Array<{
    venueId: string;
    jobId: string;
    camera: string;
    mode: string;
    startedAt: string;
    drinksPerHour: number;
    progressPct: number;
  }>;
  ts: number;
}

/**
 * Curated Prometheus snapshot from the droplet. Returned by /ops/metrics.
 * All fields are optional since the droplet may be offline or node_exporter
 * may be restarting — UI renders "—" when a field is missing.
 */
export interface OpsMetrics {
  ts: number;                       // server timestamp (seconds since epoch)

  // CPU — raw 1/5/15-minute load averages plus derived % (load1 / cores * 100)
  load1?: number;
  load5?: number;
  load15?: number;
  load1_pct?: number;
  cpu_cores?: number;

  // Memory — bytes + derived used%
  mem_total_bytes?: number;
  mem_available_bytes?: number;
  mem_free_bytes?: number;
  mem_used_pct?: number;

  // Root filesystem — bytes + derived used%
  fs_size_bytes?: number;
  fs_avail_bytes?: number;
  disk_used_pct?: number;

  // Worker state (from venuescope textfile exporter)
  worker_up?: number;               // 1 | 0
  active_jobs?: number;
  queue_depth?: number;
  offline_queue?: number;
  max_parallel?: number;
  max_per_venue?: number;
  venues_count?: number;
  venues_active?: string[];
}

export interface AdminSettingsData {
  alertThresholds: {
    offlineMinutes: number;
    dataGapHours: number;
    tempAnomalyDegrees: number;
  };
  notifications: {
    emailOnCritical: boolean;
    emailOnNewVenue: boolean;
    slackWebhook?: string;
    alertEmail?: string;
  };
  defaults: {
    defaultPlan: string;
    defaultTimezone: string;
    autoProvisionDevice: boolean;
  };
  venuescope: {
    theftThreshold: number;
    workerCount: number;
  };
}

// ============ SERVICE ============

class AdminService {
  // ============ VENUE OPERATIONS ============

  async listVenues(): Promise<AdminVenue[]> {
    console.log('Fetching all venues...');
    const data = await adminFetch('/admin/venues');
    return data.items ?? [];
  }

  async createVenue(input: CreateVenueInput): Promise<{ success: boolean; message: string; venueId?: string; tempPassword?: string }> {
    console.log('Creating venue:', input.venueName);
    const randomStr = Math.random().toString(36).slice(2, 10);
    const randomNum = Math.floor(Math.random() * 900) + 100;
    const tempPassword = `Temp${randomNum}${randomStr}!`;

    try {
      await adminFetch('/admin/venues', {
        method: 'POST',
        body: JSON.stringify({ ...input, tempPassword }),
      });

      this.logAuditEntry({
        action: 'Venue Created',
        actionType: 'create',
        targetType: 'venue',
        targetName: input.venueName,
        details: `Created venue ${input.venueName} (ID: ${input.venueId}) with owner ${input.ownerEmail}`,
      });

      return { success: true, message: 'Venue created successfully', venueId: input.venueId, tempPassword };
    } catch (error: any) {
      console.error('Create venue failed:', error);
      return { success: false, message: error.message || 'Failed to create venue' };
    }
  }

  async deleteVenue(venueId: string): Promise<boolean> {
    try {
      await adminFetch(`/admin/venues/${encodeURIComponent(venueId)}`, { method: 'DELETE' });
      return true;
    } catch (error: any) {
      console.error('deleteVenue failed:', error);
      return false;
    }
  }

  async updateVenueProfile(venueId: string, profile: VenueProfileInput): Promise<boolean> {
    try {
      await adminFetch(`/admin/venues/${encodeURIComponent(venueId)}/profile`, {
        method: 'PATCH',
        body: JSON.stringify(profile),
      });
      this.logAuditEntry({
        action: 'Venue Profile Updated',
        actionType: 'update',
        targetType: 'venue',
        targetName: venueId,
        details: `Updated forecast profile: ${JSON.stringify(profile)}`,
      });
      return true;
    } catch (error) {
      console.error('Update venue profile failed:', error);
      return false;
    }
  }

  async updateVenueStatus(venueId: string, status: 'active' | 'suspended'): Promise<boolean> {
    console.log(`Updating venue ${venueId} status to ${status}`);
    try {
      await adminFetch(`/admin/venues/${encodeURIComponent(venueId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      this.logAuditEntry({
        action: status === 'suspended' ? 'Venue Suspended' : 'Venue Activated',
        actionType: 'update',
        targetType: 'venue',
        targetName: venueId,
        details: `Changed venue ${venueId} status to ${status}`,
      });

      return true;
    } catch (error) {
      console.error('Update venue status failed:', error);
      return false;
    }
  }

  // ============ DROPLET PROVISIONING (Step 7) ============

  /**
   * Provision a new DigitalOcean droplet for a venue. Clones from the master
   * snapshot (Lambda env: DO_SNAPSHOT_ID), injects VS_VENUE_ID via cloud-init,
   * tags it `venue:<id>`. Returns immediately with status=provisioning;
   * poll getDroplet() until status=active and dropletIp is populated.
   */
  async provisionDroplet(venueId: string, options?: {
    snapshotId?: string;
    region?: string;
    size?: string;
    sshKeyId?: number;
  }): Promise<{
    venueId: string;
    dropletId: number;
    dropletStatus: string;
    dropletRegion: string;
    dropletSize: string;
    name: string;
    provisionedAt: string;
    note?: string;
  }> {
    const data = await adminFetch(
      `/admin/venues/${encodeURIComponent(venueId)}/provision-droplet`,
      { method: 'POST', body: JSON.stringify(options || {}) },
    );
    this.logAuditEntry({
      action: 'Droplet Provisioned',
      actionType: 'create',
      targetType: 'venue',
      targetName: venueId,
      details: `Started DO droplet ${data.dropletId} (${data.dropletSize}, ${data.dropletRegion})`,
    });
    return data;
  }

  /**
   * Get current state of a venue's droplet. Polls DO API for live status +
   * IP. Cache-updates the venue record when the IP first appears.
   */
  async getDroplet(venueId: string): Promise<{
    venueId: string;
    dropletId?: number;
    dropletStatus: 'none' | 'provisioning' | 'active' | 'failed' | string;
    dropletIp?: string;
    dropletRegion?: string;
    dropletSize?: string;
    provisionedAt?: string;
    name?: string;
  }> {
    return adminFetch(`/admin/venues/${encodeURIComponent(venueId)}/droplet`);
  }

  /**
   * Destroy the droplet attached to a venue. Soft-clears the DDB metadata
   * even if DO reports 404 (droplet already gone).
   */
  async destroyDroplet(venueId: string): Promise<{
    venueId: string;
    dropletId?: number;
    dropletStatus: string;
  }> {
    const data = await adminFetch(
      `/admin/venues/${encodeURIComponent(venueId)}/droplet`,
      { method: 'DELETE' },
    );
    this.logAuditEntry({
      action: 'Droplet Destroyed',
      actionType: 'delete',
      targetType: 'venue',
      targetName: venueId,
      details: `Destroyed DO droplet ${data.dropletId} for venue ${venueId}`,
    });
    return data;
  }

  // ============ USER OPERATIONS ============

  async listUsers(): Promise<AdminUser[]> {
    console.log('Fetching all users...');
    const data = await adminFetch('/admin/users');
    return data.items ?? [];
  }

  async createUser(input: CreateUserInput): Promise<{ success: boolean; message: string; tempPassword?: string }> {
    console.log('Creating user:', input.email);
    const randomStr = Math.random().toString(36).slice(2, 10);
    const randomNum = Math.floor(Math.random() * 900) + 100;
    const tempPassword = input.tempPassword || `Temp${randomNum}${randomStr}!`;

    try {
      await adminFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...input, tempPassword }),
      });

      this.logAuditEntry({
        action: 'User Created',
        actionType: 'create',
        targetType: 'user',
        targetName: input.name || input.email,
        details: `Created user ${input.email} with role ${input.role} for venue ${input.venueName}`,
      });
      return { success: true, message: 'User created', tempPassword };
    } catch (error: any) {
      console.error('Create user failed:', error);
      return { success: false, message: error.message || 'Failed to create user' };
    }
  }

  async resetUserPassword(email: string): Promise<{ success: boolean; tempPassword?: string; message: string }> {
    console.log('Resetting password for:', email);
    const randomStr = Math.random().toString(36).slice(2, 10);
    const randomNum = Math.floor(Math.random() * 900) + 100;
    const tempPassword = `Reset${randomNum}${randomStr}!`;

    try {
      await adminFetch(`/admin/users/${encodeURIComponent(email)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ tempPassword }),
      });

      this.logAuditEntry({
        action: 'Password Reset',
        actionType: 'update',
        targetType: 'user',
        targetName: email,
        details: `Reset password for user ${email}`,
      });

      return { success: true, tempPassword, message: 'Password reset successfully' };
    } catch (error: any) {
      console.error('Reset password failed:', error);
      return { success: false, message: error.message || 'Failed to reset password' };
    }
  }

  async setUserEnabled(email: string, enabled: boolean): Promise<boolean> {
    console.log(`Setting user ${email} enabled=${enabled}`);
    try {
      const endpoint = enabled
        ? `/admin/users/${encodeURIComponent(email)}/enable`
        : `/admin/users/${encodeURIComponent(email)}/disable`;

      await adminFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });

      this.logAuditEntry({
        action: enabled ? 'User Enabled' : 'User Disabled',
        actionType: 'update',
        targetType: 'user',
        targetName: email,
        details: `${enabled ? 'Enabled' : 'Disabled'} user account ${email}`,
      });

      return true;
    } catch (error) {
      console.error('Set user enabled failed:', error);
      return false;
    }
  }

  // ============ DEVICE OPERATIONS ============

  async listDevices(): Promise<AdminDevice[]> {
    console.log('Fetching all devices...');
    // Device listing — not yet a REST endpoint; return empty
    return [];
  }

  // ============ CAMERA OPERATIONS ============

  async listCameras(venueId?: string): Promise<AdminCamera[]> {
    console.log('Fetching cameras...', venueId ?? 'all');

    // For per-venue listing, query DynamoDB directly — same path the customer
    // VenueScope page uses. This guarantees we get every field the worker
    // writes (tableZonesJson, needsRecalibration, etc.) without depending on
    // the admin Lambda's hand-coded field allowlist staying in sync.
    if (venueId) {
      const cams = await cameraService.listCameras(venueId);
      return cams.map(c => ({
        cameraId:        c.cameraId,
        venueId:         c.venueId,
        name:            c.name,
        rtspUrl:         c.rtspUrl,
        modes:           Array.isArray(c.modes) ? c.modes.join(',') : String(c.modes),
        modelProfile:    c.modelProfile,
        enabled:         c.enabled,
        segmentSeconds:  c.segmentSeconds,
        segmentInterval: c.segmentInterval,
        notes:           c.notes,
        barConfigJson:   c.barConfigJson,
        tableZonesJson:  c.tableZonesJson,
        createdAt:       c.createdAt ? new Date(c.createdAt * 1000).toISOString() : '',
        needsRecalibration: c.needsRecalibration,
        recalCheckedAt:  c.recalCheckedAt,
        recalElapsedSec: c.recalElapsedSec,
        recalTotalDrinks: c.recalTotalDrinks,
      }));
    }

    // Cross-venue listing still goes through the Lambda (rare admin operation).
    if (ADMIN_API) {
      const data = await adminFetch(`/admin/cameras`);
      return data.items ?? [];
    }
    throw new Error('VITE_ADMIN_API_URL is not configured — set it in Amplify → App Settings → Environment Variables');
  }

  async getCamera(venueId: string, cameraId: string): Promise<AdminCamera | null> {
    // Refetch a single camera row straight from DynamoDB. Used to avoid opening
    // a zone-editor modal on stale cached polygons — the optimizer or another
    // admin may have written newer zones since the page loaded.
    try {
      const cams = await this.listCameras(venueId);
      return cams.find(c => c.cameraId === cameraId) ?? null;
    } catch {
      return null;
    }
  }

  async createCamera(camera: {
    venueId: string;
    name: string;
    rtspUrl: string;
    modes: string;
    modelProfile: string;
    enabled: boolean;
    segmentSeconds: number;
    segmentInterval?: number;
    notes?: string;
  }): Promise<{ success: boolean; cameraId?: string; message: string }> {
    // Try Lambda first
    if (ADMIN_API) {
      try {
        const data = await adminFetch('/admin/cameras', { method: 'POST', body: JSON.stringify(camera) });
        return { success: true, cameraId: data.cameraId, message: 'Camera added' };
      } catch (e: any) {
        if (!e.message?.includes('No route')) return { success: false, message: e.message || 'Failed to add camera' };
      }
    }
    // Fallback: direct DynamoDB
    try {
      const modes = camera.modes.split(',').filter(Boolean) as any[];
      const cam = await cameraService.addCamera(camera.venueId, {
        name: camera.name, rtspUrl: camera.rtspUrl, modes,
        enabled: camera.enabled, modelProfile: camera.modelProfile as any,
        segmentSeconds: camera.segmentSeconds, segmentInterval: camera.segmentInterval,
        notes: camera.notes,
      });
      return { success: true, cameraId: cam.cameraId, message: 'Camera added' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Failed to add camera' };
    }
  }

  async updateCamera(
    cameraId: string,
    venueId: string,
    fields: Partial<AdminCamera>,
  ): Promise<boolean> {
    console.log('Updating camera:', cameraId);
    // Try Lambda first
    if (ADMIN_API) {
      try {
        await adminFetch(`/admin/cameras/${encodeURIComponent(cameraId)}`, {
          method: 'PATCH', body: JSON.stringify({ venueId, ...fields }),
        });
        return true;
      } catch (e: any) {
        if (!e.message?.includes('No route')) { console.error('updateCamera failed:', e); return false; }
      }
    }
    // Fallback: direct DynamoDB
    try {
      const updates: Parameters<typeof cameraService.updateCamera>[2] = {};
      if (fields.name      !== undefined) updates.name           = fields.name;
      if (fields.rtspUrl   !== undefined) updates.rtspUrl        = fields.rtspUrl;
      if (fields.modes     !== undefined) updates.modes          = fields.modes.split(',').filter(Boolean) as any[];
      if (fields.enabled   !== undefined) updates.enabled        = fields.enabled;
      if (fields.modelProfile  !== undefined) updates.modelProfile  = fields.modelProfile as any;
      if (fields.segmentSeconds!== undefined) updates.segmentSeconds = fields.segmentSeconds;
      if (fields.segmentInterval!== undefined) updates.segmentInterval = fields.segmentInterval;
      if (fields.notes     !== undefined) updates.notes          = fields.notes;
      if (fields.barConfigJson !== undefined) updates.barConfigJson = fields.barConfigJson;
      await cameraService.updateCamera(venueId, cameraId, updates);
      return true;
    } catch (e: any) {
      console.error('updateCamera DDB fallback failed:', e);
      return false;
    }
  }

  async deleteCamera(cameraId: string, venueId: string): Promise<boolean> {
    // Try Lambda first
    if (ADMIN_API) {
      try {
        await adminFetch(`/admin/cameras/${encodeURIComponent(cameraId)}?venueId=${encodeURIComponent(venueId)}`, { method: 'DELETE' });
        return true;
      } catch (e: any) {
        if (!e.message?.includes('No route')) { console.error('deleteCamera failed:', e); return false; }
      }
    }
    // Fallback: direct DynamoDB
    try {
      await cameraService.deleteCamera(venueId, cameraId);
      return true;
    } catch (e: any) {
      console.error('deleteCamera DDB fallback failed:', e);
      return false;
    }
  }

  async restartCamera(cameraId: string, venueId: string): Promise<void> {
    await this.updateCamera(cameraId, venueId, { enabled: false });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await this.updateCamera(cameraId, venueId, { enabled: true });
  }

  async cancelJob(venueId: string, jobId: string): Promise<boolean> {
    try {
      await adminFetch('/admin/jobs/cancel', {
        method: 'POST',
        body: JSON.stringify({ venueId, jobId }),
      });
      return true;
    } catch (error: any) {
      console.error('cancelJob failed:', error);
      return false;
    }
  }

  // ============ JOB OPERATIONS ============

  async listJobs(venueId?: string, limit = 50): Promise<AdminJob[]> {
    console.log('Fetching jobs...', venueId ?? 'all', `limit=${limit}`);
    const params = new URLSearchParams({ limit: String(limit) });
    if (venueId) params.set('venueId', venueId);
    try {
      const data = await adminFetch(`/admin/jobs?${params.toString()}`);
      return data.items ?? [];
    } catch (error) {
      console.error('listJobs failed:', error);
      return [];
    }
  }

  // ============ STATISTICS ============

  async getStats(): Promise<AdminStats> {
    console.log('Fetching admin stats...');
    try {
      const data = await adminFetch('/admin/stats');
      return data;
    } catch (error) {
      console.warn('getStats failed, falling back to zeros');
      return {
        totalVenues: 0,
        activeVenues: 0,
        totalUsers: 0,
        activeUsers: 0,
        totalDevices: 0,
        onlineDevices: 0,
        offlineDevices: 0,
        activeCameras: 0,
        drinksToday: 0,
        theftAlertsToday: 0,
      };
    }
  }

  // ============ ALERTS ============

  async listAlerts(venueId?: string): Promise<AdminAlert[]> {
    console.log('Fetching alerts...', venueId ?? 'all');
    const qs = venueId ? `?venueId=${encodeURIComponent(venueId)}` : '';
    try {
      const data = await adminFetch(`/admin/alerts${qs}`);
      return data.items ?? [];
    } catch (error) {
      console.error('listAlerts failed:', error);
      return [];
    }
  }

  async getReviewedAlerts(): Promise<string[]> {
    try {
      const data = await adminFetch('/admin/alerts/reviewed');
      return data.ids ?? [];
    } catch {
      return [];
    }
  }

  async saveReviewedAlerts(ids: string[]): Promise<void> {
    try {
      await adminFetch('/admin/alerts/reviewed', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
    } catch (e) {
      console.error('saveReviewedAlerts failed:', e);
    }
  }

  // ============ ACTIVITY LOG ============

  async getRecentActivity(limit: number = 20): Promise<Array<{
    id: string;
    action: string;
    actor: string;
    target: string;
    timestamp: string;
    details?: string;
  }>> {
    // Activity is surfaced via the audit log; return session entries
    const log = await this.getAuditLog({ limit });
    return log.map(e => ({
      id: e.id,
      action: e.action,
      actor: e.performedBy,
      target: e.targetName,
      timestamp: e.timestamp,
      details: e.details,
    }));
  }

  // ============ TEAM MANAGEMENT ============

  async listTeamMembers(): Promise<Array<{
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'sales' | 'support' | 'installer';
    status: 'active' | 'inactive';
    permissions: string[];
    assignedVenues: number;
    createdAt: string;
    lastActivity: string;
  }>> {
    return [];
  }

  async createTeamMember(input: {
    email: string;
    name: string;
    role: 'admin' | 'sales' | 'support' | 'installer';
    permissions: string[];
  }): Promise<{ success: boolean; message: string }> {
    console.log('Creating team member:', input.email);
    return { success: false, message: 'Team management endpoint not yet deployed' };
  }

  async updateTeamMemberPermissions(_email: string, _permissions: string[]): Promise<boolean> {
    return false;
  }

  async deactivateTeamMember(_email: string): Promise<boolean> {
    return false;
  }

  // ============ EMAIL REPORTING ============

  async getAllVenues(): Promise<Array<{
    venueId: string;
    venueName: string;
    ownerEmail?: string;
    emailConfig?: EmailConfig | null;
  }>> {
    const venues = await this.listVenues();
    return venues.map(v => ({
      venueId: v.venueId,
      venueName: v.venueName,
      ownerEmail: v.ownerEmail,
      emailConfig: v.emailConfig ?? null,
    }));
  }

  async updateVenueEmailConfig(venueId: string, config: EmailConfig): Promise<boolean> {
    try {
      await adminFetch(`/admin/venues/${encodeURIComponent(venueId)}/email-config`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
      return true;
    } catch (error: any) {
      console.error('updateVenueEmailConfig failed:', error);
      return false;
    }
  }

  async sendTestEmail(venueId: string): Promise<boolean> {
    try {
      await adminFetch('/admin/email/send-test', {
        method: 'POST',
        body: JSON.stringify({ venueId }),
      });
      return true;
    } catch (error: any) {
      console.error('sendTestEmail failed:', error);
      throw error;
    }
  }

  async sendReportNow(venueId: string, periodDays: number = 1): Promise<boolean> {
    try {
      await adminFetch('/admin/email/send-now', {
        method: 'POST',
        body: JSON.stringify({ venueId, periodDays }),
      });
      return true;
    } catch (error: any) {
      console.error('sendReportNow failed:', error);
      throw error;
    }
  }

  async getEmailGlobalSettings(): Promise<{
    fromEmail: string;
    senderVerified: boolean;
    senderStatus: string;
    scheduleEnabled: boolean;
    scheduleExpression: string;
    scheduleHourET: number;
    scheduleDayOfWeek: number | null;
  }> {
    return adminFetch('/admin/email/settings');
  }

  async saveEmailGlobalSettings(fromEmail: string): Promise<void> {
    await adminFetch('/admin/email/settings', {
      method: 'POST',
      body: JSON.stringify({ fromEmail }),
    });
  }

  async verifySenderEmail(email: string): Promise<string> {
    const data = await adminFetch('/admin/email/verify-sender', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return data.message;
  }

  async checkSenderStatus(email: string): Promise<{ status: string; verified: boolean }> {
    return adminFetch(`/admin/email/sender-status?email=${encodeURIComponent(email)}`);
  }

  async enableAutoSchedule(hourET: number, dayOfWeek: number | null): Promise<void> {
    await adminFetch('/admin/email/schedule/enable', {
      method: 'POST',
      body: JSON.stringify({ hourET, dayOfWeek }),
    });
  }

  async disableAutoSchedule(): Promise<void> {
    await adminFetch('/admin/email/schedule/disable', { method: 'POST' });
  }

  async getEmailLog(venueId?: string): Promise<Array<{
    venueId: string; venueName: string; type: string; recipients: string[];
    subject: string; sentAt: string; totalDrinks: number; theftAlerts: number; status: string;
  }>> {
    const q = venueId ? `?venueId=${encodeURIComponent(venueId)}` : '';
    const data = await adminFetch(`/admin/email/log${q}`);
    return data.entries ?? [];
  }

  async getEmailTemplate(): Promise<{ daily: Record<string, any>; weekly: Record<string, any> }> {
    const data = await adminFetch('/admin/email/template');
    return data.templates ?? { daily: {}, weekly: {} };
  }

  async saveEmailTemplate(type: 'daily' | 'weekly', template: Record<string, any>): Promise<void> {
    await adminFetch('/admin/email/template', {
      method: 'POST',
      body: JSON.stringify({ type, template }),
    });
  }

  async previewEmail(venueId: string, periodDays: number): Promise<string> {
    const data = await adminFetch('/admin/email/preview', {
      method: 'POST',
      body: JSON.stringify({ venueId, periodDays }),
    });
    return data.html ?? '';
  }

  // ============ SYSTEM ANALYTICS ============

  async getSystemAnalytics(): Promise<{
    venueGrowth: Array<{ month: string; count: number }>;
    userGrowth: Array<{ month: string; count: number }>;
    deviceStatus: { online: number; offline: number; error: number };
    dataVolume: Array<{ venueId: string; venueName: string; dataPoints: number }>;
    issuesByType: Array<{ type: string; count: number; trend: 'up' | 'down' | 'stable' }>;
    mrr: number;
    projectedAnnual: number;
    avgRevenuePerVenue: number;
  }> {
    return {
      venueGrowth: [],
      userGrowth: [],
      deviceStatus: { online: 0, offline: 0, error: 0 },
      dataVolume: [],
      issuesByType: [],
      mrr: 0,
      projectedAnnual: 0,
      avgRevenuePerVenue: 0,
    };
  }

  // ============ ADMIN SETTINGS ============

  private _defaultSettings(): AdminSettingsData {
    return {
      alertThresholds: { offlineMinutes: 30, dataGapHours: 4, tempAnomalyDegrees: 20 },
      notifications:   { emailOnCritical: true, emailOnNewVenue: true, slackWebhook: '', alertEmail: '' },
      defaults:        { defaultPlan: 'Standard', defaultTimezone: 'America/New_York', autoProvisionDevice: true },
      venuescope:      { theftThreshold: 5, workerCount: 0 },
    };
  }

  async getAdminSettings(): Promise<AdminSettingsData> {
    try {
      const data = await adminFetch('/admin/settings');
      const saved = data.settings ?? {};
      // Deep merge saved values over defaults so new fields always have a value
      const defaults = this._defaultSettings();
      return {
        alertThresholds: { ...defaults.alertThresholds, ...(saved.alertThresholds ?? {}) },
        notifications:   { ...defaults.notifications,   ...(saved.notifications   ?? {}) },
        defaults:        { ...defaults.defaults,         ...(saved.defaults        ?? {}) },
        venuescope:      { ...defaults.venuescope,       ...(saved.venuescope      ?? {}) },
      };
    } catch (e) {
      console.warn('getAdminSettings: using defaults —', e);
      return this._defaultSettings();
    }
  }

  async saveAdminSettings(settings: AdminSettingsData): Promise<boolean> {
    try {
      await adminFetch('/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ settings }),
      });
      return true;
    } catch (e) {
      console.error('saveAdminSettings failed:', e);
      return false;
    }
  }

  // ============ OPS API (calls droplet webhook server directly) ============

  async getOpsStatus(): Promise<OpsStatus> {
    const data = await opsFetch('/ops/status');
    return data as OpsStatus;
  }

  async getOpsLogs(lines = 150, filter = ''): Promise<{ lines: string[]; count: number }> {
    const qs = new URLSearchParams({ lines: String(lines) });
    if (filter) qs.set('filter', filter);
    const data = await opsFetch(`/ops/logs?${qs.toString()}`);
    return data as { lines: string[]; count: number };
  }

  /**
   * Curated Prometheus metrics from the droplet. Parsed server-side so the
   * payload is small (~1 KB) and ready to plot.
   */
  async getOpsMetrics(): Promise<OpsMetrics> {
    const data = await opsFetch('/ops/metrics');
    return data as OpsMetrics;
  }

  /**
   * Probe a set of RTSP URLs from the droplet's network vantage point.
   * Returns per-camera {ok, reason, width, height, fps}. Returns null if the
   * endpoint isn't deployed yet (wizard degrades gracefully).
   */
  async probeCameras(
    cameras: Array<{ name: string; rtspUrl: string }>,
  ): Promise<Array<{ ok: boolean; reason: string; width?: number; height?: number; fps?: number }>> {
    const res = await opsFetch('/ops/probe-cameras', {
      method: 'POST',
      body:   JSON.stringify({ cameras }),
    });
    return res?.results ?? [];
  }

  async restartWorker(): Promise<{ ok: boolean; msg: string }> {
    const data = await opsFetch('/ops/restart', { method: 'POST', body: '{}' });
    return data as { ok: boolean; msg: string };
  }

  async deployUpdate(): Promise<{ ok: boolean; output: string[] }> {
    const data = await opsFetch('/ops/deploy', { method: 'POST', body: '{}' });
    return data as { ok: boolean; output: string[] };
  }

  /** Read the HLS camera proxy upstream (ip:port) from the droplet's Caddyfile. */
  async getCamProxy(): Promise<{ ip: string; port: number }> {
    const data = await opsFetch('/ops/cam-proxy');
    return data as { ip: string; port: number };
  }

  /** Update the HLS camera proxy upstream and reload Caddy. */
  async updateCamProxy(args: { ip?: string; port: number }):
    Promise<{ ok: boolean; ip: string; port: number }> {
    const data = await opsFetch('/ops/cam-proxy', {
      method: 'POST',
      body:   JSON.stringify(args),
    });
    return data as { ok: boolean; ip: string; port: number };
  }

  /** Run auto_bar_config on a camera's stream and return the suggested config. */
  async autoDetectZones(venueId: string, cameraId: string): Promise<any> {
    const qs = new URLSearchParams({ venue_id: venueId, camera_id: cameraId }).toString();
    const data = await opsFetch(`/ops/auto-detect-zones?${qs}`);
    return (data as any).config;
  }

  /** Run auto_table_config on a camera's stream, return suggested table zones. */
  async autoDetectTables(venueId: string, cameraId: string): Promise<Array<{
    table_id: string; label: string; polygon: [number, number][];
  }>> {
    const qs = new URLSearchParams({ venue_id: venueId, camera_id: cameraId }).toString();
    const data = await opsFetch(`/ops/auto-detect-tables?${qs}`);
    return (data as any).zones ?? [];
  }

  /** Snapshot of a camera's accuracy telemetry for the zone editor badge. */
  async getCameraAccuracy(venueId: string, cameraId: string): Promise<{
    total_drinks_shift: number;
    high_conf_serves_24h: number;
    low_conf_serves_24h: number;
    review_queue_count: number;
    accuracy_pct: number | null;
    pos_variance_pct: number | null;
    needs_recalibration: boolean;
  }> {
    const qs = new URLSearchParams({ venue_id: venueId, camera_id: cameraId }).toString();
    return opsFetch(`/ops/camera-accuracy?${qs}`) as any;
  }

  /** Last ~60 drink detection events (normalized x/y) for live overlay flashes. */
  async getRecentServes(venueId: string, cameraId: string): Promise<{
    events: Array<{ t_sec: number; score: number; x: number; y: number; zone?: string }>;
  }> {
    const qs = new URLSearchParams({ venue_id: venueId, camera_id: cameraId }).toString();
    return opsFetch(`/ops/recent-serves?${qs}`) as any;
  }

  // ============ AUDIT LOG ============

  private sessionAuditLog: Array<{
    id: string;
    timestamp: string;
    action: string;
    actionType: 'create' | 'update' | 'delete' | 'access' | 'config';
    targetType: 'venue' | 'user' | 'device' | 'system';
    targetName: string;
    performedBy: string;
    performedByRole: string;
    details: string;
    ipAddress: string;
  }> = [];

  logAuditEntry(entry: {
    action: string;
    actionType: 'create' | 'update' | 'delete' | 'access' | 'config';
    targetType: 'venue' | 'user' | 'device' | 'system';
    targetName: string;
    details: string;
  }): void {
    const now = new Date();
    const auditEntry = {
      id: `audit-${now.getTime()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: now.toISOString(),
      action: entry.action,
      actionType: entry.actionType,
      targetType: entry.targetType,
      targetName: entry.targetName,
      performedBy: 'admin@advizia.com',
      performedByRole: 'Super Admin',
      details: entry.details,
      ipAddress: 'Session',
    };

    this.sessionAuditLog.unshift(auditEntry);
    console.log('Audit logged:', auditEntry.action, '-', auditEntry.targetName);

    // Persist to DynamoDB so every admin + every device sees the same trail.
    // Kept capped at 500 entries so the blob doesn't grow unbounded; older
    // history is expected to live in a dedicated audit table later.
    void (async () => {
      try {
        const { loadSystemSetting, saveSystemSetting } =
          await import('./systemSettings.service');
        const existing = await loadSystemSetting<typeof this.sessionAuditLog>(
          'auditLog', []);
        const merged = [auditEntry, ...existing].slice(0, 500);
        await saveSystemSetting('auditLog', merged);
      } catch { /* logging is best-effort; never surface a failure to callers */ }
    })();
  }

  async getAuditLog(options: {
    limit?: number;
    filterType?: 'all' | 'venue' | 'user' | 'device' | 'system';
    dateRange?: '24h' | '7d' | '30d' | '90d' | 'all';
    searchTerm?: string;
  } = {}): Promise<Array<{
    id: string;
    timestamp: string;
    action: string;
    actionType: 'create' | 'update' | 'delete' | 'access' | 'config';
    targetType: 'venue' | 'user' | 'device' | 'system';
    targetName: string;
    performedBy: string;
    performedByRole: string;
    details: string;
    ipAddress: string;
  }>> {
    const allEntries: typeof this.sessionAuditLog = [];

    allEntries.push(...this.sessionAuditLog);

    // Pull the cross-device log from DynamoDB so another admin's actions
    // (on their laptop or phone) are visible here too.
    try {
      const { loadSystemSetting } = await import('./systemSettings.service');
      const persisted = await loadSystemSetting<typeof this.sessionAuditLog>(
        'auditLog', []);
      const sessionIds = new Set(this.sessionAuditLog.map(e => e.id));
      for (const entry of persisted) {
        if (!sessionIds.has(entry.id)) allEntries.push(entry);
      }
    } catch (_) { /* non-fatal — session log still shows */ }

    try {
      const venues = await this.listVenues();
      const users = await this.listUsers();

      for (const venue of venues) {
        if (venue.createdAt) {
          allEntries.push({
            id: `synthetic-venue-${venue.venueId}`,
            timestamp: venue.createdAt,
            action: 'Venue Created',
            actionType: 'create',
            targetType: 'venue',
            targetName: venue.venueName || venue.venueId,
            performedBy: 'admin@advizia.com',
            performedByRole: 'Super Admin',
            details: `Created venue with ID: ${venue.venueId}`,
            ipAddress: 'System',
          });
        }
      }

      for (const user of users) {
        if (user.createdAt) {
          allEntries.push({
            id: `synthetic-user-${user.userId}`,
            timestamp: user.createdAt,
            action: 'User Created',
            actionType: 'create',
            targetType: 'user',
            targetName: user.name || user.email,
            performedBy: 'admin@advizia.com',
            performedByRole: 'Super Admin',
            details: `Created user ${user.email} for venue ${user.venueName}`,
            ipAddress: 'System',
          });
        }
        if (user.lastLoginAt) {
          allEntries.push({
            id: `synthetic-login-${user.userId}-${user.lastLoginAt}`,
            timestamp: user.lastLoginAt,
            action: 'User Login',
            actionType: 'access',
            targetType: 'user',
            targetName: user.name || user.email,
            performedBy: user.email,
            performedByRole: user.role,
            details: `User logged in to ${user.venueName}`,
            ipAddress: 'User Device',
          });
        }
      }
    } catch (error) {
      console.warn('Could not generate synthetic audit entries:', error);
    }

    allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const now = new Date();
    let cutoffDate: Date | null = null;
    switch (options.dateRange) {
      case '24h': cutoffDate = new Date(now.getTime() - 86400000); break;
      case '7d':  cutoffDate = new Date(now.getTime() - 7 * 86400000); break;
      case '30d': cutoffDate = new Date(now.getTime() - 30 * 86400000); break;
      case '90d': cutoffDate = new Date(now.getTime() - 90 * 86400000); break;
      default:    cutoffDate = null;
    }

    let filtered = allEntries;
    if (cutoffDate) filtered = filtered.filter(e => new Date(e.timestamp) >= cutoffDate!);
    if (options.filterType && options.filterType !== 'all') {
      filtered = filtered.filter(e => e.targetType === options.filterType);
    }

    const seen = new Set<string>();
    filtered = filtered.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return filtered.slice(0, options.limit ?? 100);
  }
}

export const adminService = new AdminService();
export default adminService;
