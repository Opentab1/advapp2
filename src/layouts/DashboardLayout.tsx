/**
 * DashboardLayout - Main app shell
 * 
 * Provides:
 * - Minimal Header (Logo + Profile)
 * - Tab navigation (bottom on mobile, side on desktop)
 * - Content area with proper padding
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
  weather?: { temperature: number; icon: string } | null;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onLogout: () => void;
}

export function DashboardLayout({
  children,
  venueName, // kept for prop compatibility but unused in Header
  isConnected = true,
  pulseScore, // kept for prop compatibility but unused in Header
  weather, // kept for prop compatibility but unused in Header
  activeTab,
  onTabChange,
  onLogout,
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-warm-900 flex flex-col">
      {/* Minimal Header */}
      <Header 
        isConnected={isConnected}
        onLogout={onLogout}
      />
      
      {/* Main content area */}
      <div className="flex flex-1">
        {/* Desktop sidebar nav */}
        <TabNav activeTab={activeTab} onTabChange={onTabChange} />
        
        {/* Content with smooth transitions */}
        <main className="flex-1 overflow-auto pb-20 lg:pb-6">
          {/* Mobile: full width with padding, Desktop: centered with max-width */}
          <div className="w-full max-w-lg mx-auto px-4 py-6 lg:max-w-4xl lg:px-8 xl:max-w-5xl">
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
