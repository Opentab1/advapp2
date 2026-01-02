/**
 * DashboardLayout - Main app shell
 * 
 * Provides:
 * - Header with venue name and mini score
 * - Tab navigation (bottom on mobile, side on desktop)
 * - Content area with proper padding for nav
 * - Smooth page transitions
 * - Matte black theme
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
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onLogout: () => void;
}

export function DashboardLayout({
  children,
  venueName,
  isConnected = true,
  pulseScore,
  activeTab,
  onTabChange,
  onLogout,
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-warm-900 flex flex-col">
      {/* Header with mini score */}
      <Header 
        venueName={venueName} 
        isConnected={isConnected}
        pulseScore={pulseScore}
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
