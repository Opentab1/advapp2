import { motion } from 'framer-motion';
import { 
  LayoutDashboard,
  Building2,
  Users,
  UserCog,
  Wifi,
  ScrollText,
  BarChart3,
  Settings,
  LogOut,
  LucideIcon,
  ShieldCheck,
  Search
} from 'lucide-react';

interface AdminSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLogout: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'venues', label: 'Venues', icon: Building2 },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'team', label: 'Team', icon: UserCog },
  { id: 'devices', label: 'Devices', icon: Wifi },
  { id: 'data-health', label: 'Data Health', icon: ShieldCheck },
  { id: 'data-validator', label: 'Accuracy Check', icon: Search },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings }
];

export function AdminSidebar({ activeTab, onTabChange, onLogout }: AdminSidebarProps) {
  return (
    <>
      {/* Desktop Sidebar */}
      <motion.aside
        className="hidden lg:flex flex-col w-64 glass-card border-r border-white/10 py-6"
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {/* Branding */}
        <div className="px-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <span className="text-white font-bold text-lg">🛡️</span>
            </div>
            <div>
              <div className="text-white font-bold text-lg">Admin Portal</div>
              <div className="text-gray-400 text-xs">Advizia</div>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-red-500/50 to-orange-500/50 mt-4"></div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col gap-1 px-3">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              isActive={activeTab === item.id}
              onClick={() => onTabChange(item.id)}
            />
          ))}
        </nav>

        {/* Logout Button */}
        <div className="px-3 mt-6">
          <motion.button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-500/10 transition-all"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Logout</span>
          </motion.button>
        </div>
      </motion.aside>

      {/* Mobile Bottom Navigation */}
      <motion.nav
        className="lg:hidden fixed bottom-0 left-0 right-0 glass-card border-t border-white/10 px-2 py-3 z-50"
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="flex justify-around items-center overflow-x-auto">
          {navItems.slice(0, 5).map((item) => (
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
        relative flex items-center gap-3 px-4 py-3 rounded-lg transition-all
        ${isActive 
          ? 'text-white bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/30' 
          : 'text-gray-400 hover:text-white hover:bg-white/5'
        }
      `}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Icon className="w-5 h-5" />
      <span className="font-medium">{item.label}</span>
      {item.badge && (
        <span className="ml-auto px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold">
          {item.badge}
        </span>
      )}
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
        relative flex flex-col items-center gap-1 px-3 py-2 rounded-lg
        ${isActive ? 'text-white' : 'text-gray-400'}
      `}
      whileTap={{ scale: 0.9 }}
    >
      {isActive && (
        <motion.div
          className="absolute inset-0 bg-red-500/10 rounded-lg border border-red-500/30"
          layoutId="mobileAdminActiveTab"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}
      
      <Icon className="w-5 h-5 relative z-10" />
      <span className="text-xs font-medium relative z-10">{item.label}</span>
      {item.badge && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center z-20">
          {item.badge}
        </span>
      )}
    </motion.button>
  );
}
