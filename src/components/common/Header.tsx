/**
 * Header - Premium top bar with mini score
 * 
 * Shows venue name, mini Pulse Score, live indicator, dark mode toggle, and logout.
 * Clean and minimal with WHOOP-style touches.
 */

import { motion } from 'framer-motion';
import { LogOut, Wifi, WifiOff, Moon, Sun } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { haptic } from '../../utils/haptics';

interface HeaderProps {
  venueName: string;
  isConnected?: boolean;
  pulseScore?: number | null;
  isDark?: boolean;
  onToggleDark?: () => void;
  onLogout: () => void;
}

export function Header({ 
  venueName, 
  isConnected = true, 
  pulseScore,
  isDark = false,
  onToggleDark,
  onLogout 
}: HeaderProps) {
  const handleToggleDark = () => {
    haptic('selection');
    onToggleDark?.();
  };
  
  const handleLogout = () => {
    haptic('medium');
    onLogout();
  };
  
  return (
    <motion.header
      className="bg-white dark:bg-warm-900 border-b border-warm-200 dark:border-warm-700 px-4 py-3 sticky top-0 z-40 transition-colors"
      initial={{ y: -60 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="flex items-center justify-between max-w-2xl mx-auto">
        {/* Left: Venue name + connection status */}
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-warm-800 dark:text-warm-100 leading-tight">
              {venueName}
            </h1>
            <div className="flex items-center gap-1.5">
              {isConnected ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs text-warm-500 dark:text-warm-400">Live</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-xs text-amber-600 dark:text-amber-400">Reconnecting...</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Mini Score + Dark Mode + Connection + Logout */}
        <div className="flex items-center gap-2">
          {/* Mini Pulse Score */}
          {pulseScore !== undefined && (
            <motion.div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 dark:bg-primary/20"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="w-2 h-2 rounded-full bg-primary" />
              <AnimatedNumber 
                value={pulseScore} 
                className="text-sm font-bold text-primary"
              />
            </motion.div>
          )}
          
          {/* Dark mode toggle */}
          {onToggleDark && (
            <motion.button
              onClick={handleToggleDark}
              className="p-2 rounded-lg bg-warm-50 dark:bg-warm-800 hover:bg-warm-100 dark:hover:bg-warm-700 transition-colors"
              whileTap={{ scale: 0.95 }}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-amber-500" />
              ) : (
                <Moon className="w-4 h-4 text-warm-500" />
              )}
            </motion.button>
          )}
          
          {/* Connection indicator */}
          <div className="p-2 rounded-lg bg-warm-50 dark:bg-warm-800">
            {isConnected ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-500" />
            )}
          </div>
          
          {/* Logout */}
          <motion.button
            onClick={handleLogout}
            className="p-2 rounded-lg bg-warm-50 dark:bg-warm-800 hover:bg-warm-100 dark:hover:bg-warm-700 transition-colors"
            whileTap={{ scale: 0.95 }}
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4 text-warm-500 dark:text-warm-400" />
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
}

export default Header;
