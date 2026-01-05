/**
 * Header - Premium top bar with greeting and weather
 * 
 * Shows greeting, day, weather, mini Pulse Score, and logout.
 * Clean and minimal with WHOOP-style touches.
 * Matte black theme with white text.
 */

import { motion } from 'framer-motion';
import { LogOut, Wifi, WifiOff } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { haptic } from '../../utils/haptics';

interface HeaderProps {
  venueName: string;
  isConnected?: boolean;
  pulseScore?: number | null;
  weather?: { temperature: number; icon: string } | null;
  onLogout: () => void;
}

// Get greeting based on time of day
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// Get day name
function getDayName(): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date().getDay()];
}

export function Header({ 
  venueName, 
  isConnected = true, 
  pulseScore,
  weather,
  onLogout 
}: HeaderProps) {
  const handleLogout = () => {
    haptic('medium');
    onLogout();
  };
  
  const greeting = getGreeting();
  const dayName = getDayName();
  
  return (
    <motion.header
      className="bg-whoop-bg border-b border-whoop-divider px-4 py-3 lg:px-8 sticky top-0 z-40"
      initial={{ y: -60 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="flex items-center justify-between max-w-lg mx-auto lg:max-w-none">
        {/* Left: Greeting + Day + Weather */}
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-warm-100 leading-tight">
                {greeting}, {dayName}
              </h1>
              {weather && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-warm-800">
                  <span className="text-sm">{weather.icon}</span>
                  <span className="text-xs font-medium text-warm-200">
                    {Math.round(weather.temperature)}°
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {isConnected ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs text-warm-400">Live</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-xs text-amber-400">Reconnecting...</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Mini Score + Connection + Logout */}
        <div className="flex items-center gap-2">
          {/* Mini Pulse Score */}
          {pulseScore !== undefined && (
            <motion.div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/20"
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
          
          {/* Connection indicator */}
          <div className="p-2 rounded-lg bg-warm-800">
            {isConnected ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-500" />
            )}
          </div>
          
          {/* Logout */}
          <motion.button
            onClick={handleLogout}
            className="p-2 rounded-lg bg-warm-800 hover:bg-warm-700 transition-colors"
            whileTap={{ scale: 0.95 }}
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4 text-warm-400" />
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
}

export default Header;
