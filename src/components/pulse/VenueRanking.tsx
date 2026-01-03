/**
 * VenueRanking - Competitive positioning card
 * 
 * Shows how the venue compares to others in their area.
 * Creates urgency and motivation through competition.
 * 
 * Note: Initially uses simulated data, can be connected to real benchmarks later.
 */

import { motion } from 'framer-motion';
import { Trophy, TrendingUp, TrendingDown, Minus, Crown, Users } from 'lucide-react';

interface VenueRankingProps {
  pulseScore: number;
  currentOccupancy: number;
  city?: string;
  onTap?: () => void;
}

export function VenueRanking({
  pulseScore,
  currentOccupancy,
  city = 'Your City',
  onTap,
}: VenueRankingProps) {
  // Calculate ranking based on pulse score (simulated)
  // In production, this would come from real aggregated data
  const calculateRanking = () => {
    // Simulate ranking based on pulse score
    // Higher score = better rank
    if (pulseScore >= 85) return { rank: 1, change: 0, percentile: 99 };
    if (pulseScore >= 80) return { rank: 2, change: 1, percentile: 95 };
    if (pulseScore >= 75) return { rank: 3, change: 2, percentile: 90 };
    if (pulseScore >= 70) return { rank: 5, change: 1, percentile: 85 };
    if (pulseScore >= 65) return { rank: 8, change: -1, percentile: 75 };
    if (pulseScore >= 55) return { rank: 12, change: -2, percentile: 60 };
    if (pulseScore >= 45) return { rank: 18, change: 0, percentile: 45 };
    return { rank: 25, change: -3, percentile: 30 };
  };
  
  const { rank, change, percentile } = calculateRanking();
  
  const getTrendIcon = () => {
    if (change > 0) return <TrendingUp className="w-3 h-3 text-emerald-400" />;
    if (change < 0) return <TrendingDown className="w-3 h-3 text-red-400" />;
    return <Minus className="w-3 h-3 text-warm-500" />;
  };
  
  const getTrendText = () => {
    if (change > 0) return `↑ ${change} spots from last week`;
    if (change < 0) return `↓ ${Math.abs(change)} spots from last week`;
    return 'Holding steady';
  };
  
  const getTrendColor = () => {
    if (change > 0) return 'text-emerald-400';
    if (change < 0) return 'text-red-400';
    return 'text-warm-500';
  };
  
  const getRankBadge = () => {
    if (rank === 1) return { color: 'from-yellow-400 to-amber-500', icon: Crown };
    if (rank <= 3) return { color: 'from-cyan-400 to-blue-500', icon: Trophy };
    if (rank <= 10) return { color: 'from-warm-400 to-warm-500', icon: Trophy };
    return { color: 'from-warm-500 to-warm-600', icon: Trophy };
  };
  
  const badge = getRankBadge();
  
  return (
    <motion.div
      className="glass-card p-4 cursor-pointer"
      onClick={onTap}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between">
        {/* Left: Ranking Info */}
        <div className="flex items-center gap-3">
          {/* Rank Badge */}
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${badge.color} flex items-center justify-center shadow-lg`}>
            {rank === 1 ? (
              <Crown className="w-6 h-6 text-warm-900" />
            ) : (
              <span className="text-xl font-bold text-warm-900">#{rank}</span>
            )}
          </div>
          
          {/* Text */}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">
                {rank === 1 ? '#1' : `#${rank}`} in {city}
              </span>
              {rank <= 3 && (
                <span className="px-1.5 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded font-medium">
                  Top 3
                </span>
              )}
            </div>
            <div className={`text-sm ${getTrendColor()} flex items-center gap-1`}>
              {getTrendIcon()}
              <span>{getTrendText()}</span>
            </div>
          </div>
        </div>
        
        {/* Right: Percentile */}
        <div className="text-right">
          <div className="text-sm text-warm-400">Nationwide</div>
          <div className="text-lg font-semibold text-cyan-400">
            Top {100 - percentile}%
          </div>
        </div>
      </div>
      
      {/* Bottom: Quick Stats Comparison */}
      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-warm-700">
        <div className="flex items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-warm-500" />
          <span className="text-warm-400">
            {currentOccupancy > 50 ? 'Above' : 'Near'} area average
          </span>
        </div>
        <div className="flex-1" />
        <div className="text-xs text-warm-600">
          vs 247 venues
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Compact version for use in header or small spaces
 */
export function VenueRankingCompact({
  pulseScore,
  city = 'Area',
}: {
  pulseScore: number;
  city?: string;
}) {
  const rank = pulseScore >= 85 ? 1 : 
               pulseScore >= 80 ? 2 : 
               pulseScore >= 75 ? 3 : 
               pulseScore >= 70 ? 5 : 
               pulseScore >= 60 ? 10 : 15;
  
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-warm-800 rounded-lg">
      <Trophy className={`w-4 h-4 ${rank <= 3 ? 'text-amber-400' : 'text-warm-500'}`} />
      <span className="text-sm font-medium text-warm-200">
        #{rank} in {city}
      </span>
    </div>
  );
}

export default VenueRanking;
