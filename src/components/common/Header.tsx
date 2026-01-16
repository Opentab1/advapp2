/**
 * Header - Greeting Anchor Style
 * 
 * Left: "Good Morning" etc.
 * Right: Live Status (based on actual data freshness) + Logout
 * BG: Matches sidebar (warm-900 / whoop-panel)
 */

import { motion } from 'framer-motion';
import { LogOut } from 'lucide-react';
import { haptic } from '../../utils/haptics';

interface HeaderProps {
  isConnected?: boolean;
  dataAgeSeconds?: number;
  onLogout: () => void;
}

export function Header({ 
  isConnected = true,
  dataAgeSeconds,
  onLogout 
}: HeaderProps) {
  
  const handleLogout = () => {
    haptic('medium');
    onLogout();
  };
  
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };
  
  // Determine status based on data age
  // Fresh: < 60s, Stale: 60-300s, Disconnected: > 300s
  const getDataStatus = () => {
    if (dataAgeSeconds === undefined || dataAgeSeconds === Infinity) {
      return { label: 'LOADING', color: 'text-gray-400', dotColor: 'bg-gray-400', animate: false };
    }
    if (dataAgeSeconds < 60) {
      return { label: 'LIVE', color: 'text-green-500', dotColor: 'bg-green-500', animate: true };
    }
    if (dataAgeSeconds < 300) {
      const mins = Math.floor(dataAgeSeconds / 60);
      return { label: `${mins}m AGO`, color: 'text-amber-500', dotColor: 'bg-amber-500', animate: false };
    }
    const mins = Math.floor(dataAgeSeconds / 60);
    return { label: `${mins}m AGO`, color: 'text-red-500', dotColor: 'bg-red-500', animate: false };
  };
  
  const status = getDataStatus();
  
  return (
    <motion.header
      // Match the Sidebar bg (whoop-panel) for seamless look
      className="bg-whoop-panel border-b border-whoop-divider sticky top-0 z-40"
      initial={{ y: -60 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="flex items-center justify-between px-4 py-3 lg:px-6">
        {/* Left: Greeting */}
        <span className="text-lg font-bold text-warm-100 tracking-wide">
          {getGreeting()}
        </span>

        {/* Right: Data Status + Logout */}
        <div className="flex items-center gap-4">
          {/* Data Status Indicator */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status.dotColor} ${status.animate ? 'animate-pulse' : ''}`} />
            <span className={`text-xs font-medium tracking-wide ${status.color}`}>
              {status.label}
            </span>
          </div>
          
          {/* Divider */}
          <div className="w-px h-4 bg-whoop-divider" />
          
          {/* Logout Button */}
          <motion.button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-warm-400 hover:text-warm-100 hover:bg-warm-800 transition-colors"
            whileTap={{ scale: 0.95 }}
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Logout</span>
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
}

export default Header;
