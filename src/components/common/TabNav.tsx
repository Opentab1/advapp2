/**
 * TabNav - Bottom navigation for mobile + side nav for desktop
 * 
 * 4 tabs: Pulse, History, Songs, Settings
 * Mobile: Fixed bottom bar
 * Desktop: Left sidebar (optional, can stay bottom)
 */

import { motion } from 'framer-motion';
import { Zap, BarChart2, Music, Settings, LucideIcon } from 'lucide-react';

export type TabId = 'pulse' | 'history' | 'songs' | 'settings';

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { id: 'pulse', label: 'Pulse', icon: Zap },
  { id: 'history', label: 'History', icon: BarChart2 },
  { id: 'songs', label: 'Songs', icon: Music },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface TabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabNav({ activeTab, onTabChange }: TabNavProps) {
  return (
    <>
      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-warm-200 z-50 lg:hidden safe-bottom">
        <div className="flex justify-around items-center h-16 px-2">
          {TABS.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
            />
          ))}
        </div>
      </nav>

      {/* Desktop Side Navigation */}
      <aside className="hidden lg:flex flex-col w-20 bg-white border-r border-warm-200 py-6">
        <nav className="flex flex-col gap-2 px-3">
          {TABS.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              isActive={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
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
        relative flex flex-col items-center justify-center gap-1 rounded-xl transition-colors
        ${variant === 'desktop' ? 'p-3' : 'px-4 py-2 min-w-[64px]'}
        ${isActive 
          ? 'text-primary' 
          : 'text-warm-400 hover:text-warm-600'
        }
      `}
      whileTap={{ scale: 0.95 }}
    >
      {/* Active indicator */}
      {isActive && (
        <motion.div
          layoutId={variant === 'desktop' ? 'activeTabDesktop' : 'activeTabMobile'}
          className="absolute inset-0 bg-primary/10 rounded-xl"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}
      
      <Icon className="w-5 h-5 relative z-10" />
      <span className="text-[10px] font-medium relative z-10">{tab.label}</span>
    </motion.button>
  );
}

export default TabNav;
