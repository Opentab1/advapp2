/**
 * Modal - Reusable modal wrapper
 * 
 * Handles backdrop, animations, and close behavior.
 * Used for all breakdown modals and action details.
 * Full dark mode support.
 */

import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional: hide the X button */
  hideClose?: boolean;
  /** Optional: max width class */
  maxWidth?: 'sm' | 'md' | 'lg';
}

const MAX_WIDTH_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  hideClose = false,
  maxWidth = 'sm',
}: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-900/60 dark:bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`bg-white dark:bg-warm-800 rounded-2xl shadow-xl w-full ${MAX_WIDTH_CLASSES[maxWidth]} border border-warm-200 dark:border-warm-700 overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-warm-100 dark:border-warm-700">
              <h3 className="text-lg font-bold text-warm-800 dark:text-warm-100">{title}</h3>
              {!hideClose && (
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-warm-100 dark:hover:bg-warm-700 transition-colors"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-warm-400 dark:text-warm-500" />
                </button>
              )}
            </div>
            
            {/* Content */}
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default Modal;
