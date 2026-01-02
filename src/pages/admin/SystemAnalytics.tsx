import { motion } from 'framer-motion';
import { 
  BarChart3,
  TrendingUp,
  DollarSign,
  Users,
  Building2,
  Wifi,
  AlertTriangle,
  Activity
} from 'lucide-react';

export function SystemAnalytics() {
  // TODO: Replace with real data from API
  const stats = {
    totalVenues: 47,
    totalUsers: 89,
    totalDevices: 142,
    openIssues: 3,
    venuesThisMonth: 12,
    usersThisMonth: 23,
    devicesThisMonth: 15,
    issuesResolvedThisWeek: 8,
    avgRevenuePerVenue: 100,
    projectedAnnual: 56400,
    systemUptime: 99.8,
    avgDataPointsPerVenue: 17280
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold gradient-text mb-2">📊 System Analytics</h1>
        <p className="text-gray-400 mb-8">Business metrics and system performance</p>
      </motion.div>

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center justify-between mb-4">
            <Building2 className="w-8 h-8 text-purple-400" />
            <TrendingUp className="w-5 h-5 text-green-400" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">{stats.totalVenues}</div>
          <div className="text-sm text-gray-400 mb-2">Total Venues</div>
          <div className="text-xs text-green-400">+{stats.venuesThisMonth} this month</div>
        </motion.div>

        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-4">
            <Users className="w-8 h-8 text-cyan-400" />
            <TrendingUp className="w-5 h-5 text-green-400" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">{stats.totalUsers}</div>
          <div className="text-sm text-gray-400 mb-2">Total Users</div>
          <div className="text-xs text-cyan-400">+{stats.usersThisMonth} this month</div>
        </motion.div>

        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-4">
            <Wifi className="w-8 h-8 text-green-400" />
            <TrendingUp className="w-5 h-5 text-green-400" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">{stats.totalDevices}</div>
          <div className="text-sm text-gray-400 mb-2">Total Devices</div>
          <div className="text-xs text-green-400">+{stats.devicesThisMonth} this month</div>
        </motion.div>

        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between mb-4">
            <Activity className="w-8 h-8 text-yellow-400" />
            <span className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400">
              {stats.systemUptime}%
            </span>
          </div>
          <div className="text-3xl font-bold text-white mb-1">{stats.systemUptime}%</div>
          <div className="text-sm text-gray-400 mb-2">System Uptime</div>
          <div className="text-xs text-gray-500">Last 30 days</div>
        </motion.div>
      </div>

      {/* Venue Growth Chart */}
      <motion.div
        className="glass-card p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-green-400" />
          Venue Growth (Last 6 Months)
        </h2>
        <div className="h-64 flex items-center justify-center border-2 border-dashed border-gray-700 rounded">
          <div className="text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-600" />
            <p className="text-gray-500">Chart showing venue signups over time</p>
            <p className="text-xs text-gray-600 mt-1">Will be populated with Chart.js</p>
          </div>
        </div>
      </motion.div>

      {/* Revenue Projection */}
      <motion.div
        className="glass-card p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-yellow-400" />
          Revenue Projection (Estimated)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-sm text-gray-400 mb-2">Monthly Recurring Revenue</div>
            <div className="text-4xl font-bold text-green-400">
              ${(stats.totalVenues * stats.avgRevenuePerVenue).toLocaleString()}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {stats.totalVenues} venues × ${stats.avgRevenuePerVenue}/mo avg
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-2">Projected Annual</div>
            <div className="text-4xl font-bold text-cyan-400">
              ${stats.projectedAnnual.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Based on current growth rate
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-2">Avg Revenue Per Venue</div>
            <div className="text-4xl font-bold text-purple-400">
              ${stats.avgRevenuePerVenue}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Per month per venue
            </div>
          </div>
        </div>
      </motion.div>

      {/* Top Issues */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-yellow-400" />
          Top Issues This Week
        </h2>
        <div className="space-y-4">
          {[
            { issue: 'Sensor offline', count: 3, trend: 'stable' },
            { issue: 'High temperature alerts', count: 7, trend: 'up' },
            { issue: 'Low occupancy anomalies', count: 2, trend: 'down' },
            { issue: 'Network connectivity', count: 1, trend: 'down' }
          ].map((item, index) => (
            <div key={index} className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
              <div>
                <div className="text-white font-medium">{item.issue}</div>
                <div className="text-xs text-gray-400">{item.count} occurrences</div>
              </div>
              <div className={`text-sm font-semibold ${
                item.trend === 'up' ? 'text-red-400' : 
                item.trend === 'down' ? 'text-green-400' : 
                'text-gray-400'
              }`}>
                {item.trend === 'up' ? '↑' : item.trend === 'down' ? '↓' : '→'}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
