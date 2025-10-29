import { motion } from 'framer-motion';

export function LoadingSpinner({ fullScreen = false }: { fullScreen?: boolean }) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-4">
      <motion.div
        className="w-16 h-16 border-4 border-white/20 border-t-cyan rounded-full"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      />
      <motion.p
        className="text-gray-400 text-sm"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        Loading data...
      </motion.p>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-navy flex items-center justify-center z-50">
        {content}
      </div>
    );
  }

  return content;
}
