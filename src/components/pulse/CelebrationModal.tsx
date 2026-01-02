/**
 * CelebrationModal - Celebrates new records and milestones
 * 
 * Shows confetti animation and achievement details.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Flame, Target, Star, X } from 'lucide-react';

export type CelebrationType = 'record' | 'streak' | 'goal';

interface CelebrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: CelebrationType;
  title: string;
  subtitle: string;
  value: string | number;
  previousValue?: string | number;
  detail?: string;
}

const TYPE_CONFIG = {
  record: {
    icon: Trophy,
    gradient: 'from-amber-400 via-yellow-500 to-orange-500',
    bg: 'bg-amber-50',
    label: '🏆 NEW RECORD!',
  },
  streak: {
    icon: Flame,
    gradient: 'from-orange-500 via-red-500 to-pink-500',
    bg: 'bg-orange-50',
    label: '🔥 STREAK MILESTONE!',
  },
  goal: {
    icon: Target,
    gradient: 'from-green-400 via-emerald-500 to-teal-500',
    bg: 'bg-green-50',
    label: '🎯 GOAL ACHIEVED!',
  },
};

export function CelebrationModal({
  isOpen,
  onClose,
  type,
  title,
  subtitle,
  value,
  previousValue,
  detail,
}: CelebrationModalProps) {
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;
  
  // Auto-close after 5 seconds
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(onClose, 5000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);
  
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          
          {/* Confetti */}
          <Confetti />
          
          {/* Modal */}
          <motion.div
            className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            initial={{ scale: 0.5, opacity: 0, y: 50 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.5, opacity: 0, y: 50 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/80 hover:bg-white z-10"
            >
              <X className="w-5 h-5 text-warm-500" />
            </button>
            
            {/* Gradient header */}
            <div className={`bg-gradient-to-r ${config.gradient} p-6 text-center`}>
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring' }}
              >
                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Icon className="w-10 h-10 text-white" />
                </div>
              </motion.div>
              
              <motion.p
                className="text-white/90 text-sm font-bold uppercase tracking-wider"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                {config.label}
              </motion.p>
            </div>
            
            {/* Content */}
            <div className="p-6 text-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <h2 className="text-2xl font-bold text-warm-800 mb-1">{title}</h2>
                <p className="text-warm-500 mb-4">{subtitle}</p>
                
                {/* Big value */}
                <div className={`inline-block px-6 py-3 rounded-2xl ${config.bg} mb-4`}>
                  <p className="text-4xl font-bold bg-gradient-to-r ${config.gradient} bg-clip-text text-transparent">
                    {value}
                  </p>
                  {previousValue && (
                    <p className="text-sm text-warm-500 mt-1">
                      Previous: {previousValue}
                    </p>
                  )}
                </div>
                
                {detail && (
                  <p className="text-sm text-warm-600">{detail}</p>
                )}
              </motion.div>
              
              {/* Dismiss button */}
              <motion.button
                onClick={onClose}
                className="mt-4 w-full py-3 rounded-xl bg-warm-100 text-warm-700 font-semibold hover:bg-warm-200 transition-colors"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                Awesome!
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============ CONFETTI ============

function Confetti() {
  const [particles, setParticles] = useState<Array<{
    id: number;
    x: number;
    color: string;
    delay: number;
    duration: number;
  }>>([]);
  
  useEffect(() => {
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
    const newParticles = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 0.5,
      duration: 2 + Math.random() * 2,
    }));
    setParticles(newParticles);
  }, []);
  
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute w-3 h-3 rounded-sm"
          style={{
            left: `${p.x}%`,
            backgroundColor: p.color,
            top: -20,
          }}
          initial={{ y: 0, rotate: 0, opacity: 1 }}
          animate={{
            y: window.innerHeight + 50,
            rotate: Math.random() * 720 - 360,
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: 'easeIn',
          }}
        />
      ))}
    </div>
  );
}

export default CelebrationModal;
