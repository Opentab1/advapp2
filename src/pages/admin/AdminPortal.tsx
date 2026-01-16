import { useState } from 'react';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { AdminSidebar } from '../../components/admin/AdminSidebar';
import { AdminDashboard } from './AdminDashboard';
import { VenuesManagement } from './VenuesManagement';
import { UsersManagement } from './UsersManagement';
import { TeamManagement } from './TeamManagement';
import { DevicesManagement } from './DevicesManagement';
import { DataAccuracy } from './DataAccuracy';
import { DataValidator } from './DataValidator';
import { AuditLog } from './AuditLog';
import { SystemAnalytics } from './SystemAnalytics';
import { AdminSettings } from './AdminSettings';
import authService from '../../services/auth.service';

export function AdminPortal() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const handleLogout = async () => {
    await authService.logout();
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <AnimatedBackground />

      {/* Admin Top Bar */}
      <div className="relative z-10 glass-card border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <span className="text-white font-bold text-xl">🛡️</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Pulse Admin Portal</h1>
              <p className="text-xs text-gray-400">Advizia Internal</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse"></span>
              <span className="text-xs text-red-400 font-medium">ADMIN MODE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 relative z-10">
        <AdminSidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab}
          onLogout={handleLogout}
        />

        <div className="flex-1 overflow-auto">
          {activeTab === 'dashboard' && <AdminDashboard />}
          {activeTab === 'venues' && <VenuesManagement />}
          {activeTab === 'users' && <UsersManagement />}
          {activeTab === 'team' && <TeamManagement />}
          {activeTab === 'devices' && <DevicesManagement />}
          {activeTab === 'data-health' && <DataAccuracy />}
          {activeTab === 'data-validator' && <DataValidator />}
          {activeTab === 'audit' && <AuditLog />}
          {activeTab === 'analytics' && <SystemAnalytics />}
          {activeTab === 'settings' && <AdminSettings />}
        </div>
      </div>
    </div>
  );
}
