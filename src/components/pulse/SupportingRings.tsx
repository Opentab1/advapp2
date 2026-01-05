/**
 * SupportingRings - Dwell, Reputation, Crowd rings
 * 
 * Three smaller rings below the main Pulse Score.
 * Each is tappable to show details.
 * Horizontal scroll on mobile, centered on desktop.
 * Staggered entry animation for polish.
 */

import { motion } from 'framer-motion';
import { Ring } from '../common/Ring';
import { RING_COLORS } from '../../utils/constants';

interface SupportingRingsProps {
  // Dwell time
  dwellTimeFormatted: string;
  dwellScore: number;
  onDwellTap: () => void;
  
  // Reputation
  rating: number | null;
  reputationScore: number;
  onReputationTap: () => void;
  
  // Crowd
  currentOccupancy: number;
  occupancyScore: number;
  onCrowdTap: () => void;
}

const containerVariants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  initial: { opacity: 0, y: 15, scale: 0.95 },
  animate: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: { 
      type: 'spring',
      stiffness: 300,
      damping: 25,
    },
  },
};

export function SupportingRings({
  dwellTimeFormatted,
  dwellScore,
  onDwellTap,
  rating,
  reputationScore,
  onReputationTap,
  currentOccupancy,
  occupancyScore,
  onCrowdTap,
}: SupportingRingsProps) {
  const rings = [
    {
      id: 'dwell',
      score: dwellScore,
      label: 'Avg Stay',
      value: dwellTimeFormatted,
      color: RING_COLORS.dwell,
      onClick: onDwellTap,
    },
    {
      id: 'reputation',
      score: reputationScore,
      label: 'Rating',
      value: rating ? `${rating.toFixed(1)}★` : '--',
      color: RING_COLORS.reputation,
      onClick: onReputationTap,
    },
    {
      id: 'crowd',
      score: occupancyScore,
      label: 'Crowd',
      value: String(currentOccupancy),
      color: RING_COLORS.crowd,
      onClick: onCrowdTap,
    },
  ];

  return (
    <div className="relative -mx-4 sm:mx-0">
      {/* Scroll container */}
      <motion.div 
        className="flex gap-8 sm:gap-12 px-4 sm:px-0 sm:justify-center overflow-x-auto scrollbar-hide snap-x snap-mandatory"
        variants={containerVariants}
        initial="initial"
        animate="animate"
        style={{ 
          scrollbarWidth: 'none', 
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {rings.map((ring) => (
          <motion.div 
            key={ring.id}
            className="flex-shrink-0 snap-center"
            variants={itemVariants}
          >
            <Ring
              score={ring.score}
              label={ring.label}
              value={ring.value}
              color={ring.color}
              size="small"
              onClick={ring.onClick}
            />
          </motion.div>
        ))}
      </motion.div>
      
      {/* Scroll indicators (mobile only) */}
      <div className="flex justify-center gap-1.5 mt-2 sm:hidden">
        {rings.map((ring, i) => (
          <div 
            key={ring.id}
            className="w-1.5 h-1.5 rounded-full bg-warm-600"
          />
        ))}
      </div>
    </div>
  );
}

export default SupportingRings;
