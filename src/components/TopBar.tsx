import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { LogOut, Bell, BellOff } from 'lucide-react';
import { Logo } from './Logo';
import { format } from 'date-fns';

interface TopBarProps {
  venueName: string;
  onLogout: () => void;
  soundAlerts: boolean;
  onToggleSoundAlerts: () => void;
}

export function TopBar({ venueName, onLogout, soundAlerts, onToggleSoundAlerts }: TopBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <motion.header
      className="glass-card border-b border-white/10 px-6 py-4 sticky top-0 z-50"
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="flex items-center justify-between">
        {/* Left: Logo */}
        <Logo />

        {/* Center: Venue Name */}
        <div className="hidden md:flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
          <span className="text-lg font-semibold text-white">{venueName}</span>
        </div>

        {/* Right: Clock, Alerts, Logout */}
        <div className="flex items-center gap-4">
          {/* Live Clock */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse" />
            <span className="text-sm font-medium text-gray-300 font-mono">
              {format(currentTime, 'HH:mm:ss')}
            </span>
          </div>

          {/* Sound Alerts Toggle */}
          <motion.button
            onClick={onToggleSoundAlerts}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title={soundAlerts ? 'Disable sound alerts' : 'Enable sound alerts'}
          >
            {soundAlerts ? (
              <Bell className="w-5 h-5 text-cyan" />
            ) : (
              <BellOff className="w-5 h-5 text-gray-400" />
            )}
          </motion.button>

          {/* Logout Button */}
          <motion.button
            onClick={onLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-red-500/20 hover:border-red-500/50 border border-white/10 transition-all"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline text-sm font-medium">Logout</span>
          </motion.button>
        </div>
      </div>

      {/* Mobile venue name */}
      <div className="md:hidden flex items-center justify-center gap-2 mt-3 pt-3 border-t border-white/10">
        <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
        <span className="text-sm font-semibold text-white">{venueName}</span>
      </div>
    </motion.header>
  );
}
