import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { AdminPortal } from './pages/admin/AdminPortal';
import { Error404 } from './pages/Error404';
import { Offline } from './pages/Offline';
import authService from './services/auth.service';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => authService.isAuthenticated());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Check if user is admin (has role but no venueId)
  const isAdmin = () => {
    const user = authService.getCurrentUser();
    const role = user?.attributes?.['custom:role'];
    const venueId = user?.attributes?.['custom:venueId'];
    return role && !venueId;
  };

  useEffect(() => {
    // Handle online/offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    // Update user role when authentication changes
    if (isAuthenticated) {
      const user = authService.getCurrentUser();
      setUserRole(user?.attributes?.['custom:role'] || null);
    } else {
      setUserRole(null);
    }
  }, [isAuthenticated]);

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
                <Dashboard />
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
                <AdminPortal />
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
