/**
 * SweetSpotModal - Level 2 detail for sweet spot analysis
 * 
 * Shows: Full bucket breakdown for all variables
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Volume2, Sun, Users, Thermometer } from 'lucide-react';
import { haptic } from '../../utils/haptics';
import type { SweetSpotData, SweetSpotVariable } from '../../types/insights';

interface SweetSpotModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: SweetSpotData | null;
  allVariables: Record<SweetSpotVariable, SweetSpotData> | null;
  onViewRawData: () => void;
}

const VARIABLE_CONFIG: Record<SweetSpotVariable, { icon: typeof Volume2; label: string; color: string }> = {
  sound: { icon: Volume2, label: 'Sound', color: 'text-strain' },
  light: { icon: Sun, label: 'Light', color: 'text-recovery-medium' },
  crowd: { icon: Users, label: 'Crowd', color: 'text-teal' },
  temp: { icon: Thermometer, label: 'Temp', color: 'text-recovery-low' },
};

export function SweetSpotModal({
  isOpen,
  onClose,
  data: _data,
  allVariables,
  onViewRawData,
}: SweetSpotModalProps) {
  void _data; // Used for initial state if needed
  const [activeVariable, setActiveVariable] = useState<SweetSpotVariable>('sound');
  
  if (!isOpen || !allVariables) return null;

  const currentData = allVariables[activeVariable];

  const handleClose = () => {
    haptic('light');
    onClose();
  };

  const handleViewRaw = () => {
    haptic('medium');
    onViewRawData();
  };

  const handleVariableChange = (variable: SweetSpotVariable) => {
    haptic('selection');
    setActiveVariable(variable);
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <motion.div
        className="relative w-full max-w-lg max-h-[90vh] bg-whoop-panel border border-whoop-divider rounded-t-3xl lg:rounded-2xl overflow-hidden"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-whoop-panel border-b border-whoop-divider px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Sweet Spot Analysis</h2>
          <button onClick={handleClose} className="p-2 -mr-2 text-warm-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-60px)] p-5 space-y-6">
          {/* Variable Selector */}
          <div className="flex gap-2">
            {(Object.keys(VARIABLE_CONFIG) as SweetSpotVariable[]).map((variable) => {
              const config = VARIABLE_CONFIG[variable];
              const Icon = config.icon;
              const isActive = activeVariable === variable;
              
              return (
                <button
                  key={variable}
                  onClick={() => handleVariableChange(variable)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                    isActive 
                      ? 'bg-teal/20 border border-teal/30 text-teal' 
                      : 'bg-warm-800 border border-transparent text-warm-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{config.label}</span>
                </button>
              );
            })}
          </div>

          {/* Variable Label */}
          <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop">
            {VARIABLE_CONFIG[activeVariable].label} vs Avg Stay
          </h3>

          {/* Buckets */}
          <div className="space-y-3">
            {currentData.buckets.map((bucket, idx) => {
              const maxStay = Math.max(...currentData.buckets.map(b => b.avgStayMinutes));
              const widthPercent = maxStay > 0 ? (bucket.avgStayMinutes / maxStay) * 100 : 0;
              
              return (
                <div key={bucket.range} className="relative">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-warm-200 font-medium">{bucket.range}</span>
                    <span className="text-warm-500">({bucket.sampleCount} samples)</span>
                  </div>
                  <div className="h-8 bg-warm-800 rounded-lg overflow-hidden flex items-center relative">
                    <motion.div 
                      className={`h-full ${bucket.isOptimal ? 'bg-teal' : 'bg-warm-600'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPercent}%` }}
                      transition={{ duration: 0.5, delay: idx * 0.1 }}
                    />
                    <span className="absolute left-3 text-sm font-bold text-white">
                      {bucket.avgStayMinutes} min
                    </span>
                  </div>
                  {bucket.isOptimal && (
                    <div className="absolute -right-2 top-0 translate-x-full pl-3 text-xs font-bold text-teal">
                      ★ SWEET SPOT
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Impact Summary */}
          <div className="bg-teal/10 border border-teal/20 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-teal mb-2">The Impact</h4>
            <p className="text-sm text-warm-300">
              At <span className="text-white font-semibold">{currentData.optimalRange}</span>, guests stay{' '}
              <span className="text-teal font-semibold">
                {currentData.optimalStay - currentData.outsideStay} minutes longer
              </span>{' '}
              than outside this range.
            </p>
            <p className="text-sm text-warm-400 mt-2">
              You hit this range <span className="text-white font-semibold">{currentData.hitPercentage}%</span> of the time.
            </p>
          </div>

          {/* View Raw Data Button */}
          <button
            onClick={handleViewRaw}
            className="w-full py-3 bg-whoop-panel-secondary border border-whoop-divider rounded-xl text-center text-primary font-medium hover:bg-warm-800 transition-colors"
          >
            View Raw Data →
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default SweetSpotModal;
