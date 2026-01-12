/**
 * Admin Service - API calls for admin portal functionality
 * 
 * This service handles all admin operations:
 * - Venue management (list, create, update, suspend)
 * - User management (list, create, reset password, disable)
 * - Device management (list, status, restart)
 * - System statistics
 * 
 * NOTE: Some operations require additional Lambda functions to be deployed.
 * See /workspace/ADMIN_SCHEMA.graphql for required AppSync schema updates.
 */

import { generateClient } from 'aws-amplify/api';

// ============ TYPES ============

export interface AdminVenue {
  venueId: string;
  venueName: string;
  displayName?: string;
  locationId: string;
  locationName?: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
  lastDataTimestamp?: string;
  userCount: number;
  deviceCount: number;
  plan: string;
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
}

export interface CreateVenueInput {
  venueName: string;
  venueId: string;
  locationName: string;
  locationId: string;
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

// ============ SERVICE ============

class AdminService {
  private client = generateClient();

  // ============ VENUE OPERATIONS ============

  /**
   * List all venues from VenueConfig table
   * NOTE: Requires listAllVenues GraphQL query to be added to AppSync
   */
  async listVenues(): Promise<AdminVenue[]> {
    console.log('📋 Fetching all venues...');
    
    try {
      // Try the GraphQL query first (if it exists)
      const query = `
        query ListAllVenues($limit: Int, $nextToken: String) {
          listAllVenues(limit: $limit, nextToken: $nextToken) {
            items {
              venueId
              venueName
              displayName
              locationId
              locationName
              status
              createdAt
              lastDataTimestamp
              userCount
              deviceCount
              plan
              mqttTopic
            }
            nextToken
          }
        }
      `;

      const result = await this.client.graphql({
        query,
        variables: { limit: 100 }
      }) as any;

      if (result.data?.listAllVenues?.items) {
        console.log('✅ Fetched venues from GraphQL:', result.data.listAllVenues.items.length);
        return result.data.listAllVenues.items;
      }
    } catch (error: any) {
      console.warn('⚠️ listAllVenues query not available, using fallback');
      // GraphQL query doesn't exist yet - this is expected until schema is updated
    }

    // Fallback: Return empty array with instruction
    console.log('ℹ️ Venue listing requires listAllVenues Lambda/resolver to be deployed');
    return [];
  }

  /**
   * Create a new venue with owner account
   * Uses existing createVenue mutation
   */
  async createVenue(input: CreateVenueInput): Promise<{ success: boolean; message: string; venueId?: string; tempPassword?: string }> {
    console.log('🏢 Creating venue:', input.venueName);
    
    // Generate temp password
    const randomStr = Math.random().toString(36).slice(2, 10);
    const randomNum = Math.floor(Math.random() * 900) + 100;
    const tempPassword = `Temp${randomNum}${randomStr}!`;
    
    try {
      const mutation = `
        mutation CreateVenue(
          $venueName: String!
          $venueId: String!
          $locationName: String!
          $locationId: String!
          $ownerEmail: String!
          $ownerName: String!
          $tempPassword: String!
        ) {
          createVenue(
            venueName: $venueName
            venueId: $venueId
            locationName: $locationName
            locationId: $locationId
            ownerEmail: $ownerEmail
            ownerName: $ownerName
            tempPassword: $tempPassword
          ) {
            success
            message
            venueId
            ownerEmail
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: { ...input, tempPassword }
      }) as any;

      if (result.data?.createVenue?.success) {
        return {
          success: true,
          message: 'Venue created successfully',
          venueId: result.data.createVenue.venueId,
          tempPassword
        };
      }

      return {
        success: false,
        message: result.data?.createVenue?.message || 'Failed to create venue'
      };
    } catch (error: any) {
      console.error('❌ Create venue failed:', error);
      return {
        success: false,
        message: error.message || 'Failed to create venue'
      };
    }
  }

  /**
   * Update venue status (active, suspended)
   * NOTE: Requires updateVenueStatus mutation in AppSync
   */
  async updateVenueStatus(venueId: string, status: 'active' | 'suspended'): Promise<boolean> {
    console.log(`🔄 Updating venue ${venueId} status to ${status}`);
    
    try {
      const mutation = `
        mutation UpdateVenueStatus($venueId: ID!, $status: String!) {
          updateVenueStatus(venueId: $venueId, status: $status) {
            success
            message
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: { venueId, status }
      }) as any;

      return result.data?.updateVenueStatus?.success || false;
    } catch (error) {
      console.error('❌ Update venue status failed:', error);
      return false;
    }
  }

  // ============ USER OPERATIONS ============

  /**
   * List all users from Cognito User Pool
   * NOTE: Requires listAllUsers Lambda to be deployed
   */
  async listUsers(): Promise<AdminUser[]> {
    console.log('👥 Fetching all users...');
    
    try {
      const query = `
        query ListAllUsers($limit: Int, $nextToken: String) {
          listAllUsers(limit: $limit, nextToken: $nextToken) {
            items {
              userId
              email
              name
              venueId
              venueName
              role
              status
              createdAt
              lastLoginAt
              emailVerified
            }
            nextToken
          }
        }
      `;

      const result = await this.client.graphql({
        query,
        variables: { limit: 100 }
      }) as any;

      if (result.data?.listAllUsers?.items) {
        console.log('✅ Fetched users from GraphQL:', result.data.listAllUsers.items.length);
        return result.data.listAllUsers.items;
      }
    } catch (error: any) {
      console.warn('⚠️ listAllUsers query not available');
    }

    console.log('ℹ️ User listing requires listAllUsers Lambda/resolver to be deployed');
    return [];
  }

  /**
   * Create a new user in Cognito
   * NOTE: Requires createUser mutation/Lambda
   */
  async createUser(input: CreateUserInput): Promise<{ success: boolean; message: string; tempPassword?: string }> {
    console.log('👤 Creating user:', input.email);
    
    const randomStr = Math.random().toString(36).slice(2, 10);
    const randomNum = Math.floor(Math.random() * 900) + 100;
    const tempPassword = input.tempPassword || `Temp${randomNum}${randomStr}!`;
    
    try {
      const mutation = `
        mutation CreateUser(
          $email: String!
          $name: String!
          $venueId: String!
          $venueName: String!
          $role: String!
          $tempPassword: String!
        ) {
          createUser(
            email: $email
            name: $name
            venueId: $venueId
            venueName: $venueName
            role: $role
            tempPassword: $tempPassword
          ) {
            success
            message
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: { ...input, tempPassword }
      }) as any;

      if (result.data?.createUser?.success) {
        return { success: true, message: 'User created', tempPassword };
      }

      return { success: false, message: result.data?.createUser?.message || 'Failed to create user' };
    } catch (error: any) {
      console.error('❌ Create user failed:', error);
      return { success: false, message: error.message || 'Failed to create user' };
    }
  }

  /**
   * Reset a user's password
   * NOTE: Requires resetUserPassword mutation/Lambda
   */
  async resetUserPassword(email: string): Promise<{ success: boolean; tempPassword?: string; message: string }> {
    console.log('🔑 Resetting password for:', email);
    
    const randomStr = Math.random().toString(36).slice(2, 10);
    const randomNum = Math.floor(Math.random() * 900) + 100;
    const tempPassword = `Reset${randomNum}${randomStr}!`;
    
    try {
      const mutation = `
        mutation ResetUserPassword($email: String!, $tempPassword: String!) {
          resetUserPassword(email: $email, tempPassword: $tempPassword) {
            success
            message
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: { email, tempPassword }
      }) as any;

      if (result.data?.resetUserPassword?.success) {
        return { success: true, tempPassword, message: 'Password reset' };
      }

      return { success: false, message: result.data?.resetUserPassword?.message || 'Failed to reset password' };
    } catch (error: any) {
      console.error('❌ Reset password failed:', error);
      return { success: false, message: error.message || 'Failed to reset password' };
    }
  }

  /**
   * Disable/enable a user account
   */
  async setUserEnabled(email: string, enabled: boolean): Promise<boolean> {
    console.log(`${enabled ? '✅' : '🚫'} Setting user ${email} enabled=${enabled}`);
    
    try {
      const mutation = `
        mutation SetUserEnabled($email: String!, $enabled: Boolean!) {
          setUserEnabled(email: $email, enabled: $enabled) {
            success
            message
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: { email, enabled }
      }) as any;

      return result.data?.setUserEnabled?.success || false;
    } catch (error) {
      console.error('❌ Set user enabled failed:', error);
      return false;
    }
  }

  // ============ DEVICE OPERATIONS ============

  /**
   * List all devices across all venues
   * NOTE: Requires listAllDevices Lambda
   */
  async listDevices(): Promise<AdminDevice[]> {
    console.log('📡 Fetching all devices...');
    
    try {
      const query = `
        query ListAllDevices($limit: Int) {
          listAllDevices(limit: $limit) {
            items {
              deviceId
              venueId
              venueName
              locationName
              status
              lastHeartbeat
              firmware
              createdAt
              cpuTemp
              diskUsage
              uptime
            }
          }
        }
      `;

      const result = await this.client.graphql({
        query,
        variables: { limit: 200 }
      }) as any;

      if (result.data?.listAllDevices?.items) {
        console.log('✅ Fetched devices from GraphQL:', result.data.listAllDevices.items.length);
        return result.data.listAllDevices.items;
      }
    } catch (error: any) {
      console.warn('⚠️ listAllDevices query not available');
    }

    console.log('ℹ️ Device listing requires listAllDevices Lambda/resolver to be deployed');
    return [];
  }

  // ============ STATISTICS ============

  /**
   * Get aggregated admin statistics
   * NOTE: Requires getAdminStats query/Lambda
   */
  async getStats(): Promise<AdminStats> {
    console.log('📊 Fetching admin stats...');
    
    try {
      const query = `
        query GetAdminStats {
          getAdminStats {
            totalVenues
            activeVenues
            totalUsers
            activeUsers
            totalDevices
            onlineDevices
            offlineDevices
          }
        }
      `;

      const result = await this.client.graphql({ query }) as any;

      if (result.data?.getAdminStats) {
        console.log('✅ Fetched admin stats');
        return result.data.getAdminStats;
      }
    } catch (error: any) {
      console.warn('⚠️ getAdminStats query not available');
    }

    // Return zeros if query doesn't exist
    return {
      totalVenues: 0,
      activeVenues: 0,
      totalUsers: 0,
      activeUsers: 0,
      totalDevices: 0,
      onlineDevices: 0,
      offlineDevices: 0
    };
  }

  // ============ ACTIVITY LOG ============

  /**
   * Get recent admin activity
   */
  async getRecentActivity(limit: number = 20): Promise<Array<{
    id: string;
    action: string;
    actor: string;
    target: string;
    timestamp: string;
    details?: string;
  }>> {
    console.log('📜 Fetching recent activity...');
    
    try {
      const query = `
        query GetAdminActivity($limit: Int) {
          getAdminActivity(limit: $limit) {
            items {
              id
              action
              actor
              target
              timestamp
              details
            }
          }
        }
      `;

      const result = await this.client.graphql({
        query,
        variables: { limit }
      }) as any;

      if (result.data?.getAdminActivity?.items) {
        return result.data.getAdminActivity.items;
      }
    } catch (error: any) {
      console.warn('⚠️ getAdminActivity query not available');
    }

    return [];
  }

  // ============ TEAM MANAGEMENT ============

  /**
   * List internal admin team members
   */
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
    console.log('👥 Fetching team members...');
    
    try {
      const query = `
        query ListAdminTeam($limit: Int) {
          listAdminTeam(limit: $limit) {
            items {
              id
              email
              name
              role
              status
              permissions
              assignedVenues
              createdAt
              lastActivity
            }
          }
        }
      `;

      const result = await this.client.graphql({
        query,
        variables: { limit: 50 }
      }) as any;

      if (result.data?.listAdminTeam?.items) {
        return result.data.listAdminTeam.items;
      }
    } catch (error: any) {
      console.warn('⚠️ listAdminTeam query not available');
    }

    return [];
  }

  /**
   * Create a new team member
   */
  async createTeamMember(input: {
    email: string;
    name: string;
    role: 'admin' | 'sales' | 'support' | 'installer';
    permissions: string[];
  }): Promise<{ success: boolean; message: string }> {
    console.log('👤 Creating team member:', input.email);
    
    try {
      const mutation = `
        mutation CreateAdminTeamMember(
          $email: String!
          $name: String!
          $role: String!
          $permissions: [String!]!
        ) {
          createAdminTeamMember(
            email: $email
            name: $name
            role: $role
            permissions: $permissions
          ) {
            success
            message
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: input
      }) as any;

      if (result.data?.createAdminTeamMember?.success) {
        return { success: true, message: 'Team member created' };
      }

      return { success: false, message: result.data?.createAdminTeamMember?.message || 'Failed to create team member' };
    } catch (error: any) {
      console.error('❌ Create team member failed:', error);
      return { success: false, message: error.message || 'Failed to create team member' };
    }
  }

  /**
   * Update team member permissions
   */
  async updateTeamMemberPermissions(email: string, permissions: string[]): Promise<boolean> {
    console.log('🔐 Updating permissions for:', email);
    
    try {
      const mutation = `
        mutation UpdateAdminPermissions($email: String!, $permissions: [String!]!) {
          updateAdminPermissions(email: $email, permissions: $permissions) {
            success
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: { email, permissions }
      }) as any;

      return result.data?.updateAdminPermissions?.success || false;
    } catch (error) {
      console.error('❌ Update permissions failed:', error);
      return false;
    }
  }

  /**
   * Deactivate a team member
   */
  async deactivateTeamMember(email: string): Promise<boolean> {
    console.log('🚫 Deactivating team member:', email);
    
    try {
      const mutation = `
        mutation DeactivateAdminTeamMember($email: String!) {
          deactivateAdminTeamMember(email: $email) {
            success
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: { email }
      }) as any;

      return result.data?.deactivateAdminTeamMember?.success || false;
    } catch (error) {
      console.error('❌ Deactivate team member failed:', error);
      return false;
    }
  }

  // ============ AUDIT LOG ============

  /**
   * Get audit log entries with filters
   */
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
    console.log('📜 Fetching audit log...');
    
    try {
      const query = `
        query GetAuditLog($limit: Int, $filterType: String, $dateRange: String) {
          getAuditLog(limit: $limit, filterType: $filterType, dateRange: $dateRange) {
            items {
              id
              timestamp
              action
              actionType
              targetType
              targetName
              performedBy
              performedByRole
              details
              ipAddress
            }
          }
        }
      `;

      const result = await this.client.graphql({
        query,
        variables: {
          limit: options.limit || 50,
          filterType: options.filterType || 'all',
          dateRange: options.dateRange || '7d'
        }
      }) as any;

      if (result.data?.getAuditLog?.items) {
        return result.data.getAuditLog.items;
      }
    } catch (error: any) {
      console.warn('⚠️ getAuditLog query not available');
    }

    return [];
  }

  // ============ SYSTEM ANALYTICS ============

  /**
   * Get system analytics data
   */
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
    console.log('📊 Fetching system analytics...');
    
    try {
      const query = `
        query GetSystemAnalytics {
          getSystemAnalytics {
            venueGrowth { month count }
            userGrowth { month count }
            deviceStatus { online offline error }
            dataVolume { venueId venueName dataPoints }
            issuesByType { type count trend }
            mrr
            projectedAnnual
            avgRevenuePerVenue
          }
        }
      `;

      const result = await this.client.graphql({ query }) as any;

      if (result.data?.getSystemAnalytics) {
        return result.data.getSystemAnalytics;
      }
    } catch (error: any) {
      console.warn('⚠️ getSystemAnalytics query not available');
    }

    // Return placeholder data
    return {
      venueGrowth: [],
      userGrowth: [],
      deviceStatus: { online: 0, offline: 0, error: 0 },
      dataVolume: [],
      issuesByType: [],
      mrr: 0,
      projectedAnnual: 0,
      avgRevenuePerVenue: 0
    };
  }

  // ============ ADMIN SETTINGS ============

  /**
   * Get admin settings
   */
  async getAdminSettings(): Promise<{
    alertThresholds: {
      offlineMinutes: number;
      dataGapHours: number;
      tempAnomalyDegrees: number;
    };
    notifications: {
      emailOnCritical: boolean;
      emailOnNewVenue: boolean;
      slackWebhook?: string;
    };
    defaults: {
      defaultPlan: string;
      defaultTimezone: string;
      autoProvisionDevice: boolean;
    };
  }> {
    console.log('⚙️ Fetching admin settings...');
    
    try {
      const query = `
        query GetAdminSettings {
          getAdminSettings {
            alertThresholds { offlineMinutes dataGapHours tempAnomalyDegrees }
            notifications { emailOnCritical emailOnNewVenue slackWebhook }
            defaults { defaultPlan defaultTimezone autoProvisionDevice }
          }
        }
      `;

      const result = await this.client.graphql({ query }) as any;

      if (result.data?.getAdminSettings) {
        return result.data.getAdminSettings;
      }
    } catch (error: any) {
      console.warn('⚠️ getAdminSettings query not available');
    }

    // Return defaults
    return {
      alertThresholds: {
        offlineMinutes: 30,
        dataGapHours: 4,
        tempAnomalyDegrees: 20
      },
      notifications: {
        emailOnCritical: true,
        emailOnNewVenue: true
      },
      defaults: {
        defaultPlan: 'Standard',
        defaultTimezone: 'America/New_York',
        autoProvisionDevice: true
      }
    };
  }

  /**
   * Save admin settings
   */
  async saveAdminSettings(settings: {
    alertThresholds?: {
      offlineMinutes?: number;
      dataGapHours?: number;
      tempAnomalyDegrees?: number;
    };
    notifications?: {
      emailOnCritical?: boolean;
      emailOnNewVenue?: boolean;
      slackWebhook?: string;
    };
    defaults?: {
      defaultPlan?: string;
      defaultTimezone?: string;
      autoProvisionDevice?: boolean;
    };
  }): Promise<boolean> {
    console.log('💾 Saving admin settings...');
    
    try {
      const mutation = `
        mutation SaveAdminSettings($input: AdminSettingsInput!) {
          saveAdminSettings(input: $input) {
            success
          }
        }
      `;

      const result = await this.client.graphql({
        query: mutation,
        variables: { input: settings }
      }) as any;

      return result.data?.saveAdminSettings?.success || false;
    } catch (error) {
      console.error('❌ Save admin settings failed:', error);
      return false;
    }
  }
}

export const adminService = new AdminService();
export default adminService;
