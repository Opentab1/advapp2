/**
 * Animation utilities - Reusable animation configs for Framer Motion
 * 
 * Provides consistent, polished animations across the app.
 */

// ============ SPRING CONFIGS ============

export const springs = {
  // Snappy for UI elements
  snappy: { type: 'spring', stiffness: 400, damping: 30 },
  // Bouncy for celebrations
  bouncy: { type: 'spring', stiffness: 300, damping: 20 },
  // Smooth for cards
  smooth: { type: 'spring', stiffness: 200, damping: 25 },
  // Gentle for modals
  gentle: { type: 'spring', stiffness: 150, damping: 20 },
} as const;

// ============ FADE VARIANTS ============

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const fadeInUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
};

export const fadeInDown = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
};

export const fadeInScale = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

// ============ STAGGER VARIANTS ============

export const staggerContainer = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

export const staggerItem = {
  initial: { opacity: 0, y: 8 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.2 },
  },
};

export const staggerItemScale = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { 
    opacity: 1, 
    scale: 1,
    transition: { duration: 0.2 },
  },
};

// ============ SLIDE VARIANTS ============

export const slideInRight = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

export const slideInLeft = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
};

// ============ MODAL VARIANTS ============

export const modalOverlay = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const modalContent = {
  initial: { opacity: 0, y: 20, scale: 0.98 },
  animate: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: springs.gentle,
  },
  exit: { 
    opacity: 0, 
    y: 10, 
    scale: 0.98,
    transition: { duration: 0.15 },
  },
};

export const bottomSheetContent = {
  initial: { y: '100%' },
  animate: { 
    y: 0,
    transition: springs.smooth,
  },
  exit: { 
    y: '100%',
    transition: { duration: 0.2 },
  },
};

// ============ PULSE/GLOW EFFECTS ============

export const pulseGlow = {
  animate: {
    boxShadow: [
      '0 0 0 0 rgba(0, 119, 182, 0)',
      '0 0 0 8px rgba(0, 119, 182, 0.1)',
      '0 0 0 0 rgba(0, 119, 182, 0)',
    ],
    transition: {
      duration: 2,
      repeat: Infinity,
      repeatType: 'loop' as const,
    },
  },
};

// ============ COUNT UP EFFECT ============

export const countUp = (duration = 0.5) => ({
  initial: { opacity: 0 },
  animate: { 
    opacity: 1,
    transition: { duration },
  },
});

// ============ RING VARIANTS ============

export const ringProgress = (progress: number, delay = 0) => ({
  initial: { pathLength: 0 },
  animate: { 
    pathLength: progress / 100,
    transition: { 
      duration: 1, 
      delay,
      ease: 'easeOut',
    },
  },
});

// ============ PAGE TRANSITIONS ============

export const pageTransition = {
  initial: { opacity: 0 },
  animate: { 
    opacity: 1,
    transition: { duration: 0.2 },
  },
  exit: { 
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

// ============ CELEBRATION VARIANTS ============

export const celebrationPop = {
  initial: { scale: 0, opacity: 0 },
  animate: { 
    scale: 1, 
    opacity: 1,
    transition: springs.bouncy,
  },
  exit: { 
    scale: 0.8, 
    opacity: 0,
    transition: { duration: 0.2 },
  },
};

export const confettiBurst = {
  initial: { scale: 0, rotate: 0 },
  animate: (i: number) => ({
    scale: 1,
    rotate: Math.random() * 360,
    x: (Math.random() - 0.5) * 200,
    y: (Math.random() - 0.5) * 200,
    opacity: [1, 1, 0],
    transition: {
      duration: 0.8 + Math.random() * 0.4,
      delay: i * 0.02,
    },
  }),
};

export default springs;
