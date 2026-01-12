/**
 * VenueHealthDashboard - At-a-glance view of venue health status
 * 
 * Shows which venues are healthy, warning, or critical
 * Allows quick action on problem venues
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Wifi,
  WifiOff,
  Clock,
  ChevronRight,
  Phone,
  Mail,
  RefreshCw,
  Activity,
  ThermometerSun,
  Eye
} from 'lucide-react';
import type { AdminVenue, AdminDevice } from '../../services/admin.service';

interface VenueHealthDashboardProps {
  venues: AdminVenue[];
  devices: AdminDevice[];
  loading: boolean;
  onViewVenue?: (venueId: string) => void;
  onTroubleshoot?: (venueId: string) => void;
}

interface VenueHealth {
  venue: AdminVenue;
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  deviceStatus: 'online' | 'offline' | 'no_device';
  lastDataAge: string;
  onboardingComplete: boolean;
}

export function VenueHealthDashboard({ 
  venues, 
  devices, 
  loading,
  onViewVenue,
  onTroubleshoot 
}: VenueHealthDashboardProps) {
  const [expandedStatus, setExpandedStatus] = useState<'healthy' | 'warning' | 'critical' | null>('critical');
  const [showAllVenues, setShowAllVenues] = useState(false);

  // Calculate health for each venue
  const venueHealthList = useMemo(() => {
    return venues.map(venue => {
      const venueDevices = devices.filter(d => d.venueId === venue.venueId);
      const issues: string[] = [];
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';

      // Check device status
      const hasDevice = venueDevices.length > 0;
      const onlineDevices = venueDevices.filter(d => d.status === 'online');
      const offlineDevices = venueDevices.filter(d => d.status === 'offline');
      
      let deviceStatus: 'online' | 'offline' | 'no_device' = 'no_device';
      if (hasDevice) {
        deviceStatus = onlineDevices.length > 0 ? 'online' : 'offline';
      }

      // Check for issues
      if (!hasDevice) {
        issues.push('No device provisioned');
        status = 'warning';
      } else if (offlineDevices.length > 0) {
        if (onlineDevices.length === 0) {
          issues.push(`All devices offline (${offlineDevices.length})`);
          status = 'critical';
        } else {
          issues.push(`${offlineDevices.length} device(s) offline`);
          status = 'warning';
        }
      }

      // Check last data timestamp
      if (venue.lastDataTimestamp) {
        const lastData = new Date(venue.lastDataTimestamp);
        const hoursSince = (Date.now() - lastData.getTime()) / (1000 * 60 * 60);
        
        if (hoursSince > 24) {
          issues.push(`No data for ${Math.floor(hoursSince)} hours`);
          if (status !== 'critical') status = 'critical';
        } else if (hoursSince > 4) {
          issues.push(`Last data ${Math.floor(hoursSince)} hours ago`);
          if (status === 'healthy') status = 'warning';
        }
      } else if (hasDevice) {
        issues.push('Never received data');
        status = 'warning';
      }

      // Check venue status
      if (venue.status === 'suspended') {
        issues.push('Venue suspended');
        status = 'warning';
      }

      // Calculate last data age string
      let lastDataAge = 'Never';
      if (venue.lastDataTimestamp) {
        const lastData = new Date(venue.lastDataTimestamp);
        const minutesSince = (Date.now() - lastData.getTime()) / (1000 * 60);
        if (minutesSince < 5) {
          lastDataAge = 'Just now';
        } else if (minutesSince < 60) {
          lastDataAge = `${Math.floor(minutesSince)}m ago`;
        } else if (minutesSince < 1440) {
          lastDataAge = `${Math.floor(minutesSince / 60)}h ago`;
        } else {
          lastDataAge = `${Math.floor(minutesSince / 1440)}d ago`;
        }
      }

      // Check onboarding completion
      const onboardingComplete = hasDevice && deviceStatus === 'online' && venue.lastDataTimestamp !== undefined;

      return {
        venue,
        status,
        issues,
        deviceStatus,
        lastDataAge,
        onboardingComplete
      } as VenueHealth;
    });
  }, [venues, devices]);

  // Group by status
  const healthyVenues = venueHealthList.filter(v => v.status === 'healthy');
  const warningVenues = venueHealthList.filter(v => v.status === 'warning');
  const criticalVenues = venueHealthList.filter(v => v.status === 'critical');

  const getStatusColor = (status: 'healthy' | 'warning' | 'critical') => {
    switch (status) {
      case 'healthy': return 'text-green-400 bg-green-500/20 border-green-500/30';
      case 'warning': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
      case 'critical': return 'text-red-400 bg-red-500/20 border-red-500/30';
    }
  };

  const getStatusIcon = (status: 'healthy' | 'warning' | 'critical') => {
    switch (status) {
      case 'healthy': return CheckCircle;
      case 'warning': return AlertTriangle;
      case 'critical': return XCircle;
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-6 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-48 mb-4" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-20 bg-gray-700 rounded" />
          <div className="h-20 bg-gray-700 rounded" />
          <div className="h-20 bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <motion.button
          onClick={() => setExpandedStatus(expandedStatus === 'healthy' ? null : 'healthy')}
          className={`glass-card p-4 text-left transition-all ${
            expandedStatus === 'healthy' ? 'ring-2 ring-green-500/50' : ''
          }`}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-green-400">{healthyVenues.length}</span>
          </div>
          <div className="text-sm text-gray-400">Healthy</div>
        </motion.button>

        <motion.button
          onClick={() => setExpandedStatus(expandedStatus === 'warning' ? null : 'warning')}
          className={`glass-card p-4 text-left transition-all ${
            expandedStatus === 'warning' ? 'ring-2 ring-yellow-500/50' : ''
          }`}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-yellow-400">{warningVenues.length}</span>
          </div>
          <div className="text-sm text-gray-400">Warning</div>
        </motion.button>

        <motion.button
          onClick={() => setExpandedStatus(expandedStatus === 'critical' ? null : 'critical')}
          className={`glass-card p-4 text-left transition-all ${
            expandedStatus === 'critical' ? 'ring-2 ring-red-500/50' : ''
          }`}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-red-400">{criticalVenues.length}</span>
          </div>
          <div className="text-sm text-gray-400">Critical</div>
        </motion.button>
      </div>

      {/* Expanded List */}
      <AnimatePresence>
        {expandedStatus && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            {(expandedStatus === 'critical' ? criticalVenues :
              expandedStatus === 'warning' ? warningVenues :
              healthyVenues
            ).slice(0, showAllVenues ? undefined : 5).map((item) => {
              const StatusIcon = getStatusIcon(item.status);
              return (
                <motion.div
                  key={item.venue.venueId}
                  className={`glass-card p-4 border ${getStatusColor(item.status)}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <StatusIcon className={`w-5 h-5 mt-0.5 ${
                        item.status === 'healthy' ? 'text-green-400' :
                        item.status === 'warning' ? 'text-yellow-400' :
                        'text-red-400'
                      }`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-white">{item.venue.venueName}</h4>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            item.deviceStatus === 'online' ? 'bg-green-500/20 text-green-400' :
                            item.deviceStatus === 'offline' ? 'bg-red-500/20 text-red-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {item.deviceStatus === 'online' ? (
                              <><Wifi className="w-3 h-3 inline mr-1" />Online</>
                            ) : item.deviceStatus === 'offline' ? (
                              <><WifiOff className="w-3 h-3 inline mr-1" />Offline</>
                            ) : (
                              'No Device'
                            )}
                          </span>
                        </div>
                        
                        {/* Issues */}
                        {item.issues.length > 0 && (
                          <ul className="text-sm text-gray-400 mb-2">
                            {item.issues.map((issue, i) => (
                              <li key={i} className="flex items-center gap-1">
                                <span className="w-1 h-1 rounded-full bg-current" />
                                {issue}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Meta info */}
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Last data: {item.lastDataAge}
                          </span>
                          <span className="flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            {item.venue.deviceCount || 0} devices
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {item.status !== 'healthy' && (
                        <button 
                          onClick={() => onTroubleshoot?.(item.venue.venueId)}
                          className="btn-primary text-xs px-3 py-1"
                        >
                          Troubleshoot
                        </button>
                      )}
                      <button 
                        onClick={() => onViewVenue?.(item.venue.venueId)}
                        className="btn-secondary text-xs px-3 py-1"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {/* Show More */}
            {((expandedStatus === 'critical' && criticalVenues.length > 5) ||
              (expandedStatus === 'warning' && warningVenues.length > 5) ||
              (expandedStatus === 'healthy' && healthyVenues.length > 5)) && !showAllVenues && (
              <button
                onClick={() => setShowAllVenues(true)}
                className="w-full text-center text-sm text-purple-400 hover:text-purple-300 py-2"
              >
                Show all {
                  expandedStatus === 'critical' ? criticalVenues.length :
                  expandedStatus === 'warning' ? warningVenues.length :
                  healthyVenues.length
                } venues
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* All Healthy Message */}
      {criticalVenues.length === 0 && warningVenues.length === 0 && venues.length > 0 && (
        <motion.div
          className="glass-card p-6 text-center border border-green-500/30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
          <h3 className="text-lg font-bold text-green-400 mb-1">All Systems Healthy</h3>
          <p className="text-sm text-gray-400">All {venues.length} venues are operating normally</p>
        </motion.div>
      )}
    </div>
  );
}

export default VenueHealthDashboard;
