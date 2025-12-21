import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Target, 
  TrendingUp, 
  Clock, 
  Music, 
  Zap, 
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  ArrowUp,
  BarChart3
} from 'lucide-react';
import pulseRecommendationsService, { 
  PulseRecommendationsData, 
  OptimalCondition 
} from '../services/pulse-recommendations.service';

export function PulseRecommendations() {
  const [data, setData] = useState<PulseRecommendationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await pulseRecommendationsService.getRecommendations();
      setData(result);
    } catch (err) {
      setError('Failed to load recommendations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    pulseRecommendationsService.clearCache();
    loadRecommendations();
  };

  const getPriorityBadge = (priority: OptimalCondition['priority']) => {
    switch (priority) {
      case 'high':
        return <span className="px-2 py-0.5 text-xs font-semibold bg-red-500/20 text-red-400 rounded-full">HIGH PRIORITY</span>;
      case 'medium':
        return <span className="px-2 py-0.5 text-xs font-semibold bg-yellow-500/20 text-yellow-400 rounded-full">MEDIUM</span>;
      case 'low':
        return <span className="px-2 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-400 rounded-full">LOW</span>;
      case 'optimal':
        return <span className="px-2 py-0.5 text-xs font-semibold bg-green-500/20 text-green-400 rounded-full">✓ OPTIMAL</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-cyan animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Analyzing your venue data...</p>
          <p className="text-sm text-gray-500 mt-2">Finding patterns that maximize dwell time</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
          <p className="text-gray-400">{error || 'Unable to load recommendations'}</p>
          <button onClick={handleRefresh} className="btn-primary mt-4">Try Again</button>
        </div>
      </div>
    );
  }

  const insufficientData = data.dataQuality.confidence === 'low' && data.recommendations.length === 0;

  return (
    <div className="max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold gradient-text flex items-center gap-3">
              <Target className="w-8 h-8" />
              Pulse Recommendations
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              AI-powered insights to maximize guest dwell time
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-gray-500">Data Quality</div>
              <div className={`text-sm font-semibold ${
                data.dataQuality.confidence === 'high' ? 'text-green-400' :
                data.dataQuality.confidence === 'medium' ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {data.dataQuality.daysOfData} days • {data.dataQuality.totalReadings.toLocaleString()} readings
              </div>
            </div>
            <motion.button
              onClick={handleRefresh}
              className="btn-secondary flex items-center gap-2"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </motion.button>
          </div>
        </div>

        {insufficientData ? (
          <motion.div 
            className="glass-card p-12 text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <BarChart3 className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Gathering Data...</h3>
            <p className="text-gray-400 max-w-md mx-auto">
              We need at least 7 days of sensor data to generate personalized recommendations. 
              Keep your sensors running and check back soon!
            </p>
            <div className="mt-6 flex justify-center gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-cyan">{data.dataQuality.totalReadings}</div>
                <div className="text-xs text-gray-500">Readings</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-cyan">{data.dataQuality.daysOfData}</div>
                <div className="text-xs text-gray-500">Days</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-500">7</div>
                <div className="text-xs text-gray-500">Days Needed</div>
              </div>
            </div>
          </motion.div>
        ) : (
          <>
            {/* Current vs Best Dwell Time */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <motion.div 
                className="glass-card p-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <Clock className="w-5 h-5 text-cyan" />
                  <span className="text-sm text-gray-400">Current Dwell Time</span>
                </div>
                <div className="text-3xl font-bold text-white">
                  {data.currentDwellTime ? `${data.currentDwellTime}m` : '--'}
                </div>
                <div className="text-xs text-gray-500 mt-1">Based on last 2 hours</div>
              </motion.div>

              <motion.div 
                className="glass-card p-6 border border-green-500/30 bg-green-500/5"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-gray-400">Your Best Dwell Time</span>
                </div>
                <div className="text-3xl font-bold text-green-400">
                  {data.bestDwellTime}m
                </div>
                <div className="text-xs text-gray-500 mt-1">Historical peak performance</div>
              </motion.div>

              <motion.div 
                className="glass-card p-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <span className="text-sm text-gray-400">Potential Improvement</span>
                </div>
                <div className="text-3xl font-bold text-yellow-400">
                  +{data.recommendations
                    .filter(r => !r.isOptimal)
                    .reduce((sum, r) => sum + r.potentialDwellIncrease, 0)}m
                </div>
                <div className="text-xs text-gray-500 mt-1">If all recommendations applied</div>
              </motion.div>
            </div>

            {/* Environment Recommendations */}
            <motion.div 
              className="glass-card p-6 mb-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <div className="flex items-center gap-3 mb-6">
                <Target className="w-6 h-6 text-cyan" />
                <h3 className="text-xl font-semibold text-white">Environment Optimization</h3>
              </div>

              <div className="space-y-4">
                {data.recommendations.map((rec, index) => (
                  <motion.div
                    key={rec.factor}
                    className={`p-4 rounded-xl border ${
                      rec.isOptimal 
                        ? 'bg-green-500/5 border-green-500/20' 
                        : rec.priority === 'high'
                          ? 'bg-red-500/5 border-red-500/20'
                          : 'bg-yellow-500/5 border-yellow-500/20'
                    }`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className="text-3xl">{rec.icon}</div>
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-semibold text-white">{rec.factor}</span>
                            {getPriorityBadge(rec.priority)}
                          </div>
                          <p className="text-gray-300">{rec.recommendation}</p>
                          <div className="flex items-center gap-4 mt-2 text-sm">
                            <span className="text-gray-400">
                              Current: <span className="text-white font-medium">{rec.currentValue}</span>
                            </span>
                            <span className="text-gray-400">
                              Optimal: <span className="text-green-400 font-medium">{rec.optimalValue}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      {!rec.isOptimal && rec.potentialDwellIncrease > 0 && (
                        <div className="text-right">
                          <div className="flex items-center gap-1 text-green-400">
                            <ArrowUp className="w-4 h-4" />
                            <span className="font-bold">+{rec.potentialDwellIncrease}m</span>
                          </div>
                          <div className="text-xs text-gray-500">potential dwell</div>
                        </div>
                      )}
                      
                      {rec.isOptimal && (
                        <CheckCircle className="w-6 h-6 text-green-400" />
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Music & Time Recommendations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Music Recommendations */}
              <motion.div 
                className="glass-card p-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <div className="flex items-center gap-3 mb-6">
                  <Music className="w-6 h-6 text-purple-400" />
                  <h3 className="text-xl font-semibold text-white">Music & Timing Insights</h3>
                </div>

                <div className="space-y-4">
                  {data.musicRecommendations.length > 0 ? data.musicRecommendations.map((rec, index) => (
                    <motion.div
                      key={index}
                      className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + index * 0.1 }}
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{rec.icon}</span>
                        <div className="flex-1">
                          <p className="font-medium text-white">{rec.recommendation}</p>
                          <p className="text-sm text-gray-400 mt-1">{rec.reason}</p>
                        </div>
                        {rec.potentialIncrease > 0 && (
                          <div className="text-right">
                            <div className="text-green-400 font-bold">+{rec.potentialIncrease}m</div>
                            <div className="text-xs text-gray-500">dwell</div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )) : (
                    <div className="text-center py-8 text-gray-400">
                      <Music className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>Play more songs to unlock music insights</p>
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Time Slot Performance */}
              <motion.div 
                className="glass-card p-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
              >
                <div className="flex items-center gap-3 mb-6">
                  <Clock className="w-6 h-6 text-cyan" />
                  <h3 className="text-xl font-semibold text-white">Peak Performance Times</h3>
                </div>

                <div className="space-y-3">
                  {data.timeSlotInsights.slice(0, 5).map((slot, index) => (
                    <motion.div
                      key={slot.timeSlot}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.65 + index * 0.05 }}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                          index === 1 ? 'bg-gray-400/20 text-gray-300' :
                          index === 2 ? 'bg-orange-500/20 text-orange-400' :
                          'bg-white/10 text-gray-400'
                        }`}>
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-medium text-white">{slot.timeSlot}</div>
                          <div className="text-xs text-gray-400">
                            {slot.conditions.avgTemp}°F • {slot.conditions.avgSound}dB
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-cyan font-bold">{slot.avgOccupancy}</div>
                        <div className="text-xs text-gray-500">avg people</div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {data.timeSlotInsights.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>More data needed for time analysis</p>
                  </div>
                )}
              </motion.div>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
