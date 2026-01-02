/**
 * DashboardLayout - Main app shell
 * 
 * Provides:
 * - Header with venue name
 * - Tab navigation (bottom on mobile, side on desktop)
 * - Content area with proper padding for nav
 */

import { ReactNode } from 'react';
import { Header } from '../components/common/Header';
import { TabNav, TabId } from '../components/common/TabNav';

interface DashboardLayoutProps {
  children: ReactNode;
  venueName: string;
  isConnected?: boolean;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onLogout: () => void;
}

export function DashboardLayout({
  children,
  venueName,
  isConnected = true,
  activeTab,
  onTabChange,
  onLogout,
}: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-warm-50 flex flex-col">
      {/* Header */}
      <Header 
        venueName={venueName} 
        isConnected={isConnected}
        onLogout={onLogout}
      />
      
      {/* Main content area */}
      <div className="flex flex-1">
        {/* Desktop sidebar nav */}
        <TabNav activeTab={activeTab} onTabChange={onTabChange} />
        
        {/* Content */}
        <main className="flex-1 overflow-auto pb-20 lg:pb-6">
          <div className="max-w-2xl mx-auto px-4 py-6">
            {children}
          </div>
        </main>
      </div>
      
      {/* Mobile bottom nav is rendered inside TabNav */}
    </div>
  );
}

export default DashboardLayout;
