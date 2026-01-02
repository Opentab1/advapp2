/**
 * DashboardLayout - Main app shell with dark mode support
 * 
 * Provides:
 * - Header with venue name, mini score, and dark mode toggle
 * - Tab navigation (bottom on mobile, side on desktop)
 * - Content area with proper padding for nav
 * - Smooth page transitions
 */

import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '../components/common/Header';
import { TabNav, TabId } from '../components/common/TabNav';

interface DashboardLayoutProps {
  children: ReactNode;
  venueName: string;
  isConnected?: boolean;
  pulseScore?: number | null;
  isDark?: boolean;
  onToggleDark?: () => void;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onLogout: () => void;
}

export function DashboardLayout({
  children,
  venueName,
  isConnected = true,
  pulseScore,
  isDark = false,
  onToggleDark,
  activeTab,
  onTabChange,
  onLogout,
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-warm-50 dark:bg-warm-900 flex flex-col transition-colors">
      {/* Header with mini score and dark mode */}
      <Header 
        venueName={venueName} 
        isConnected={isConnected}
        pulseScore={pulseScore}
        isDark={isDark}
        onToggleDark={onToggleDark}
        onLogout={onLogout}
      />
      
      {/* Main content area */}
      <div className="flex flex-1">
        {/* Desktop sidebar nav */}
        <TabNav activeTab={activeTab} onTabChange={onTabChange} />
        
        {/* Content with smooth transitions */}
        <main className="flex-1 overflow-auto pb-20 lg:pb-6">
          <div className="max-w-2xl mx-auto px-4 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      
      {/* Mobile bottom nav is rendered inside TabNav */}
    </div>
  );
}

export default DashboardLayout;
