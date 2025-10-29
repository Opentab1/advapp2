import { motion } from 'framer-motion';

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Orb 1 */}
      <motion.div
        className="absolute w-96 h-96 rounded-full blur-3xl opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(0,212,255,0.3) 0%, rgba(59,130,246,0.3) 100%)',
          top: '-10%',
          left: '-5%'
        }}
        animate={{
          x: [0, 30, -20, 0],
          y: [0, -30, 20, 0],
          scale: [1, 1.1, 0.9, 1]
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
      />

      {/* Orb 2 */}
      <motion.div
        className="absolute w-80 h-80 rounded-full blur-3xl opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(168,85,247,0.2) 0%, rgba(236,72,153,0.2) 100%)',
          bottom: '-10%',
          right: '-5%'
        }}
        animate={{
          x: [0, -30, 20, 0],
          y: [0, 30, -20, 0],
          scale: [1, 0.9, 1.1, 1]
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 5
        }}
      />

      {/* Orb 3 */}
      <motion.div
        className="absolute w-64 h-64 rounded-full blur-3xl opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(96,165,250,0.2) 0%, rgba(0,212,255,0.2) 100%)',
          top: '40%',
          right: '10%'
        }}
        animate={{
          x: [0, 20, -15, 0],
          y: [0, -20, 15, 0],
          scale: [1, 1.05, 0.95, 1]
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 3
        }}
      />
    </div>
  );
}
