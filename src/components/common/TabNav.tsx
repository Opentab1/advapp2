/**
 * TabNav - Bottom navigation for mobile + side nav for desktop
 * 
 * 4 tabs: Live, Analytics, Songs, Settings
 * Mobile: Fixed bottom bar
 * Desktop: Left sidebar
 * 
 * Features: Smooth animated transitions, haptic feedback
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Zap, BarChart2, Music, Settings, Sparkles, Users, LucideIcon } from 'lucide-react';
import { haptic } from '../../utils/haptics';

export type TabId = 'live' | 'analytics' | 'songs' | 'events' | 'staffing' | 'settings';

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { id: 'live', label: 'Live', icon: Zap },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
  { id: 'songs', label: 'Songs', icon: Music },
  { id: 'events', label: 'Events', icon: Sparkles },
  { id: 'staffing', label: 'Staffing', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface TabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabNav({ activeTab, onTabChange }: TabNavProps) {
  const handleTabChange = (tab: TabId) => {
    if (tab !== activeTab) {
      haptic('selection');
      onTabChange(tab);
    }
  };
  
  return (
    <>
      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-whoop-bg border-t border-whoop-divider z-50 lg:hidden safe-bottom">
        <div className="flex justify-around items-center h-16 px-2">
          {TABS.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={activeTab === tab.id}
              onClick={() => handleTabChange(tab.id)}
            />
          ))}
        </div>
      </nav>

      {/* Desktop Side Navigation */}
      <aside className="hidden lg:flex flex-col w-48 bg-whoop-panel border-r border-whoop-divider py-6">
        <nav className="flex flex-col gap-1 px-3">
          {TABS.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={activeTab === tab.id}
              onClick={() => handleTabChange(tab.id)}
              variant="desktop"
            />
          ))}
        </nav>
      </aside>
    </>
  );
}

interface TabButtonProps {
  tab: Tab;
  isActive: boolean;
  onClick: () => void;
  variant?: 'mobile' | 'desktop';
}

function TabButton({ tab, isActive, onClick, variant = 'mobile' }: TabButtonProps) {
  const Icon = tab.icon;
  
  // Desktop: horizontal layout, Mobile: vertical layout
  if (variant === 'desktop') {
    return (
      <motion.button
        onClick={onClick}
        className={`
          relative flex items-center gap-3 px-4 py-3 rounded-xl w-full text-left
          ${isActive 
            ? 'text-teal' 
            : 'text-text-secondary hover:text-white hover:bg-whoop-panel-secondary'
          }
        `}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        {/* Active indicator */}
        <AnimatePresence>
          {isActive && (
            <motion.div
              layoutId="activeTabDesktop"
              className="absolute inset-0 bg-teal/10 border border-teal/30 rounded-xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
        </AnimatePresence>
        
        <Icon className="w-5 h-5 relative z-10 flex-shrink-0" />
        <span className="text-sm font-medium relative z-10">{tab.label}</span>
      </motion.button>
    );
  }
  
  // Mobile: vertical layout
  return (
    <motion.button
      onClick={onClick}
      className={`
        relative flex flex-col items-center justify-center gap-0.5 rounded-xl
        px-2 py-2 min-w-[56px]
        ${isActive 
          ? 'text-teal' 
          : 'text-text-muted hover:text-text-secondary'
        }
      `}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {/* Active indicator with spring animation */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            layoutId="activeTabMobile"
            className="absolute inset-0 bg-teal/10 rounded-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}
      </AnimatePresence>
      
      {/* Icon with bounce on active */}
      <motion.div
        animate={isActive ? { scale: [1, 1.15, 1] } : { scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Icon className="w-5 h-5 relative z-10" />
      </motion.div>
      
      <motion.span 
        className="text-[10px] font-medium relative z-10"
        animate={isActive ? { fontWeight: 600 } : { fontWeight: 500 }}
      >
        {tab.label}
      </motion.span>
    </motion.button>
  );
}

export default TabNav;
