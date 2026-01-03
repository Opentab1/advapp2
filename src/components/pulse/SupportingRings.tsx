/**
 * SupportingRings - Dwell, Reputation, Crowd rings
 * 
 * Three smaller rings below the main Pulse Score.
 * Each is tappable to show details.
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
  return (
    <motion.div 
      className="flex justify-center gap-3 sm:gap-4"
      variants={containerVariants}
      initial="initial"
      animate="animate"
    >
      {/* Dwell Time */}
      <motion.div variants={itemVariants}>
        <Ring
          score={dwellScore}
          label="Dwell Time"
          value={dwellTimeFormatted}
          color={RING_COLORS.dwell}
          size="small"
          onClick={onDwellTap}
        />
      </motion.div>
      
      {/* Reputation */}
      <motion.div variants={itemVariants}>
        <Ring
          score={reputationScore}
          label="Reputation"
          value={rating ? `${rating.toFixed(1)}★` : '--'}
          color={RING_COLORS.reputation}
          size="small"
          onClick={onReputationTap}
        />
      </motion.div>
      
      {/* Crowd */}
      <motion.div variants={itemVariants}>
        <Ring
          score={occupancyScore}
          label="Crowd"
          value={String(currentOccupancy)}
          color={RING_COLORS.crowd}
          size="small"
          onClick={onCrowdTap}
        />
      </motion.div>
    </motion.div>
  );
}

export default SupportingRings;
