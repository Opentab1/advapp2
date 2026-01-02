/**
 * DwellBreakdownModal - Dwell time details
 */

import { Modal } from '../common/Modal';
import { Clock } from 'lucide-react';
import { getDwellTimeCategory, formatDwellTime } from '../../utils/scoring';

interface DwellBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  dwellTimeMinutes: number | null;
}

export function DwellBreakdownModal({
  isOpen,
  onClose,
  dwellTimeMinutes,
}: DwellBreakdownModalProps) {
  const category = getDwellTimeCategory(dwellTimeMinutes);
  const formatted = formatDwellTime(dwellTimeMinutes);
  
  const categoryStyles = {
    excellent: { bg: 'bg-green-50 border-green-200', text: 'text-green-700', icon: '🎯' },
    good: { bg: 'bg-primary-50 border-primary-100', text: 'text-primary-700', icon: '👍' },
    fair: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: '⚠️' },
    poor: { bg: 'bg-red-50 border-red-200', text: 'text-red-700', icon: '📉' },
    unknown: { bg: 'bg-warm-50 border-warm-200', text: 'text-warm-700', icon: '❓' },
  };
  
  const style = categoryStyles[category as keyof typeof categoryStyles] || categoryStyles.unknown;
  
  const messages = {
    excellent: 'Guests love staying here. Whatever you\'re doing, keep it up!',
    good: 'Solid dwell time. There might be room to optimize atmosphere.',
    fair: 'Guests might be leaving earlier than ideal. Check sound/light levels.',
    poor: 'Low dwell time hurts revenue. Review the atmosphere factors.',
    unknown: 'Not enough data to calculate dwell time yet.',
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Dwell Time Details">
      <div className="space-y-5">
        {/* Main value */}
        <div className="text-center py-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Clock className="w-6 h-6 text-primary" />
            <p className="text-4xl font-bold text-warm-800">{formatted}</p>
          </div>
          <p className="text-sm text-warm-500">average time guests stay</p>
        </div>
        
        {/* Category badge */}
        <div className={`p-3 rounded-xl border ${style.bg}`}>
          <p className={`text-sm font-medium ${style.text}`}>
            {style.icon} {category.charAt(0).toUpperCase() + category.slice(1)}
          </p>
          <p className="text-sm text-warm-600 mt-1">
            {messages[category as keyof typeof messages]}
          </p>
        </div>
        
        {/* What affects dwell time */}
        <div className="p-3 rounded-xl bg-warm-50">
          <p className="text-xs text-warm-500 uppercase tracking-wide mb-2 font-medium">
            What affects dwell time?
          </p>
          <ul className="space-y-2 text-sm text-warm-600">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
              <span><strong>Sound:</strong> Too loud = guests leave. Sweet spot is 70-78 dB.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5" />
              <span><strong>Lighting:</strong> Evening vibe needs dimmer lights.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5" />
              <span><strong>Service:</strong> Fast service keeps people happy and ordering.</span>
            </li>
          </ul>
        </div>
        
        {/* Thresholds reference */}
        <div className="text-xs text-warm-400 text-center">
          <p>Excellent: 60+ min • Good: 45-60 min • Fair: 30-45 min</p>
        </div>
      </div>
    </Modal>
  );
}

export default DwellBreakdownModal;
