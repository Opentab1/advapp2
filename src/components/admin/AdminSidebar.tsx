import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Building2,
  Users,
  BarChart3,
  Settings,
  LogOut,
  LucideIcon,
  Mail,
  Target,
  Camera,
  Activity,
  Bell,
  Sliders,
  ClipboardList,
  Sparkles,
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
  { id: 'dashboard',       label: 'Dashboard',        icon: LayoutDashboard },
  { id: 'onboard',         label: 'Onboard Venue',    icon: Sparkles },
  { id: 'ops',             label: 'Ops Monitor',      icon: Activity },
  { id: 'alerts',          label: 'Alerts Inbox',     icon: Bell },
  { id: 'review-queue',    label: 'Review Queue',     icon: ClipboardList },
  { id: 'accuracy',        label: 'Accuracy SLA',     icon: Target },
  { id: 'venues',          label: 'Venues',           icon: Building2 },
  { id: 'cameras',         label: 'Cameras',          icon: Camera },
  { id: 'calibration',    label: 'Bar Calibration',  icon: Sliders },
  { id: 'crm',             label: 'Sales CRM',        icon: Target },
  { id: 'users',           label: 'Users',            icon: Users },
  { id: 'analytics',       label: 'Analytics',        icon: BarChart3 },
  { id: 'email-reporting', label: 'Email Reports',    icon: Mail },
  { id: 'settings',        label: 'Settings',         icon: Settings },
];

export function AdminSidebar({ activeTab, onTabChange, onLogout }: AdminSidebarProps) {
  return (
    <>
      {/* Desktop Sidebar */}
      <motion.aside
        className="hidden lg:flex flex-col w-60 glass-card border-r border-white/10 py-4 flex-shrink-0"
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-0.5 px-2 overflow-y-auto">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              isActive={activeTab === item.id}
              onClick={() => onTabChange(item.id)}
            />
          ))}
        </nav>

        {/* Logout */}
        <div className="px-2 mt-4 border-t border-white/5 pt-4">
          <motion.button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-all text-sm"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <LogOut className="w-4 h-4" />
            <span className="font-medium">Logout</span>
          </motion.button>
        </div>
      </motion.aside>

      {/* Mobile Bottom Navigation (first 5 items) */}
      <motion.nav
        className="lg:hidden fixed bottom-0 left-0 right-0 glass-card border-t border-white/10 px-2 py-2 z-50"
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="flex justify-around items-center">
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

function NavButton({
  item,
  isActive,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <motion.button
      onClick={onClick}
      className={`
        relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all text-sm
        ${isActive
          ? 'text-white bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30'
          : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'}
      `}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="font-medium truncate">{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span className="ml-auto px-1.5 py-0.5 rounded-full bg-amber-500 text-black text-[10px] font-bold">
          {item.badge}
        </span>
      )}
    </motion.button>
  );
}

function MobileNavButton({
  item,
  isActive,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <motion.button
      onClick={onClick}
      className={`
        relative flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg
        ${isActive ? 'text-white' : 'text-gray-400'}
      `}
      whileTap={{ scale: 0.9 }}
    >
      {isActive && (
        <motion.div
          className="absolute inset-0 bg-amber-500/10 rounded-lg border border-amber-500/30"
          layoutId="mobileAdminActiveTab"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}
      <Icon className="w-5 h-5 relative z-10" />
      <span className="text-[10px] font-medium relative z-10 truncate max-w-[52px]">{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black text-[9px] font-bold flex items-center justify-center z-20">
          {item.badge}
        </span>
      )}
    </motion.button>
  );
}
