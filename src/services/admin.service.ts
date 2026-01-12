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
}

export const adminService = new AdminService();
export default adminService;
