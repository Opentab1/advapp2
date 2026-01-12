/**
 * AdminDashboard - Main admin portal dashboard
 * 
 * Shows:
 * - System statistics (venues, users, devices)
 * - Recent alerts
 * - Activity timeline
 * - Quick actions
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Building2, 
  Users, 
  Wifi, 
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Settings,
  WifiOff
} from 'lucide-react';
import { useAdminData } from '../../hooks/useAdminData';
import adminService from '../../services/admin.service';

export function AdminDashboard() {
  const { stats, venues, users, devices, loading, refresh } = useAdminData();
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  // Fetch recent activity
  useEffect(() => {
    async function fetchActivity() {
      setActivityLoading(true);
      try {
        const activity = await adminService.getRecentActivity(10);
        setRecentActivity(activity);
      } catch (e) {
        console.warn('Could not fetch activity');
      } finally {
        setActivityLoading(false);
      }
    }
    fetchActivity();
  }, []);

  // Calculate additional stats from loaded data
  const offlineDevices = devices.filter(d => d.status === 'offline');
  const recentVenues = venues.slice(0, 5);
  const hasData = venues.length > 0 || users.length > 0 || devices.length > 0;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">🛡️ Admin Portal</h1>
            <p className="text-gray-400">System overview and management</p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Setup Notice - Show if no data */}
        {!loading && !hasData && (
          <motion.div
            className="glass-card p-6 mb-8 border-yellow-500/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-full bg-yellow-500/20">
                <Settings className="w-6 h-6 text-yellow-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-white mb-2">Backend Setup Required</h3>
                <p className="text-gray-400 mb-4">
                  To display real data, the following GraphQL queries need to be added to AppSync:
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-gray-300">
                    <code className="px-2 py-1 bg-gray-800 rounded text-cyan-400">listAllVenues</code>
                    <span className="text-gray-500">— Scan VenueConfig table</span>
                  </li>
                  <li className="flex items-center gap-2 text-gray-300">
                    <code className="px-2 py-1 bg-gray-800 rounded text-cyan-400">listAllUsers</code>
                    <span className="text-gray-500">— List Cognito users via Lambda</span>
                  </li>
                  <li className="flex items-center gap-2 text-gray-300">
                    <code className="px-2 py-1 bg-gray-800 rounded text-cyan-400">listAllDevices</code>
                    <span className="text-gray-500">— List IoT things via Lambda</span>
                  </li>
                  <li className="flex items-center gap-2 text-gray-300">
                    <code className="px-2 py-1 bg-gray-800 rounded text-cyan-400">getAdminStats</code>
                    <span className="text-gray-500">— Aggregate counts</span>
                  </li>
                </ul>
                <p className="text-gray-500 text-sm mt-4">
                  See <code className="text-cyan-400">ADMIN_SETUP.md</code> for Lambda code and AppSync resolver configuration.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 rounded-full bg-purple-500/20">
              <Building2 className="w-6 h-6 text-purple-400" />
            </div>
            {stats.totalVenues > 0 && (
              <TrendingUp className="w-5 h-5 text-green-400" />
            )}
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {loading ? '—' : stats.totalVenues}
          </div>
          <div className="text-sm text-gray-400">Total Venues</div>
          {stats.activeVenues > 0 && (
            <div className="text-xs text-green-400 mt-2">
              {stats.activeVenues} active
            </div>
          )}
        </motion.div>

        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 rounded-full bg-cyan-500/20">
              <Users className="w-6 h-6 text-cyan-400" />
            </div>
            {stats.totalUsers > 0 && (
              <TrendingUp className="w-5 h-5 text-green-400" />
            )}
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {loading ? '—' : stats.totalUsers}
          </div>
          <div className="text-sm text-gray-400">Total Users</div>
          {stats.activeUsers > 0 && (
            <div className="text-xs text-cyan-400 mt-2">
              {stats.activeUsers} active
            </div>
          )}
        </motion.div>

        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 rounded-full bg-green-500/20">
              <Wifi className="w-6 h-6 text-green-400" />
            </div>
            {stats.onlineDevices > 0 && (
              <CheckCircle className="w-5 h-5 text-green-400" />
            )}
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {loading ? '—' : stats.totalDevices}
          </div>
          <div className="text-sm text-gray-400">Total Devices</div>
          <div className="text-xs mt-2 flex items-center gap-2">
            <span className="text-green-400">{stats.onlineDevices} online</span>
            {stats.offlineDevices > 0 && (
              <span className="text-red-400">{stats.offlineDevices} offline</span>
            )}
          </div>
        </motion.div>

        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 rounded-full bg-red-500/20">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            {offlineDevices.length === 0 ? (
              <CheckCircle className="w-5 h-5 text-green-400" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400" />
            )}
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {loading ? '—' : offlineDevices.length}
          </div>
          <div className="text-sm text-gray-400">Active Issues</div>
          <div className="text-xs text-yellow-400 mt-2">
            {offlineDevices.length === 0 ? 'All systems operational' : 'Devices need attention'}
          </div>
        </motion.div>
      </div>

      {/* Alerts & Activity Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Offline Devices / Alerts */}
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            Active Alerts
          </h2>
          
          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : offlineDevices.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
              <p className="text-green-400 font-medium">All Systems Operational</p>
              <p className="text-sm text-gray-500 mt-1">No issues detected</p>
            </div>
          ) : (
            <div className="space-y-3">
              {offlineDevices.map((device) => (
                <div 
                  key={device.deviceId}
                  className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30"
                >
                  <WifiOff className="w-5 h-5 text-red-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-white font-medium">{device.deviceId}</p>
                    <p className="text-sm text-gray-400">
                      {device.venueName} — {device.locationName}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Last seen: {device.lastHeartbeat}
                    </p>
                  </div>
                  <button className="btn-secondary text-xs">
                    Troubleshoot
                  </button>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Recent Venues */}
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-purple-400" />
            Recent Venues
          </h2>
          
          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : recentVenues.length === 0 ? (
            <div className="text-center py-8">
              <Building2 className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400">No venues found</p>
              <p className="text-sm text-gray-500 mt-1">Create your first venue to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentVenues.map((venue) => (
                <div 
                  key={venue.venueId}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div>
                    <p className="text-white font-medium">{venue.venueName}</p>
                    <p className="text-sm text-gray-400">
                      {venue.venueId} • {venue.deviceCount || 0} devices
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    venue.status === 'active' 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {venue.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Activity Timeline */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
      >
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyan-400" />
          Recent Activity
        </h2>
        
        {activityLoading ? (
          <div className="text-center py-8 text-gray-400">Loading activity...</div>
        ) : recentActivity.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="w-12 h-12 mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">No recent activity</p>
            <p className="text-sm text-gray-500 mt-1">
              Activity logging requires getAdminActivity resolver
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {recentActivity.map((activity, index) => (
              <div key={activity.id || index} className="flex items-start gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full ${
                    activity.action.includes('create') ? 'bg-green-400' :
                    activity.action.includes('delete') ? 'bg-red-400' :
                    'bg-cyan-400'
                  }`} />
                  {index < recentActivity.length - 1 && (
                    <div className="w-0.5 h-full bg-gray-700 mt-2" />
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <p className="text-white">{activity.action}</p>
                  <p className="text-sm text-gray-400">
                    {activity.actor} • {activity.target}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{activity.timestamp}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
