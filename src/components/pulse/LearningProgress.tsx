/**
 * LearningProgress - Small, elegant learning indicator
 * 
 * Shows how much the system has learned about this venue.
 * Tappable to show more details about what's been learned.
 * 
 * Design: Small pill in corner, WHOOP-style minimal
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, ChevronRight, Sparkles, TrendingUp, Check } from 'lucide-react';
import { Modal } from '../common/Modal';
import type { VenueLearning, DiscoveredPattern } from '../../services/venue-learning.service';

interface LearningProgressProps {
  learningProgress: number;  // 0-100
  status: VenueLearning['status'];
  patterns: DiscoveredPattern[];
  weeksOfData: number;
  isAnalyzing?: boolean;
}

export function LearningProgress({
  learningProgress,
  status,
  patterns,
  weeksOfData,
  isAnalyzing = false,
}: LearningProgressProps) {
  const [showModal, setShowModal] = useState(false);
  
  // Don't show if fully confident
  if (status === 'highly_confident') {
    return (
      <>
        <motion.button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/20 border border-green-500/30"
          whileTap={{ scale: 0.95 }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Check className="w-3 h-3 text-green-400" />
          <span className="text-xs font-medium text-green-400">Personalized</span>
        </motion.button>
        
        <LearningModal 
          isOpen={showModal} 
          onClose={() => setShowModal(false)}
          learningProgress={learningProgress}
          status={status}
          patterns={patterns}
          weeksOfData={weeksOfData}
        />
      </>
    );
  }
  
  // Status-based styling
  const getStatusStyle = () => {
    switch (status) {
      case 'confident':
        return {
          bg: 'bg-primary/20 border-primary/30',
          text: 'text-primary',
          glow: 'shadow-lg shadow-primary/20',
        };
      case 'learning':
        return {
          bg: 'bg-amber-500/20 border-amber-500/30',
          text: 'text-amber-400',
          glow: '',
        };
      default:
        return {
          bg: 'bg-warm-700/50 border-warm-600',
          text: 'text-warm-400',
          glow: '',
        };
    }
  };
  
  const style = getStatusStyle();
  
  return (
    <>
      <motion.button
        onClick={() => setShowModal(true)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${style.bg} ${style.glow} backdrop-blur-sm`}
        whileTap={{ scale: 0.95 }}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Brain icon with pulse animation while analyzing */}
        <div className="relative">
          <Brain className={`w-3.5 h-3.5 ${style.text}`} />
          {isAnalyzing && (
            <motion.div
              className="absolute inset-0 rounded-full bg-current opacity-30"
              animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            />
          )}
        </div>
        
        {/* Progress text */}
        <span className={`text-xs font-medium ${style.text}`}>
          Learning {learningProgress}%
        </span>
        
        {/* Mini progress bar */}
        <div className="w-12 h-1.5 bg-warm-700 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${status === 'learning' ? 'bg-amber-400' : 'bg-primary'}`}
            initial={{ width: 0 }}
            animate={{ width: `${learningProgress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        
        <ChevronRight className="w-3 h-3 text-warm-500" />
      </motion.button>
      
      {/* Details Modal */}
      <LearningModal 
        isOpen={showModal} 
        onClose={() => setShowModal(false)}
        learningProgress={learningProgress}
        status={status}
        patterns={patterns}
        weeksOfData={weeksOfData}
      />
    </>
  );
}

// ============ LEARNING MODAL ============

interface LearningModalProps {
  isOpen: boolean;
  onClose: () => void;
  learningProgress: number;
  status: VenueLearning['status'];
  patterns: DiscoveredPattern[];
  weeksOfData: number;
}

function LearningModal({
  isOpen,
  onClose,
  learningProgress,
  status,
  patterns,
  weeksOfData,
}: LearningModalProps) {
  const statusConfig = {
    insufficient_data: {
      label: 'Gathering Data',
      color: 'text-warm-400',
      message: 'Keep the sensors running! We need more data to learn your venue.',
    },
    learning: {
      label: 'Learning',
      color: 'text-amber-400',
      message: "We're finding patterns in your venue's data. More weeks = better accuracy.",
    },
    confident: {
      label: 'Confident',
      color: 'text-primary',
      message: "We've learned solid patterns. Recommendations are now personalized.",
    },
    highly_confident: {
      label: 'Highly Confident',
      color: 'text-green-400',
      message: 'Pulse Score is now fully personalized to your venue based on 8+ weeks of data.',
    },
  };
  
  const config = statusConfig[status];
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Venue Learning">
      <div className="space-y-6">
        {/* Progress Hero */}
        <div className="text-center py-6 bg-warm-700/50 rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Brain className="w-8 h-8 text-primary" />
            <span className="text-5xl font-bold text-warm-100">{learningProgress}%</span>
          </div>
          <p className={`text-sm font-medium ${config.color}`}>{config.label}</p>
          
          {/* Progress bar */}
          <div className="mt-4 mx-6">
            <div className="h-2 bg-warm-600 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 via-primary to-green-500"
                initial={{ width: 0 }}
                animate={{ width: `${learningProgress}%` }}
                transition={{ duration: 0.8 }}
              />
            </div>
            <div className="flex justify-between text-xs text-warm-500 mt-2">
              <span>Gathering</span>
              <span>Learning</span>
              <span>Confident</span>
              <span>Expert</span>
            </div>
          </div>
        </div>
        
        {/* Status Message */}
        <div className="p-4 bg-warm-800/50 rounded-xl border border-warm-700">
          <p className="text-sm text-warm-300">{config.message}</p>
          <p className="text-xs text-warm-500 mt-2">
            Based on {weeksOfData} week{weeksOfData !== 1 ? 's' : ''} of data
          </p>
        </div>
        
        {/* What We've Learned */}
        {patterns.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-warm-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              What We've Learned
            </h4>
            
            <div className="space-y-2">
              {patterns.slice(0, 4).map((pattern) => (
                <PatternCard key={pattern.id} pattern={pattern} />
              ))}
            </div>
          </div>
        )}
        
        {patterns.length === 0 && (
          <div className="text-center py-8">
            <Brain className="w-12 h-12 text-warm-600 mx-auto mb-3" />
            <p className="text-sm text-warm-400">No patterns discovered yet</p>
            <p className="text-xs text-warm-500 mt-1">Keep the sensors running to build your venue profile</p>
          </div>
        )}
        
        {/* What This Means */}
        <div className="bg-primary/10 rounded-xl p-4 border border-primary/20">
          <h4 className="text-sm font-medium text-warm-100 mb-2">What This Means</h4>
          <ul className="space-y-2 text-sm text-warm-300">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <span>Pulse Score is calibrated to YOUR venue, not generic assumptions</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <span>Recommendations based on what actually works for your guests</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <span>The more data, the smarter it gets</span>
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

// ============ PATTERN CARD ============

function PatternCard({ pattern }: { pattern: DiscoveredPattern }) {
  return (
    <motion.div
      className="p-3 bg-warm-800/50 rounded-lg border border-warm-700"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm text-warm-200">{pattern.description}</p>
        </div>
        <div className="flex items-center gap-1 text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
          <TrendingUp className="w-3 h-3" />
          <span className="text-xs font-medium">{pattern.impact}</span>
        </div>
      </div>
      
      {/* Confidence bar */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1 bg-warm-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary rounded-full" 
            style={{ width: `${pattern.confidence}%` }}
          />
        </div>
        <span className="text-xs text-warm-500">{pattern.confidence}% confident</span>
      </div>
    </motion.div>
  );
}

export default LearningProgress;
