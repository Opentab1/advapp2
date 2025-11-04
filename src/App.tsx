import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Error404 } from './pages/Error404';
import { Offline } from './pages/Offline';
import { configureAmplify, VENUE_CONFIG } from './config/amplify';
import authService from './services/auth.service';
import locationService from './services/location.service';

// Configure AWS Amplify
configureAmplify();

function App() {
  // MQTT-ONLY MODE: No authentication required for direct IoT access
  const [isAuthenticated] = useState(true); // Always authenticated for direct IoT mode
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Set up default user for MQTT-ONLY mode
  useEffect(() => {
    const storedUser = authService.getStoredUser();
    if (!storedUser) {
      // Create a default user with venue config
      const defaultUser = {
        id: 'mqtt-user',
        email: 'mqtt@local',
        venueId: VENUE_CONFIG.venueId,
        venueName: VENUE_CONFIG.venueName,
        locations: [{
          id: VENUE_CONFIG.locationId,
          name: VENUE_CONFIG.locationName
        }]
      };
      localStorage.setItem('pulse_user', JSON.stringify(defaultUser));
      
      // Set initial location
      if (!locationService.getCurrentLocationId()) {
        locationService.setCurrentLocationId(VENUE_CONFIG.locationId);
      }
    }
  }, []);

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
              <Login onLoginSuccess={() => {}} />
            )
          }
        />
        
        <Route
          path="/"
          element={<Dashboard />}
        />
        
        <Route path="*" element={<Error404 />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
