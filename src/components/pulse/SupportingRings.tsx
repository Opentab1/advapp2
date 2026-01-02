/**
 * SupportingRings - Dwell, Reputation, Crowd rings
 * 
 * Three smaller rings below the main Pulse Score.
 * Each is tappable to show details.
 */

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
    <div className="flex justify-center gap-3 sm:gap-4">
      {/* Dwell Time */}
      <Ring
        score={dwellScore}
        label="Dwell Time"
        value={dwellTimeFormatted}
        color={RING_COLORS.dwell}
        size="small"
        onClick={onDwellTap}
      />
      
      {/* Reputation */}
      <Ring
        score={reputationScore}
        label="Reputation"
        value={rating ? `${rating.toFixed(1)}★` : '--'}
        color={RING_COLORS.reputation}
        size="small"
        onClick={onReputationTap}
      />
      
      {/* Crowd */}
      <Ring
        score={occupancyScore}
        label="Crowd"
        value={String(currentOccupancy)}
        color={RING_COLORS.crowd}
        size="small"
        onClick={onCrowdTap}
      />
    </div>
  );
}

export default SupportingRings;
