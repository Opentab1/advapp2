/**
 * BottomSheet - iOS/Android style bottom sheet modal
 * 
 * Slides up from bottom, can be dragged to close.
 * Matte black theme.
 */

import { ReactNode } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { X } from 'lucide-react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  };
  
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          
          {/* Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 bg-warm-800 rounded-t-3xl max-h-[85vh] overflow-hidden"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-warm-600 rounded-full" />
            </div>
            
            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-3 border-b border-warm-700">
              <h3 className="text-lg font-bold text-warm-100">{title}</h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-warm-700 transition-colors"
              >
                <X className="w-5 h-5 text-warm-400" />
              </button>
            </div>
            
            {/* Content */}
            <div className="px-5 py-4 overflow-y-auto max-h-[70vh]">
              {children}
            </div>
            
            {/* Safe area padding for iOS */}
            <div className="h-safe-area-bottom" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default BottomSheet;
