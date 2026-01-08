/**
 * Header - Minimal Calm Header
 * 
 * Extremely sparse. Just the logo and profile.
 * Context (Greeting, Weather, etc.) moved to page content.
 */

import { motion } from 'framer-motion';
import { User as UserIcon, Wifi, WifiOff } from 'lucide-react';
import { Logo } from '../Logo';
import { haptic } from '../../utils/haptics';
import authService from '../../services/auth.service';

interface HeaderProps {
  isConnected?: boolean;
  onLogout: () => void;
}

export function Header({ 
  isConnected = true, 
  onLogout 
}: HeaderProps) {
  const user = authService.getStoredUser();
  
  // Get initials from venue name or email
  const getInitials = () => {
    if (user?.venueName) {
      return user.venueName.substring(0, 2).toUpperCase();
    }
    return user?.email?.substring(0, 2).toUpperCase() || '??';
  };
  
  const handleLogout = () => {
    haptic('medium');
    onLogout();
  };
  
  return (
    <motion.header
      className="bg-whoop-bg/90 backdrop-blur-md sticky top-0 z-40 border-b border-transparent transition-colors duration-300"
      initial={{ y: -60 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="flex items-center justify-between px-4 py-3 lg:px-8 max-w-lg mx-auto lg:max-w-none">
        {/* Left: Brand Mark */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 text-primary">
             {/* Static logo for calm feel */}
            <Logo className="text-primary" />
          </div>
        </div>

        {/* Right: Profile & Status */}
        <div className="flex items-center gap-3">
          <motion.button
            onClick={handleLogout}
            className="relative"
            whileTap={{ scale: 0.95 }}
            aria-label="Profile & Settings"
          >
            {/* Profile Circle */}
            <div className="w-9 h-9 rounded-full bg-warm-800 border border-warm-700 flex items-center justify-center overflow-hidden">
               <span className="text-xs font-bold text-warm-200 tracking-wider">
                 {getInitials()}
               </span>
            </div>
            
            {/* Status Dot (Connection) */}
            <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-whoop-bg flex items-center justify-center ${
              isConnected ? 'bg-green-500' : 'bg-amber-500'
            }`}>
              {!isConnected && <span className="w-1.5 h-1.5 rounded-full bg-whoop-bg" />}
            </div>
          </motion.button>
        </div>
      </div>
    </motion.header>
  );
}

export default Header;
