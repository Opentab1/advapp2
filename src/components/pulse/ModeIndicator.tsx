/**
 * ModeIndicator - Shows current venue operational mode
 * 
 * Displays:
 * - Mode icon (☀️ Prep, 🔥 Live, 🌙 Closed)
 * - Mode label
 * - Suggested focus
 */

import { motion } from 'framer-motion';
import { VenueMode, getModeIcon, getModeFocus } from '../../utils/venueMode';

interface ModeIndicatorProps {
  mode: VenueMode;
  compact?: boolean;
}

const MODE_STYLES = {
  prep: {
    bg: 'bg-amber-900/20',
    border: 'border-amber-800/30',
    text: 'text-amber-400',
    label: 'Prep',
  },
  service: {
    bg: 'bg-red-900/20',
    border: 'border-red-800/30',
    text: 'text-red-400',
    label: 'Live',
  },
  closed: {
    bg: 'bg-purple-900/20',
    border: 'border-purple-800/30',
    text: 'text-purple-400',
    label: 'Closed',
  },
};

export function ModeIndicator({ mode, compact = false }: ModeIndicatorProps) {
  const style = MODE_STYLES[mode];
  const icon = getModeIcon(mode);
  const focus = getModeFocus(mode);
  
  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg ${style.bg} ${style.border} border`}>
        <span className="text-sm">{icon}</span>
        <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
      </div>
    );
  }
  
  return (
    <motion.div
      className={`p-3 rounded-xl ${style.bg} ${style.border} border`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className={`text-sm font-semibold ${style.text}`}>{style.label} Mode</p>
          <p className="text-xs text-warm-400">{focus}</p>
        </div>
      </div>
    </motion.div>
  );
}

export default ModeIndicator;
