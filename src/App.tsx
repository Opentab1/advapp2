/**
 * App - Main application entry point
 * 
 * Handles:
 * - Authentication state
 * - Online/offline status
 * - Dark mode
 * - Routing between Login, Dashboard, and Admin
 * - Tab-based navigation within Dashboard
 */

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Pages
import { Login } from './pages/Login';
import { AdminPortal } from './pages/admin/AdminPortal';
import { Error404 } from './pages/Error404';
import { Offline } from './pages/Offline';
import { Live } from './pages/Live';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
// SongLog merged into Analytics
import { Staffing } from './pages/Staffing';
import { Leads } from './pages/Leads';
import Events from './pages/Events';

// Layout
import { DashboardLayout } from './layouts/DashboardLayout';
import type { TabId } from './components/common/TabNav';

// Components
import { ErrorBoundary } from './components/ErrorBoundary';

// Services & Hooks
import authService from './services/auth.service';
import { usePulseScore, useWeather, useDataConnection } from './stores/pulseStore';

// ============ PROTECTED DASHBOARD ============

function ProtectedDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('live');
  
  // Get shared pulse score, weather, and connection status for header display
  const pulseScore = usePulseScore();
  const weather = useWeather();
  const dataConnection = useDataConnection();
  
  // Set browser tab title
  useEffect(() => {
    document.title = 'Advizia Pulse';
  }, []);
  
  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch (e) {
      console.error('Logout error:', e);
    }
    // Force full page reload to clear all state
    window.location.replace('/login');
  };
  
  // Render active tab content with error boundary per tab
  const renderTabContent = () => {
    let content;
    switch (activeTab) {
      case 'live':
        content = <Live />;
        break;
      case 'analytics':
        content = <Analytics />;
        break;
      case 'events':
        content = <Events />;
        break;
      case 'staffing':
        content = <Staffing />;
        break;
      case 'leads':
        content = <Leads />;
        break;
      case 'settings':
        content = <Settings />;
        break;
      default:
        content = <Live />;
    }
    return <ErrorBoundary key={activeTab}>{content}</ErrorBoundary>;
  };
  
  return (
    <DashboardLayout
      venueName="Pulse"
      isConnected={dataConnection.isConnected}
      dataAgeSeconds={dataConnection.dataAgeSeconds}
      pulseScore={pulseScore}
      weather={weather}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onLogout={handleLogout}
    >
      {renderTabContent()}
    </DashboardLayout>
  );
}

// ============ MAIN APP ============

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => authService.isAuthenticated());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Check if user is admin (has role but no venueId)
  const isAdmin = () => {
    const user = authService.getStoredUser();
    const role = user?.role;
    const venueId = user?.venueId;
    return role && !venueId;
  };

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check authentication status on mount and when storage changes
  useEffect(() => {
    const checkAuth = () => {
      setIsAuthenticated(authService.isAuthenticated());
    };

    // Check immediately
    checkAuth();

    // Listen for storage changes (e.g., login/logout from another tab)
    window.addEventListener('storage', checkAuth);

    // Also check periodically (in case of same-tab login)
    const interval = setInterval(checkAuth, 1000);

    return () => {
      window.removeEventListener('storage', checkAuth);
      clearInterval(interval);
    };
  }, []);

  // Show offline page if not connected
  if (!isOnline) {
    return <Offline />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? (
              <Navigate to="/" replace />
            ) : (
              <Login onLoginSuccess={() => {
                // Ensure auth state is updated after login
                setTimeout(() => setIsAuthenticated(authService.isAuthenticated()), 100);
              }} />
            )
          }
        />
        
        <Route
          path="/"
          element={
            isAuthenticated ? (
              isAdmin() ? (
                <Navigate to="/admin" replace />
              ) : (
                <ErrorBoundary>
                  <ProtectedDashboard />
                </ErrorBoundary>
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/admin/*"
          element={
            isAuthenticated ? (
              isAdmin() ? (
                <ErrorBoundary>
                  <AdminPortal />
                </ErrorBoundary>
              ) : (
                <Navigate to="/" replace />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        
        <Route path="*" element={<Error404 />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
