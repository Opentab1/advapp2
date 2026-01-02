/**
 * Header - Simple top bar
 * 
 * Shows venue name, live indicator, and essential controls.
 * Clean and minimal.
 */

import { motion } from 'framer-motion';
import { LogOut, Wifi, WifiOff } from 'lucide-react';

interface HeaderProps {
  venueName: string;
  isConnected?: boolean;
  onLogout: () => void;
}

export function Header({ venueName, isConnected = true, onLogout }: HeaderProps) {
  return (
    <motion.header
      className="bg-white border-b border-warm-200 px-4 py-3 sticky top-0 z-40"
      initial={{ y: -60 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="flex items-center justify-between max-w-2xl mx-auto">
        {/* Left: Venue name + connection status */}
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-warm-800 leading-tight">
              {venueName}
            </h1>
            <div className="flex items-center gap-1.5">
              {isConnected ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs text-warm-500">Live</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-xs text-amber-600">Reconnecting...</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Connection + Logout */}
        <div className="flex items-center gap-2">
          {/* Connection indicator (mobile-visible) */}
          <div className="p-2 rounded-lg bg-warm-50">
            {isConnected ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-500" />
            )}
          </div>
          
          {/* Logout */}
          <motion.button
            onClick={onLogout}
            className="p-2 rounded-lg bg-warm-50 hover:bg-warm-100 transition-colors"
            whileTap={{ scale: 0.95 }}
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4 text-warm-500" />
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
}

export default Header;
