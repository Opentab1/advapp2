import { motion } from 'framer-motion';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <motion.svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="text-cyan"
        animate={{
          scale: [1, 1.05, 1],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut'
        }}
      >
        {/* Heart beat pulse line */}
        <motion.path
          d="M2 20 L8 20 L10 15 L12 25 L14 18 L16 22 L18 20 L38 20"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
        
        {/* Glowing circle at the end */}
        <motion.circle
          cx="38"
          cy="20"
          r="3"
          fill="currentColor"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [1, 0.6, 1]
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
      </motion.svg>
      
      <div className="flex flex-col">
        <span className="text-xl font-bold tracking-tight gradient-text">Ferg's Sports Bar</span>
        <span className="text-[10px] text-cyan/60 font-medium tracking-wider uppercase">Live Pulse</span>
      </div>
    </div>
  );
}
