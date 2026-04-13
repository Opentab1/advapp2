import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import adminService, { AdminVenue } from '../services/admin.service';

interface AdminVenueContextValue {
  venues: AdminVenue[];
  selectedVenueId: string | null;
  setSelectedVenueId: (id: string | null) => void;
  selectedVenue: AdminVenue | null;
  loadingVenues: boolean;
  refreshVenues: () => Promise<void>;
}

const AdminVenueContext = createContext<AdminVenueContextValue | null>(null);

const LS_KEY = 'adminSelectedVenue';

export function AdminVenueProvider({ children }: { children: ReactNode }) {
  const [venues, setVenues] = useState<AdminVenue[]>([]);
  const [loadingVenues, setLoadingVenues] = useState(true);
  const [selectedVenueId, setSelectedVenueIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY) ?? null;
    } catch {
      return null;
    }
  });

  const setSelectedVenueId = (id: string | null) => {
    setSelectedVenueIdState(id);
    try {
      if (id === null) {
        localStorage.removeItem(LS_KEY);
      } else {
        localStorage.setItem(LS_KEY, id);
      }
    } catch { /* */ }
  };

  const refreshVenues = async () => {
    setLoadingVenues(true);
    try {
      const data = await adminService.listVenues();
      setVenues(data);
      // Clear stale selection if venue no longer exists
      if (selectedVenueId && !data.find(v => v.venueId === selectedVenueId)) {
        setSelectedVenueId(null);
      }
    } catch (err) {
      console.warn('AdminVenueContext: failed to load venues', err);
    } finally {
      setLoadingVenues(false);
    }
  };

  useEffect(() => {
    refreshVenues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedVenue = selectedVenueId
    ? (venues.find(v => v.venueId === selectedVenueId) ?? null)
    : null;

  return (
    <AdminVenueContext.Provider
      value={{ venues, selectedVenueId, setSelectedVenueId, selectedVenue, loadingVenues, refreshVenues }}
    >
      {children}
    </AdminVenueContext.Provider>
  );
}

export function useAdminVenue(): AdminVenueContextValue {
  const ctx = useContext(AdminVenueContext);
  if (!ctx) throw new Error('useAdminVenue must be used inside AdminVenueProvider');
  return ctx;
}
