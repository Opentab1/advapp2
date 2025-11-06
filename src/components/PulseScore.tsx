import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PulseScoreProps {
  score: number | null; // 0-100, null if no data
  breakdown?: {
    sound: number;
    light: number;
    temperature: number;
    humidity: number;
  };
  trend?: 'up' | 'down' | 'stable';
  message?: string;
}

export const PulseScore: React.FC<PulseScoreProps> = ({ 
  score, 
  breakdown,
  trend = 'stable',
  message 
}) => {
  // Determine color based on score
  const getScoreColor = (score: number) => {
    if (score >= 85) return 'from-green-500 to-emerald-600';
    if (score >= 70) return 'from-yellow-500 to-orange-500';
    return 'from-red-500 to-rose-600';
  };

  const getScoreMessage = (score: number) => {
    if (score >= 90) return 'Exceptional atmosphere! Your venue is perfectly optimized.';
    if (score >= 85) return 'Your atmosphere is optimized for peak customer engagement.';
    if (score >= 70) return 'Good atmosphere with room for improvement.';
    if (score >= 50) return 'Several factors need attention to optimize atmosphere.';
    return 'Multiple issues detected. Review recommendations below.';
  };

  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="w-6 h-6 text-green-400" />;
      case 'down':
        return <TrendingDown className="w-6 h-6 text-red-400" />;
      default:
        return <Minus className="w-6 h-6 text-gray-400" />;
    }
  };

  // No data state
  if (score === null) {
    return (
      <motion.div
        className="glass-card p-8 mb-6 border border-purple-500/20"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="text-center">
          <div className="inline-block p-4 rounded-full bg-gray-800/50 mb-4">
            <div className="w-16 h-16 rounded-full border-4 border-gray-700 flex items-center justify-center">
              <span className="text-3xl text-gray-600">?</span>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-400 mb-2">Pulse Score Unavailable</h2>
          <p className="text-gray-500 text-sm">
            Waiting for sensor data to calculate your venue's Pulse Score.
            <br />
            Score will appear once your devices start sending data.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="glass-card p-8 mb-6 border border-purple-500/30"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          🎯 PULSE SCORE
          {getTrendIcon()}
        </h2>
        <div className="text-sm text-gray-400">
          Updated: <span className="text-white">Just now</span>
        </div>
      </div>

      {/* Score Display */}
      <div className="flex items-center justify-center mb-6">
        <motion.div
          className={`relative w-48 h-48 rounded-full bg-gradient-to-br ${getScoreColor(score)} p-1`}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="w-full h-full rounded-full bg-gray-900 flex items-center justify-center">
            <div className="text-center">
              <motion.div
                className="text-6xl font-bold text-white"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                {score}
              </motion.div>
              <div className="text-gray-400 text-sm">/ 100</div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
          <motion.div
            className={`h-full bg-gradient-to-r ${getScoreColor(score)}`}
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ delay: 0.6, duration: 1 }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>Poor</span>
          <span>Fair</span>
          <span>Good</span>
          <span>Excellent</span>
        </div>
      </div>

      {/* Message */}
      <motion.p
        className="text-center text-gray-300 mb-6 text-lg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        "{message || getScoreMessage(score)}"
      </motion.p>

      {/* Breakdown */}
      {breakdown && (
        <motion.div
          className="grid grid-cols-2 md:grid-cols-4 gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
        >
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-1">Sound</div>
            <div className={`text-xl font-bold ${breakdown.sound >= 85 ? 'text-green-400' : breakdown.sound >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
              {breakdown.sound >= 85 ? '✓' : breakdown.sound >= 70 ? '⚠' : '✗'} {breakdown.sound}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-1">Light</div>
            <div className={`text-xl font-bold ${breakdown.light >= 85 ? 'text-green-400' : breakdown.light >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
              {breakdown.light >= 85 ? '✓' : breakdown.light >= 70 ? '⚠' : '✗'} {breakdown.light}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-1">Temp</div>
            <div className={`text-xl font-bold ${breakdown.temperature >= 85 ? 'text-green-400' : breakdown.temperature >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
              {breakdown.temperature >= 85 ? '✓' : breakdown.temperature >= 70 ? '⚠' : '✗'} {breakdown.temperature}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-1">Humidity</div>
            <div className={`text-xl font-bold ${breakdown.humidity >= 85 ? 'text-green-400' : breakdown.humidity >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
              {breakdown.humidity >= 85 ? '✓' : breakdown.humidity >= 70 ? '⚠' : '✗'} {breakdown.humidity}%
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};
