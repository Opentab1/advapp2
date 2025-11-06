import { motion } from 'framer-motion';
import { 
  Music, 
  TrendingUp, 
  ThermometerSun, 
  DollarSign, 
  Sparkles, 
  Bell,
  ArrowRight,
  BarChart3,
  Calendar,
  Zap
} from 'lucide-react';

export function AIInsights() {
  // TODO: Replace with real data from API
  const hasData = false; // Set to true when real data is available

  if (!hasData) {
    return (
      <div className="min-h-screen p-4 md:p-6 lg:p-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-3xl font-bold gradient-text mb-2">🤖 AI-Powered Insights</h1>
          <p className="text-gray-400 mb-8">Intelligent recommendations powered by your venue's data</p>
        </motion.div>

        {/* Empty State */}
        <motion.div
          className="glass-card p-12 text-center"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="inline-block p-6 rounded-full bg-purple-500/10 mb-6">
            <Sparkles className="w-16 h-16 text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-4">AI Insights Awaiting Data</h2>
          <p className="text-gray-400 max-w-2xl mx-auto mb-6">
            Our AI engine requires at least 7 days of sensor data to generate meaningful insights and recommendations. 
            Once your devices are operational and collecting data, you'll see:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto text-left">
            <div className="glass-card p-4">
              <Music className="w-8 h-8 text-cyan-400 mb-2" />
              <h3 className="text-white font-semibold mb-1">Music Performance</h3>
              <p className="text-sm text-gray-400">Top songs, engagement scores, playlist optimization</p>
            </div>
            <div className="glass-card p-4">
              <TrendingUp className="w-8 h-8 text-green-400 mb-2" />
              <h3 className="text-white font-semibold mb-1">Predictive Occupancy</h3>
              <p className="text-sm text-gray-400">Hour-by-hour forecasts, peak warnings, staffing tips</p>
            </div>
            <div className="glass-card p-4">
              <ThermometerSun className="w-8 h-8 text-orange-400 mb-2" />
              <h3 className="text-white font-semibold mb-1">Atmosphere Optimization</h3>
              <p className="text-sm text-gray-400">Specific recommendations to improve Pulse Score</p>
            </div>
            <div className="glass-card p-4">
              <DollarSign className="w-8 h-8 text-yellow-400 mb-2" />
              <h3 className="text-white font-semibold mb-1">Revenue Correlation</h3>
              <p className="text-sm text-gray-400">Occupancy vs revenue insights, ROI analysis</p>
            </div>
            <div className="glass-card p-4">
              <Sparkles className="w-8 h-8 text-purple-400 mb-2" />
              <h3 className="text-white font-semibold mb-1">Moment Detection</h3>
              <p className="text-sm text-gray-400">Capture perfect moments and replicate success</p>
            </div>
            <div className="glass-card p-4">
              <Bell className="w-8 h-8 text-red-400 mb-2" />
              <h3 className="text-white font-semibold mb-1">Smart Alerts</h3>
              <p className="text-sm text-gray-400">Proactive notifications and recommendations</p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // Real data view (will be populated later)
  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold gradient-text mb-2">🤖 AI-Powered Insights</h1>
        <p className="text-gray-400 mb-8">Intelligent recommendations powered by your venue's data</p>
      </motion.div>

      {/* Music Performance Analytics */}
      <motion.div
        className="glass-card p-6 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Music className="w-8 h-8 text-cyan-400" />
            <h2 className="text-2xl font-bold text-white">Music Performance Analytics</h2>
          </div>
          <button className="btn-secondary text-sm">
            View Full Analysis <ArrowRight className="w-4 h-4 ml-2 inline" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Performing Songs */}
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Top Performing Songs (This Week)</h3>
            <div className="space-y-3">
              {/* Example song - will be dynamic */}
              <div className="glass-card p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-cyan-500 rounded flex items-center justify-center text-white font-bold">
                    1
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-white">Song Title</div>
                    <div className="text-sm text-gray-400">Artist Name</div>
                  </div>
                  <div className="text-right">
                    <div className="text-cyan-400 font-bold">89%</div>
                    <div className="text-xs text-gray-400">engagement</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Recommendation */}
          <div className="glass-card p-6 bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-purple-500/30">
            <div className="flex items-start gap-3 mb-4">
              <Zap className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">AI Recommendation</h3>
                <p className="text-gray-300 text-sm">
                  Your top-performing songs share similar characteristics. Add 5 more tracks 
                  in the same genre to your evening playlist for an estimated +12% increase 
                  in customer dwell time.
                </p>
              </div>
            </div>
            <button className="btn-primary text-sm w-full">
              Generate Optimized Playlist
            </button>
          </div>
        </div>
      </motion.div>

      {/* Predictive Occupancy */}
      <motion.div
        className="glass-card p-6 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-green-400" />
            <h2 className="text-2xl font-bold text-white">Predictive Occupancy Intelligence</h2>
          </div>
          <button className="btn-secondary text-sm">
            View 7-Day Forecast <ArrowRight className="w-4 h-4 ml-2 inline" />
          </button>
        </div>

        <div className="glass-card p-6 bg-blue-500/5 border border-blue-500/20">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-blue-400" />
            <span className="text-white font-semibold">Tomorrow's Forecast</span>
          </div>
          <div className="h-64 flex items-center justify-center text-gray-500 border-2 border-dashed border-gray-700 rounded">
            [Prediction Chart Placeholder - Will show hour-by-hour forecast]
          </div>
          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded">
            <div className="flex items-start gap-3">
              <Bell className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-1" />
              <div>
                <div className="text-yellow-400 font-semibold mb-1">Peak Alert: 6-7 PM</div>
                <div className="text-sm text-gray-300">
                  Expecting 185 people (high volume). Preparation suggestions available.
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Atmosphere Optimization */}
      <motion.div
        className="glass-card p-6 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex items-center gap-3 mb-6">
          <ThermometerSun className="w-8 h-8 text-orange-400" />
          <h2 className="text-2xl font-bold text-white">Atmosphere Optimization</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="glass-card p-4 border-green-500/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400">Sound Level</span>
              <span className="text-green-400 font-bold">✓ Perfect</span>
            </div>
            <p className="text-sm text-gray-300">Keep current levels during peak hours</p>
          </div>

          <div className="glass-card p-4 border-yellow-500/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400">Lighting</span>
              <span className="text-yellow-400 font-bold">⚠ Increase +50 lux</span>
            </div>
            <p className="text-sm text-gray-300">Estimated +8 points to Pulse Score</p>
          </div>

          <div className="glass-card p-4 border-green-500/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400">Temperature</span>
              <span className="text-green-400 font-bold">✓ Perfect</span>
            </div>
            <p className="text-sm text-gray-300">Maintain this temperature range</p>
          </div>

          <div className="glass-card p-4 border-yellow-500/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400">Humidity</span>
              <span className="text-yellow-400 font-bold">⚠ Decrease -3%</span>
            </div>
            <p className="text-sm text-gray-300">Consider HVAC adjustment</p>
          </div>
        </div>

        <div className="mt-6 p-4 bg-purple-500/10 border border-purple-500/30 rounded">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-semibold">Estimated Impact</span>
            <BarChart3 className="w-5 h-5 text-purple-400" />
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-purple-400">+8</div>
              <div className="text-xs text-gray-400">Pulse Score Points</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-400">+$230</div>
              <div className="text-xs text-gray-400">Daily Revenue</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-cyan-400">+10min</div>
              <div className="text-xs text-gray-400">Dwell Time</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* More sections will be added here */}
    </div>
  );
}
