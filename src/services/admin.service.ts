/**
 * Admin Service - API calls for admin portal functionality
 *
 * All operations use the REST API at VITE_ADMIN_API_URL.
 * GraphQL calls have been replaced with direct REST calls via adminFetch().
 */

// Admin API Lambda — set VITE_ADMIN_API_URL in Amplify environment variables
const ADMIN_API = (import.meta.env.VITE_ADMIN_API_URL ?? '').replace(/\/$/, '');

export async function adminFetch(path: string, options?: RequestInit) {
  if (!ADMIN_API) throw new Error('VITE_ADMIN_API_URL is not configured');
  const res = await fetch(`${ADMIN_API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

// ============ TYPES ============

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
  createdAt?: string;
  notes?: string;
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
    const qs = venueId ? `?venueId=${encodeURIComponent(venueId)}` : '';
    try {
      const data = await adminFetch(`/admin/cameras${qs}`);
      return data.items ?? [];
    } catch (error) {
      console.error('listCameras failed:', error);
      return [];
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
    try {
      const data = await adminFetch('/admin/cameras', {
        method: 'POST',
        body: JSON.stringify(camera),
      });
      return { success: true, cameraId: data.cameraId, message: 'Camera added' };
    } catch (error: any) {
      console.error('createCamera failed:', error);
      return { success: false, message: error.message || 'Failed to add camera' };
    }
  }

  async updateCamera(
    cameraId: string,
    venueId: string,
    fields: Partial<AdminCamera>,
  ): Promise<boolean> {
    console.log('Updating camera:', cameraId);
    try {
      await adminFetch(`/admin/cameras/${encodeURIComponent(cameraId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ venueId, ...fields }),
      });
      return true;
    } catch (error) {
      console.error('updateCamera failed:', error);
      return false;
    }
  }

  async deleteCamera(cameraId: string, venueId: string): Promise<boolean> {
    try {
      await adminFetch(`/admin/cameras/${encodeURIComponent(cameraId)}?venueId=${encodeURIComponent(venueId)}`, {
        method: 'DELETE',
      });
      return true;
    } catch (error) {
      console.error('deleteCamera failed:', error);
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
    emailConfig?: {
      enabled: boolean;
      frequency: 'daily' | 'weekly' | 'monthly';
      recipients: string[];
      reportType: 'full' | 'summary' | 'alerts';
      lastSentAt?: string;
    };
  }>> {
    const venues = await this.listVenues();
    return venues.map(v => ({
      venueId: v.venueId,
      venueName: v.venueName,
      ownerEmail: v.ownerEmail,
    }));
  }

  async updateVenueEmailConfig(venueId: string, config: {
    enabled: boolean;
    frequency: 'daily' | 'weekly' | 'monthly';
    recipients: string[];
    reportType: 'full' | 'summary' | 'alerts';
  }): Promise<boolean> {
    // Persist to localStorage as fallback until endpoint is deployed
    try {
      const stored = localStorage.getItem('venueEmailConfigs') || '{}';
      const configs = JSON.parse(stored);
      configs[venueId] = config;
      localStorage.setItem('venueEmailConfigs', JSON.stringify(configs));
    } catch (_) { /* */ }
    return true;
  }

  async sendTestEmail(_venueId: string): Promise<boolean> {
    console.log('Test email would be sent (endpoint not yet deployed)');
    return true;
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

  async getAdminSettings(): Promise<{
    alertThresholds: { offlineMinutes: number; dataGapHours: number; tempAnomalyDegrees: number };
    notifications: { emailOnCritical: boolean; emailOnNewVenue: boolean; slackWebhook?: string };
    defaults: { defaultPlan: string; defaultTimezone: string; autoProvisionDevice: boolean };
  }> {
    return {
      alertThresholds: { offlineMinutes: 30, dataGapHours: 4, tempAnomalyDegrees: 20 },
      notifications: { emailOnCritical: true, emailOnNewVenue: true },
      defaults: { defaultPlan: 'Standard', defaultTimezone: 'America/New_York', autoProvisionDevice: true },
    };
  }

  async saveAdminSettings(_settings: object): Promise<boolean> {
    return false;
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

    try {
      const stored = localStorage.getItem('adminAuditLog') || '[]';
      const parsed = JSON.parse(stored);
      parsed.unshift(auditEntry);
      localStorage.setItem('adminAuditLog', JSON.stringify(parsed.slice(0, 500)));
    } catch (_) { /* */ }
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

    try {
      const stored = localStorage.getItem('adminAuditLog');
      if (stored) {
        const parsed = JSON.parse(stored);
        const sessionIds = new Set(this.sessionAuditLog.map(e => e.id));
        for (const entry of parsed) {
          if (!sessionIds.has(entry.id)) allEntries.push(entry);
        }
      }
    } catch (_) { /* */ }

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
