import { motion } from 'framer-motion';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <motion.div
      className="glass-card p-8 text-center max-w-md mx-auto"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        animate={{
          rotate: [0, 10, -10, 0]
        }}
        transition={{ duration: 0.5 }}
      >
        <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
      </motion.div>
      
      <h3 className="text-xl font-semibold text-white mb-2">
        Something went wrong
      </h3>
      
      <p className="text-gray-400 mb-6">
        {message}
      </p>
      
      {onRetry && (
        <motion.button
          onClick={onRetry}
          className="btn-primary inline-flex items-center gap-2"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </motion.button>
      )}
    </motion.div>
  );
}
