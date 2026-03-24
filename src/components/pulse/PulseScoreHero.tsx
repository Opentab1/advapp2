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
  contextSentence?: string;
}

export function PulseScoreHero({ score, statusLabel, onTap, contextSentence }: PulseScoreHeroProps) {
  const color = getScoreColor(score);

  return (
    <div className="flex flex-col items-center">
      <Ring
        score={score}
        label="Pulse Score"
        subtitle={statusLabel}
        color={color}
        size="hero"
        onClick={onTap}
        showHint
      />
      {contextSentence && (
        <p className="text-xs text-text-secondary text-center mt-2 max-w-[240px] leading-relaxed">
          {contextSentence}
        </p>
      )}
    </div>
  );
}

export default PulseScoreHero;
