/**
 * TabNav - Bottom navigation for mobile + side nav for desktop
 * 
 * 5 tabs: Pulse, History, Team, Songs, Settings
 * Mobile: Fixed bottom bar
 * Desktop: Left sidebar
 * 
 * Features: Smooth animated transitions, haptic feedback
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Zap, BarChart2, Users, Music, Settings, LucideIcon } from 'lucide-react';
import { haptic } from '../../utils/haptics';

export type TabId = 'pulse' | 'history' | 'team' | 'songs' | 'settings';

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { id: 'pulse', label: 'Pulse', icon: Zap },
  { id: 'history', label: 'History', icon: BarChart2 },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'songs', label: 'Songs', icon: Music },
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
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-warm-900 border-t border-warm-200 dark:border-warm-700 z-50 lg:hidden safe-bottom transition-colors">
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
      <aside className="hidden lg:flex flex-col w-20 bg-white dark:bg-warm-900 border-r border-warm-200 dark:border-warm-700 py-6 transition-colors">
        <nav className="flex flex-col gap-2 px-3">
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
  
  return (
    <motion.button
      onClick={onClick}
      className={`
        relative flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors
        ${variant === 'desktop' ? 'p-3' : 'px-2 py-2 min-w-[56px]'}
        ${isActive 
          ? 'text-primary' 
          : 'text-warm-400 dark:text-warm-500 hover:text-warm-600 dark:hover:text-warm-300'
        }
      `}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {/* Active indicator with spring animation */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            layoutId={variant === 'desktop' ? 'activeTabDesktop' : 'activeTabMobile'}
            className="absolute inset-0 bg-primary/10 dark:bg-primary/20 rounded-xl"
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
