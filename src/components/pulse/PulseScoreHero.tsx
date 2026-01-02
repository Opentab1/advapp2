/**
 * PulseScoreHero - The main Pulse Score ring
 * 
 * Large, centered, tappable ring showing the overall score.
 * Tapping opens the breakdown modal.
 */

import { Ring } from '../common/Ring';
import { getScoreColor } from '../../utils/scoring';

interface PulseScoreHeroProps {
  score: number | null;
  statusLabel: string;
  onTap: () => void;
}

export function PulseScoreHero({ score, statusLabel, onTap }: PulseScoreHeroProps) {
  const color = getScoreColor(score);
  
  return (
    <div className="flex justify-center">
      <Ring
        score={score}
        label="Pulse Score"
        subtitle={statusLabel}
        color={color}
        size="hero"
        onClick={onTap}
        showHint
      />
    </div>
  );
}

export default PulseScoreHero;
