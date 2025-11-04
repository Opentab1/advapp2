import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Error404 } from './pages/Error404';
import { Offline } from './pages/Offline';
import { configureAmplify } from './config/amplify';
import { LoadingSpinner } from './components/LoadingSpinner';
import authService from './services/auth.service';
import type { User } from './types';

// Configure AWS Amplify
configureAmplify();

function App() {
  const [user, setUser] = useState<User | null>(authService.getStoredUser());
  const [authLoading, setAuthLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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

  const loadCurrentUser = useCallback(async () => {
    try {
      const currentUser = await authService.getCurrentAuthenticatedUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  const handleLoginSuccess = useCallback(async () => {
    setAuthLoading(true);
    await loadCurrentUser();
  }, [loadCurrentUser]);

  const handleLogout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setAuthLoading(false);
    }
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
              authLoading ? (
                <LoadingSpinner fullScreen />
              ) : user ? (
                <Navigate to="/" replace />
              ) : (
                <Login onLoginSuccess={handleLoginSuccess} />
              )
          }
        />
        
        <Route
          path="/"
            element={
              authLoading ? (
                <LoadingSpinner fullScreen />
              ) : user ? (
                <Dashboard user={user} onLogout={handleLogout} />
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
