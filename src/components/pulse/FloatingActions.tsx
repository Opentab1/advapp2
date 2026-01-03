/**
 * FloatingActions - Floating action button with expandable menu
 * 
 * Quick access to:
 * - Generate Report
 * - Refresh Data
 * - (expandable for more actions)
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, FileText, RefreshCw, Share2, Settings } from 'lucide-react';
import { haptic } from '../../utils/haptics';

interface FloatingActionsProps {
  onReport: () => void;
  onRefresh: () => void;
  onShare?: () => void;
  onSettings?: () => void;
  isRefreshing?: boolean;
}

export function FloatingActions({
  onReport,
  onRefresh,
  onShare,
  onSettings,
  isRefreshing = false,
}: FloatingActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const toggleOpen = () => {
    haptic('light');
    setIsOpen(!isOpen);
  };
  
  const handleAction = (action: () => void) => {
    haptic('medium');
    action();
    setIsOpen(false);
  };
  
  const actions = [
    { id: 'report', icon: FileText, label: 'Report', action: onReport, color: 'bg-primary' },
    { id: 'refresh', icon: RefreshCw, label: 'Refresh', action: onRefresh, color: 'bg-warm-600', spin: isRefreshing },
    ...(onShare ? [{ id: 'share', icon: Share2, label: 'Share', action: onShare, color: 'bg-green-600' }] : []),
    ...(onSettings ? [{ id: 'settings', icon: Settings, label: 'Settings', action: onSettings, color: 'bg-warm-600' }] : []),
  ];
  
  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 bg-black/40 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>
      
      {/* FAB Container */}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col-reverse items-center gap-3">
        {/* Action buttons */}
        <AnimatePresence>
          {isOpen && actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <motion.button
                key={action.id}
                className={`w-12 h-12 rounded-full ${action.color} shadow-lg flex items-center justify-center`}
                initial={{ opacity: 0, scale: 0, y: 20 }}
                animate={{ 
                  opacity: 1, 
                  scale: 1, 
                  y: 0,
                  transition: { delay: index * 0.05 }
                }}
                exit={{ 
                  opacity: 0, 
                  scale: 0, 
                  y: 20,
                  transition: { delay: (actions.length - index) * 0.03 }
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleAction(action.action)}
              >
                <Icon className={`w-5 h-5 text-white ${action.spin ? 'animate-spin' : ''}`} />
              </motion.button>
            );
          })}
        </AnimatePresence>
        
        {/* Main FAB */}
        <motion.button
          className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center ${
            isOpen ? 'bg-warm-700' : 'bg-primary'
          }`}
          onClick={toggleOpen}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          {isOpen ? (
            <X className="w-6 h-6 text-white" />
          ) : (
            <Plus className="w-6 h-6 text-white" />
          )}
        </motion.button>
      </div>
      
      {/* Labels (when open) */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed bottom-20 right-20 z-50 flex flex-col-reverse items-end gap-3 pointer-events-none">
            {actions.map((action, index) => (
              <motion.span
                key={`label-${action.id}`}
                className="px-2 py-1 rounded bg-warm-800 text-warm-200 text-sm font-medium shadow-lg"
                initial={{ opacity: 0, x: 10 }}
                animate={{ 
                  opacity: 1, 
                  x: 0,
                  transition: { delay: index * 0.05 + 0.1 }
                }}
                exit={{ opacity: 0, x: 10 }}
              >
                {action.label}
              </motion.span>
            ))}
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

// Compact version - just two buttons inline
export function FloatingActionsCompact({
  onReport,
  onRefresh,
  isRefreshing = false,
}: {
  onReport: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}) {
  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2">
      <motion.button
        className="w-12 h-12 rounded-full bg-primary shadow-lg flex items-center justify-center"
        onClick={() => { haptic('medium'); onReport(); }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <FileText className="w-5 h-5 text-white" />
      </motion.button>
      <motion.button
        className="w-12 h-12 rounded-full bg-warm-700 shadow-lg flex items-center justify-center"
        onClick={() => { haptic('medium'); onRefresh(); }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        disabled={isRefreshing}
      >
        <RefreshCw className={`w-5 h-5 text-white ${isRefreshing ? 'animate-spin' : ''}`} />
      </motion.button>
    </div>
  );
}

export default FloatingActions;
