import { useState } from 'react';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { AlertTriangle, Terminal, ArrowRight } from 'lucide-react';
import { AdminSidebar } from '../../components/admin/AdminSidebar';
import { VenueSelector } from '../../components/admin/VenueSelector';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { AdminVenueProvider } from '../../contexts/AdminVenueContext';
import { AdminDashboard } from './AdminDashboard';
import { VenuesManagement } from './VenuesManagement';
import { UsersManagement } from './UsersManagement';
import { SystemAnalytics } from './SystemAnalytics';
import { AdminSettings } from './AdminSettings';
import { EmailReporting } from './EmailReporting';
import { SalesCRM } from './SalesCRM';
import { CamerasManagement } from './CamerasManagement';
import { BarCalibration } from './BarCalibration';
import { OpsMonitor } from './OpsMonitor';
import { AlertsInbox } from './AlertsInbox';
import { ReviewQueue } from './ReviewQueue';
import { AccuracySLA } from './AccuracySLA';
import { OnboardVenue } from './OnboardVenue';
import { WorkerTester } from './WorkerTester';
import authService from '../../services/auth.service';

const ADMIN_API_CONFIGURED = !!(import.meta.env.VITE_ADMIN_API_URL ?? '').trim();

function SetupBanner() {
  return (
    <div className="m-6 p-5 rounded-xl border border-amber-500/40 bg-amber-500/8">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-300 font-semibold text-sm mb-1">Admin API not connected</p>
          <p className="text-gray-400 text-xs mb-3">
            <code className="text-amber-400">VITE_ADMIN_API_URL</code> is not set. All data will show as empty until you deploy the Lambda backend.
          </p>
          <div className="space-y-2 text-xs text-gray-400">
            <div className="flex items-start gap-2">
              <Terminal className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
              <span>
                1. Run <code className="text-green-400 bg-black/30 px-1 rounded">./deploy_admin_lambda.sh</code> in AWS CloudShell (us-east-2)
              </span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
              <span>2. Copy the <code className="text-amber-400">VITE_ADMIN_API_URL</code> it prints</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mt-0.5" />
              <span>3. Add it to Amplify → App Settings → Environment Variables, then redeploy</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminPortalInner() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const handleLogout = async () => {
    await authService.logout();
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <AnimatedBackground />

      {/* Admin Top Bar */}
      <div className="relative z-10 glass-card border-b border-white/10 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
              <span className="text-black font-bold text-base">VS</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight">VenueScope Admin</h1>
              <p className="text-xs text-gray-500 leading-tight">Operations Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Venue selector lives here for all pages */}
            <VenueSelector />

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs text-amber-400 font-medium">ADMIN</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 relative z-10 overflow-hidden">
        <AdminSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onLogout={handleLogout}
        />

        <div className="flex-1 overflow-auto">
          {!ADMIN_API_CONFIGURED && <SetupBanner />}
          {activeTab === 'dashboard'       && <ErrorBoundary key="dashboard"><AdminDashboard /></ErrorBoundary>}
          {activeTab === 'ops'             && <ErrorBoundary key="ops"><OpsMonitor /></ErrorBoundary>}
          {activeTab === 'venues'          && <ErrorBoundary key="venues"><VenuesManagement /></ErrorBoundary>}
          {activeTab === 'cameras'         && <ErrorBoundary key="cameras"><CamerasManagement /></ErrorBoundary>}
          {activeTab === 'calibration'    && <ErrorBoundary key="calibration"><BarCalibration /></ErrorBoundary>}
          {activeTab === 'worker-tester'   && <ErrorBoundary key="worker-tester"><WorkerTester /></ErrorBoundary>}
          {activeTab === 'alerts'          && <ErrorBoundary key="alerts"><AlertsInbox /></ErrorBoundary>}
          {activeTab === 'review-queue'    && <ErrorBoundary key="review-queue"><ReviewQueue /></ErrorBoundary>}
          {activeTab === 'accuracy'        && <ErrorBoundary key="accuracy"><AccuracySLA /></ErrorBoundary>}
          {activeTab === 'onboard'         && <ErrorBoundary key="onboard"><OnboardVenue /></ErrorBoundary>}
          {activeTab === 'users'           && <ErrorBoundary key="users"><UsersManagement /></ErrorBoundary>}
          {activeTab === 'analytics'       && <ErrorBoundary key="analytics"><SystemAnalytics /></ErrorBoundary>}
          {activeTab === 'email-reporting' && <ErrorBoundary key="email-reporting"><EmailReporting /></ErrorBoundary>}
          {activeTab === 'settings'        && <ErrorBoundary key="settings"><AdminSettings /></ErrorBoundary>}
          {activeTab === 'crm'             && <ErrorBoundary key="crm"><SalesCRM /></ErrorBoundary>}
        </div>
      </div>
    </div>
  );
}

export function AdminPortal() {
  return (
    <AdminVenueProvider>
      <AdminPortalInner />
    </AdminVenueProvider>
  );
}
