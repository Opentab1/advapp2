import { motion } from 'framer-motion';
import { 
  Gauge, 
  Zap,
  Music, 
  FileText, 
  Settings,
  LucideIcon 
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { id: 'pulse-plus', label: 'Pulse+', icon: Zap },
  { id: 'live', label: 'At a Glance', icon: Gauge },
  { id: 'songs', label: 'Songs', icon: Music },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <>
      {/* Desktop Sidebar */}
      <motion.aside
        className="hidden lg:flex flex-col w-20 glass-card border-r border-white/10 py-6"
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <nav className="flex flex-col gap-2 px-3">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              isActive={activeTab === item.id}
              onClick={() => onTabChange(item.id)}
            />
          ))}
        </nav>
      </motion.aside>

      {/* Mobile Bottom Navigation */}
      <motion.nav
        className="lg:hidden fixed bottom-0 left-0 right-0 glass-card border-t border-white/10 px-4 py-3 z-50"
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="flex justify-around items-center">
          {navItems.map((item) => (
            <MobileNavButton
              key={item.id}
              item={item}
              isActive={activeTab === item.id}
              onClick={() => onTabChange(item.id)}
            />
          ))}
        </div>
      </motion.nav>
    </>
  );
}

function NavButton({ item, isActive, onClick }: { 
  item: NavItem; 
  isActive: boolean; 
  onClick: () => void 
}) {
  const Icon = item.icon;

  return (
    <motion.button
      onClick={onClick}
      className={`
        relative flex flex-col items-center gap-1 p-3 rounded-xl transition-all
        ${isActive 
          ? 'text-cyan' 
          : 'text-gray-400 hover:text-white hover:bg-white/5'
        }
      `}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      {isActive && (
        <motion.div
          className="absolute inset-0 bg-cyan/10 border border-cyan/30 rounded-xl"
          layoutId="activeTab"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}
      
      <Icon className="w-6 h-6 relative z-10" />
      <span className="text-[10px] font-medium relative z-10">{item.label}</span>
    </motion.button>
  );
}

function MobileNavButton({ item, isActive, onClick }: { 
  item: NavItem; 
  isActive: boolean; 
  onClick: () => void 
}) {
  const Icon = item.icon;

  return (
    <motion.button
      onClick={onClick}
      className={`
        relative flex flex-col items-center gap-1 px-4 py-2 rounded-lg
        ${isActive ? 'text-cyan' : 'text-gray-400'}
      `}
      whileTap={{ scale: 0.9 }}
    >
      {isActive && (
        <motion.div
          className="absolute inset-0 bg-cyan/10 rounded-lg"
          layoutId="mobileActiveTab"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}
      
      <Icon className={`w-6 h-6 relative z-10 ${isActive ? 'cyan-glow' : ''}`} />
      <span className="text-xs font-medium relative z-10">{item.label}</span>
    </motion.button>
  );
}
