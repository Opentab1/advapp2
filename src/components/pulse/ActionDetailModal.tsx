/**
 * ActionDetailModal - "See Why" modal
 * 
 * Shows the data-backed reasoning for an action:
 * - Current vs target values
 * - Why it matters (impact statements)
 * - Historical comparison
 * - Mini trend chart
 */

import { Modal } from '../common/Modal';
import { MiniChart } from '../common/MiniChart';
import { ChevronRight, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { OPTIMAL_RANGES } from '../../utils/constants';
import type { PulseAction } from '../../hooks/useActions';

interface ActionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: PulseAction | null;
  onComplete: () => void;
  /** Recent values for mini chart (e.g., last 2 hours of sound readings) */
  recentValues?: number[];
}

export function ActionDetailModal({
  isOpen,
  onClose,
  action,
  onComplete,
  recentValues = [],
}: ActionDetailModalProps) {
  if (!action) return null;
  
  const hasChart = recentValues.length >= 2;
  
  // Determine threshold for chart based on action category
  const chartThreshold = action.category === 'sound' 
    ? OPTIMAL_RANGES.sound.max 
    : action.category === 'light' 
      ? OPTIMAL_RANGES.light.max 
      : undefined;
  
  const handleComplete = () => {
    onComplete();
    onClose();
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={action.title}>
      <div className="space-y-5">
        {/* Current → Target */}
        {action.currentValue && action.targetValue && (
          <div className="flex items-center justify-center gap-4 py-4 px-3 bg-warm-50 rounded-xl">
            <div className="text-center">
              <p className="text-xs text-warm-500 uppercase mb-1">Current</p>
              <p className="text-2xl font-bold text-warm-800">{action.currentValue}</p>
            </div>
            <ChevronRight className="w-6 h-6 text-warm-400" />
            <div className="text-center">
              <p className="text-xs text-warm-500 uppercase mb-1">Target</p>
              <p className="text-2xl font-bold text-green-600">{action.targetValue}</p>
            </div>
          </div>
        )}
        
        {/* Why This Matters */}
        {action.reasoning && action.reasoning.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-warm-800 mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Why This Matters
            </h4>
            <ul className="space-y-2">
              {action.reasoning.map((reason, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-warm-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-warm-400 mt-1.5 flex-shrink-0" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Historical Comparison */}
        {action.historicalComparison && (
          <div className="p-3 rounded-lg bg-primary-50 border border-primary-100">
            <div className="flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-primary mt-0.5" />
              <p className="text-sm text-primary-600">{action.historicalComparison}</p>
            </div>
          </div>
        )}
        
        {/* Mini Chart */}
        {hasChart && (
          <div>
            <h4 className="text-sm font-semibold text-warm-800 mb-2">
              Recent Trend (Last 2 Hours)
            </h4>
            <MiniChart
              data={recentValues}
              color={action.category === 'sound' ? '#0077B6' : '#F59E0B'}
              threshold={chartThreshold}
              thresholdLabel={chartThreshold ? `${chartThreshold} optimal` : undefined}
            />
          </div>
        )}
        
        {/* Impact */}
        <div className="p-3 rounded-lg bg-green-50 border border-green-100">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800">Expected Impact</p>
              <p className="text-sm text-green-700">{action.impact}</p>
            </div>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-warm-100 text-warm-700 font-medium text-sm hover:bg-warm-200 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={handleComplete}
            className="flex-1 py-2.5 rounded-xl bg-warm-800 text-white font-medium text-sm flex items-center justify-center gap-2 hover:bg-warm-900 transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            I Did It
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ActionDetailModal;
