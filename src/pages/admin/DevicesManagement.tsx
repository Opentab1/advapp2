/**
 * DevicesManagement - Admin device monitoring page
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Search, Activity, AlertTriangle, CheckCircle, WifiOff, Cpu,
  HardDrive, Zap, RefreshCw, FileText, Wifi
} from 'lucide-react';
import adminService, { AdminDevice } from '../../services/admin.service';

export function DevicesManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'offline' | 'error'>('all');
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setError] = useState<string | null>(null);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const deviceList = await adminService.listDevices();
      setDevices(deviceList);
    } catch (err: any) {
      setError(err.message || 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 30000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  const filteredDevices = devices.filter(device => {
    if (filterStatus !== 'all' && device.status !== filterStatus) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return device.deviceId.toLowerCase().includes(search) || device.venueName.toLowerCase().includes(search);
    }
    return true;
  });

  const stats = {
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    errors: devices.filter(d => d.status === 'error').length
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'online': return { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Online' };
      case 'offline': return { icon: WifiOff, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Offline' };
      case 'error': return { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Error' };
      default: return { icon: Wifi, color: 'text-gray-400', bg: 'bg-gray-500/20', label: 'Unknown' };
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">📡 Device Management</h1>
            <p className="text-gray-400">{loading ? 'Loading...' : `${devices.length} devices monitored`}</p>
          </div>
          <button onClick={fetchDevices} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="glass-card p-4">
            <div className="text-sm text-gray-400 mb-1">Total</div>
            <div className="text-2xl font-bold text-white">{loading ? '—' : stats.total}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-sm text-gray-400 mb-1">Online</div>
            <div className="text-2xl font-bold text-green-400">{loading ? '—' : stats.online}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-sm text-gray-400 mb-1">Offline</div>
            <div className="text-2xl font-bold text-red-400">{loading ? '—' : stats.offline}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-sm text-gray-400 mb-1">Errors</div>
            <div className="text-2xl font-bold text-yellow-400">{loading ? '—' : stats.errors}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input type="text" placeholder="Search devices..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white" />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)} className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white">
            <option value="all">All</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="error">Error</option>
          </select>
        </div>

        {loading && <div className="flex justify-center py-12"><RefreshCw className="w-8 h-8 text-green-400 animate-spin" /></div>}

        {!loading && devices.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Wifi className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold text-white mb-2">No Devices Found</h3>
            <p className="text-gray-400 mb-4">Devices will appear once listAllDevices resolver is deployed</p>
          </div>
        )}

        {!loading && filteredDevices.length > 0 && (
          <div className="space-y-4">
            {filteredDevices.map((device, idx) => {
              const s = getStatusDisplay(device.status);
              const Icon = s.icon;
              return (
                <motion.div key={device.deviceId} className={`glass-card p-6 ${device.status === 'offline' ? 'border-red-500/30' : ''}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-bold text-white font-mono">{device.deviceId}</h3>
                    <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${s.bg} ${s.color}`}><Icon className="w-3 h-3" />{s.label}</span>
                  </div>
                  <div className="text-sm text-gray-400 mb-4">{device.venueName} — {device.locationName}</div>
                  <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
                    <div><Activity className="w-4 h-4 text-cyan-400 inline mr-1" /><span className="text-white">{device.uptime || '—'}</span></div>
                    <div><Cpu className="w-4 h-4 text-yellow-400 inline mr-1" /><span className="text-white">{device.cpuTemp ? `${device.cpuTemp}°C` : '—'}</span></div>
                    <div><HardDrive className="w-4 h-4 text-purple-400 inline mr-1" /><span className="text-white">{device.diskUsage ? `${device.diskUsage}%` : '—'}</span></div>
                    <div><Zap className="w-4 h-4 text-green-400 inline mr-1" /><span className="text-gray-400">{device.lastHeartbeat}</span></div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-sm"><FileText className="w-4 h-4 inline mr-1" />Logs</button>
                    {device.status === 'online' && <button className="btn-secondary text-sm"><RefreshCw className="w-4 h-4 inline mr-1" />Restart</button>}
                    {device.status === 'offline' && <button className="btn-primary text-sm"><AlertTriangle className="w-4 h-4 inline mr-1" />Troubleshoot</button>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
