import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Bell, BellOff, MapPin, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import type { Location } from '../types';

interface TopBarProps {
  venueName?: string;
  onLogout: () => void;
  soundAlerts: boolean;
  onToggleSoundAlerts: () => void;
  locations?: Location[];
  currentLocationId?: string;
  onLocationChange?: (locationId: string) => void;
}

export function TopBar({ 
  onLogout, 
  soundAlerts, 
  onToggleSoundAlerts,
  locations = [],
  currentLocationId,
  onLocationChange
}: TopBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  
  const currentLocation = locations.find(l => l.id === currentLocationId);

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
        {/* Left: Company Name + Zone Selection */}
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400">{venueName || 'Advizia'}</h1>
            <p className="text-sm text-gray-400">
              Zone Selection: <span className="text-cyan-300">{currentLocation?.name || 'Main Floor'}</span>
            </p>
          </div>
          
          {/* Zone Dropdown - Always visible */}
          <div className="relative">
            <motion.button
              onClick={() => setShowLocationDropdown(!showLocationDropdown)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <MapPin className="w-4 h-4 text-cyan-400" />
              <span className="text-sm text-white font-medium">
                {currentLocation?.name || 'Main Floor'}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-300" />
            </motion.button>
            
            <AnimatePresence>
              {showLocationDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute top-full mt-2 left-0 w-64 glass-card border border-white/20 rounded-lg p-2 shadow-xl"
                >
                  {locations.length > 0 ? (
                    locations.map(location => (
                      <motion.button
                        key={location.id}
                        onClick={() => {
                          onLocationChange?.(location.id);
                          setShowLocationDropdown(false);
                        }}
                        className={`
                          w-full text-left px-3 py-2 rounded-lg transition-colors
                          ${
                            location.id === currentLocationId
                              ? 'bg-cyan-400/20 text-cyan-400'
                              : 'hover:bg-white/5 text-gray-300'
                          }
                        `}
                        whileHover={{ x: 4 }}
                      >
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" />
                          <div>
                            <div className="text-sm font-medium">{location.name}</div>
                            {location.address && (
                              <div className="text-xs text-gray-400">{location.address}</div>
                            )}
                          </div>
                        </div>
                      </motion.button>
                    ))
                  ) : (
                    <>
                      <motion.button
                        onClick={() => {
                          onLocationChange?.('main-floor');
                          setShowLocationDropdown(false);
                        }}
                        className={`
                          w-full text-left px-3 py-2 rounded-lg transition-colors
                          ${
                            currentLocationId === 'main-floor'
                              ? 'bg-cyan-400/20 text-cyan-400'
                              : 'hover:bg-white/5 text-gray-300'
                          }
                        `}
                        whileHover={{ x: 4 }}
                      >
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" />
                          <div className="text-sm font-medium">Main Floor</div>
                        </div>
                      </motion.button>
                      <motion.button
                        onClick={() => {
                          onLocationChange?.('patio');
                          setShowLocationDropdown(false);
                        }}
                        className={`
                          w-full text-left px-3 py-2 rounded-lg transition-colors
                          ${
                            currentLocationId === 'patio'
                              ? 'bg-cyan-400/20 text-cyan-400'
                              : 'hover:bg-white/5 text-gray-300'
                          }
                        `}
                        whileHover={{ x: 4 }}
                      >
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" />
                          <div className="text-sm font-medium">Patio</div>
                        </div>
                      </motion.button>
                      <motion.button
                        onClick={() => {
                          onLocationChange?.('bar-area');
                          setShowLocationDropdown(false);
                        }}
                        className={`
                          w-full text-left px-3 py-2 rounded-lg transition-colors
                          ${
                            currentLocationId === 'bar-area'
                              ? 'bg-cyan-400/20 text-cyan-400'
                              : 'hover:bg-white/5 text-gray-300'
                          }
                        `}
                        whileHover={{ x: 4 }}
                      >
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" />
                          <div className="text-sm font-medium">Bar Area</div>
                        </div>
                      </motion.button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
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

      {/* Mobile Company Name */}
      <div className="md:hidden flex items-center justify-between mt-3 pt-3 border-t border-white/10">
        <div>
          <h2 className="text-lg font-bold text-cyan-400">{venueName || 'Advizia'}</h2>
          <p className="text-xs text-gray-400">Zone: <span className="text-cyan-300">{currentLocation?.name || 'Main Floor'}</span></p>
        </div>
      </div>
    </motion.header>
  );
}
