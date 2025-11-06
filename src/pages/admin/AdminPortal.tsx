import { useState } from 'react';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { AdminSidebar } from '../../components/admin/AdminSidebar';
import { AdminDashboard } from './AdminDashboard';
import { VenuesManagement } from './VenuesManagement';
import { UsersManagement } from './UsersManagement';
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
          {activeTab === 'team' && (
            <div className="min-h-screen p-8 flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-bold gradient-text mb-2">Team Management</h2>
                <p className="text-gray-400">Coming in next phase...</p>
              </div>
            </div>
          )}
          {activeTab === 'devices' && (
            <div className="min-h-screen p-8 flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-bold gradient-text mb-2">Device Management</h2>
                <p className="text-gray-400">Coming in next phase...</p>
              </div>
            </div>
          )}
          {activeTab === 'audit' && (
            <div className="min-h-screen p-8 flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-bold gradient-text mb-2">Audit Log</h2>
                <p className="text-gray-400">Coming in next phase...</p>
              </div>
            </div>
          )}
          {activeTab === 'analytics' && (
            <div className="min-h-screen p-8 flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-bold gradient-text mb-2">System Analytics</h2>
                <p className="text-gray-400">Coming in next phase...</p>
              </div>
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="min-h-screen p-8 flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-bold gradient-text mb-2">Admin Settings</h2>
                <p className="text-gray-400">Coming in next phase...</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
