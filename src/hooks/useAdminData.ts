/**
 * useAdminData - Hook for admin portal data
 * 
 * Provides:
 * - Stats (venues, users, devices counts)
 * - Loading states
 * - Error handling
 * - Refresh capability
 */

import { useState, useEffect, useCallback } from 'react';
import adminService, { 
  AdminStats, 
  AdminVenue, 
  AdminUser, 
  AdminDevice 
} from '../services/admin.service';

interface UseAdminDataResult {
  stats: AdminStats;
  venues: AdminVenue[];
  users: AdminUser[];
  devices: AdminDevice[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshVenues: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshDevices: () => Promise<void>;
}

export function useAdminData(): UseAdminDataResult {
  const [stats, setStats] = useState<AdminStats>({
    totalVenues: 0,
    activeVenues: 0,
    totalUsers: 0,
    activeUsers: 0,
    totalDevices: 0,
    onlineDevices: 0,
    offlineDevices: 0,
  });
  const [venues, setVenues] = useState<AdminVenue[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const statsData = await adminService.getStats();
      setStats(statsData);
    } catch (err: any) {
      console.warn('Failed to fetch stats:', err);
    }
  }, []);

  const fetchVenues = useCallback(async () => {
    try {
      const venueData = await adminService.listVenues();
      setVenues(venueData);
      
      // Update stats based on venue count
      setStats(prev => ({
        ...prev,
        totalVenues: venueData.length,
        activeVenues: venueData.filter(v => v.status === 'active').length,
      }));
    } catch (err: any) {
      console.warn('Failed to fetch venues:', err);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const userData = await adminService.listUsers();
      setUsers(userData);
      
      // Update stats based on user count
      setStats(prev => ({
        ...prev,
        totalUsers: userData.length,
        activeUsers: userData.filter(u => u.status === 'active').length,
      }));
    } catch (err: any) {
      console.warn('Failed to fetch users:', err);
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const deviceData = await adminService.listDevices();
      setDevices(deviceData);
      
      // Update stats based on device count
      setStats(prev => ({
        ...prev,
        totalDevices: deviceData.length,
        onlineDevices: deviceData.filter(d => d.status === 'online').length,
        offlineDevices: deviceData.filter(d => d.status === 'offline').length,
      }));
    } catch (err: any) {
      console.warn('Failed to fetch devices:', err);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      await Promise.all([
        fetchStats(),
        fetchVenues(),
        fetchUsers(),
        fetchDevices(),
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [fetchStats, fetchVenues, fetchUsers, fetchDevices]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    stats,
    venues,
    users,
    devices,
    loading,
    error,
    refresh,
    refreshVenues: fetchVenues,
    refreshUsers: fetchUsers,
    refreshDevices: fetchDevices,
  };
}

export default useAdminData;
