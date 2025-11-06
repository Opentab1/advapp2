import { motion } from 'framer-motion';
import { 
  Building2, 
  Users, 
  Wifi, 
  AlertTriangle,
  TrendingUp,
  Calendar,
  DollarSign
} from 'lucide-react';

export function AdminDashboard() {
  // TODO: Replace with real data from API
  const stats = {
    totalVenues: 47,
    totalUsers: 89,
    totalDevices: 142,
    openIssues: 3,
    newVenuesThisMonth: 12,
    activeUsers: 89,
    systemUptime: '99.8%',
    openTickets: 3
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold gradient-text mb-2">🛡️ Admin Portal</h1>
        <p className="text-gray-400 mb-8">System overview and management</p>
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
            <TrendingUp className="w-5 h-5 text-green-400" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">{stats.totalVenues}</div>
          <div className="text-sm text-gray-400">Total Venues</div>
          <div className="text-xs text-green-400 mt-2">+{stats.newVenuesThisMonth} this month</div>
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
            <TrendingUp className="w-5 h-5 text-green-400" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">{stats.totalUsers}</div>
          <div className="text-sm text-gray-400">Total Users</div>
          <div className="text-xs text-cyan-400 mt-2">{stats.activeUsers} active</div>
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
            <TrendingUp className="w-5 h-5 text-green-400" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">{stats.totalDevices}</div>
          <div className="text-sm text-gray-400">Total Devices</div>
          <div className="text-xs text-green-400 mt-2">{stats.systemUptime} uptime</div>
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
            <TrendingUp className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">{stats.openIssues}</div>
          <div className="text-sm text-gray-400">Open Issues</div>
          <div className="text-xs text-yellow-400 mt-2">{stats.openTickets} support tickets</div>
        </motion.div>
      </div>

      {/* Quick Stats */}
      <motion.div
        className="glass-card p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6">📊 Quick Stats</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-sm text-gray-400 mb-2">New venues this month</div>
            <div className="text-3xl font-bold text-purple-400">{stats.newVenuesThisMonth}</div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-2">Active users / Total</div>
            <div className="text-3xl font-bold text-cyan-400">{stats.activeUsers} / {stats.totalUsers}</div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-2">System uptime</div>
            <div className="text-3xl font-bold text-green-400">{stats.systemUptime}</div>
          </div>
        </div>
      </motion.div>

      {/* Recent Alerts */}
      <motion.div
        className="glass-card p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6">🚨 Recent Alerts</h2>
        <div className="space-y-4">
          <div className="glass-card p-4 border-yellow-500/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <div className="text-white font-semibold mb-1">Sensor Offline: Ferg's Sports Bar - Patio</div>
                <div className="text-sm text-gray-400 mb-2">2 hours ago</div>
                <div className="flex gap-2">
                  <button className="btn-secondary text-xs">View Details</button>
                  <button className="btn-primary text-xs">Contact Client</button>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card p-4 border-green-500/30">
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <div className="text-white font-semibold mb-1">New Venue Created: Downtown Lounge</div>
                <div className="text-sm text-gray-400 mb-2">5 hours ago by sarah@advizia.com</div>
                <div className="flex gap-2">
                  <button className="btn-secondary text-xs">View Venue</button>
                  <button className="btn-secondary text-xs">Generate RPi Config</button>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card p-4 border-red-500/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <div className="text-white font-semibold mb-1">High Temperature Alert: Uptown Bar</div>
                <div className="text-sm text-gray-400 mb-2">1 day ago · Client notified</div>
                <button className="btn-secondary text-xs">View Response</button>
              </div>
            </div>
          </div>
        </div>
        <button className="btn-secondary w-full mt-4">View All Alerts (47 this month)</button>
      </motion.div>

      {/* Recent Activity Timeline */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6">📈 Recent Activity</h2>
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-purple-400"></div>
              <div className="w-0.5 h-full bg-gray-700 mt-2"></div>
            </div>
            <div className="flex-1 pb-4">
              <div className="text-white font-semibold">Sarah created venue "Downtown Lounge"</div>
              <div className="text-sm text-gray-400">5 hours ago</div>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-cyan-400"></div>
              <div className="w-0.5 h-full bg-gray-700 mt-2"></div>
            </div>
            <div className="flex-1 pb-4">
              <div className="text-white font-semibold">John reset password for user@venue.com</div>
              <div className="text-sm text-gray-400">1 day ago</div>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-green-400"></div>
            </div>
            <div className="flex-1">
              <div className="text-white font-semibold">System generated weekly reports for 47 venues</div>
              <div className="text-sm text-gray-400">2 days ago</div>
            </div>
          </div>
        </div>
        <button className="btn-secondary w-full mt-4">View Full Audit Log</button>
      </motion.div>
    </div>
  );
}
