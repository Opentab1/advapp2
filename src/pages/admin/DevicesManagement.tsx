import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Search, 
  Activity,
  AlertTriangle,
  CheckCircle,
  WifiOff,
  Cpu,
  HardDrive,
  Zap,
  RefreshCw,
  FileText,
  Power
} from 'lucide-react';

interface Device {
  id: string;
  deviceId: string;
  venueName: string;
  venueId: string;
  locationName: string;
  status: 'online' | 'offline' | 'error';
  lastHeartbeat: string;
  firmware: string;
  uptime: string;
  dataPointsToday: number;
  battery: string;
  cpuTemp: number;
  diskSpace: number;
}

export function DevicesManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'offline' | 'error'>('all');

  // TODO: Replace with real data from API
  const devices: Device[] = [
    {
      id: '1',
      deviceId: 'rpi-fergdata-001',
      venueName: "Ferg's Sports Bar",
      venueId: 'FergData',
      locationName: 'Main Floor',
      status: 'online',
      lastHeartbeat: '30 seconds ago',
      firmware: 'v2.1.3',
      uptime: '47 days, 3 hours',
      dataPointsToday: 17280,
      battery: '100% (AC)',
      cpuTemp: 52,
      diskSpace: 78
    },
    {
      id: '2',
      deviceId: 'rpi-fergdata-002',
      venueName: "Ferg's Sports Bar",
      venueId: 'FergData',
      locationName: 'Upstairs',
      status: 'online',
      lastHeartbeat: '25 seconds ago',
      firmware: 'v2.1.3',
      uptime: '45 days, 18 hours',
      dataPointsToday: 17280,
      battery: '100% (AC)',
      cpuTemp: 48,
      diskSpace: 82
    },
    {
      id: '3',
      deviceId: 'rpi-fergdata-003',
      venueName: "Ferg's Sports Bar",
      venueId: 'FergData',
      locationName: 'Patio',
      status: 'offline',
      lastHeartbeat: '2 hours ago',
      firmware: 'v2.1.2',
      uptime: '32 days, 5 hours',
      dataPointsToday: 0,
      battery: 'Unknown',
      cpuTemp: 0,
      diskSpace: 75
    }
  ];

  const filteredDevices = devices.filter(device => 
    (filterStatus === 'all' || device.status === filterStatus) &&
    (searchTerm === '' || 
     device.deviceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
     device.venueName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const stats = {
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    errors: devices.filter(d => d.status === 'error').length
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">📡 Device Management</h1>
            <p className="text-gray-400">Monitor all Raspberry Pi sensors across venues</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="glass-card p-4">
            <div className="text-sm text-gray-400 mb-1">Total Devices</div>
            <div className="text-2xl font-bold text-white">{stats.total}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-sm text-gray-400 mb-1">Online</div>
            <div className="text-2xl font-bold text-green-400">{stats.online}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-sm text-gray-400 mb-1">Offline</div>
            <div className="text-2xl font-bold text-red-400">{stats.offline}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-sm text-gray-400 mb-1">Errors</div>
            <div className="text-2xl font-bold text-yellow-400">{stats.errors}</div>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search devices or venues..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
            />
          </div>
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="online">Online Only</option>
            <option value="offline">Offline Only</option>
            <option value="error">Errors Only</option>
          </select>
        </div>

        {/* Devices List */}
        <div className="space-y-4">
          {filteredDevices.map((device, index) => (
            <motion.div
              key={device.id}
              className={`glass-card p-6 transition-all ${
                device.status === 'offline' ? 'border-red-500/30' : 
                device.status === 'error' ? 'border-yellow-500/30' : 
                'hover:border-purple-500/30'
              }`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-bold text-white font-mono">{device.deviceId}</h3>
                    {device.status === 'online' ? (
                      <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
                        <CheckCircle className="w-3 h-3" />
                        Online
                      </span>
                    ) : device.status === 'offline' ? (
                      <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400">
                        <WifiOff className="w-3 h-3" />
                        Offline
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">
                        <AlertTriangle className="w-3 h-3" />
                        Error
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 mb-1">
                    {device.venueName} - {device.locationName}
                  </div>
                  <div className="text-xs text-gray-500">
                    Firmware: {device.firmware} · Last heartbeat: {device.lastHeartbeat}
                  </div>
                </div>
              </div>

              {/* Device Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="text-xs text-gray-400">Uptime</div>
                    <div className="text-white text-sm font-medium">{device.uptime}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <div>
                    <div className="text-xs text-gray-400">Data Points</div>
                    <div className="text-white text-sm font-medium">{device.dataPointsToday.toLocaleString()}/day</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Cpu className={`w-4 h-4 ${device.cpuTemp > 70 ? 'text-red-400' : device.cpuTemp > 60 ? 'text-yellow-400' : 'text-green-400'}`} />
                  <div>
                    <div className="text-xs text-gray-400">CPU Temp</div>
                    <div className={`text-sm font-medium ${device.cpuTemp > 70 ? 'text-red-400' : device.cpuTemp > 60 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {device.cpuTemp}°C
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-purple-400" />
                  <div>
                    <div className="text-xs text-gray-400">Disk Space</div>
                    <div className="text-white text-sm font-medium">{device.diskSpace}% used</div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button className="btn-secondary text-sm flex-1">
                  <FileText className="w-4 h-4 inline mr-2" />
                  View Logs
                </button>
                {device.status === 'offline' && (
                  <button className="btn-primary text-sm flex-1">
                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                    Troubleshoot
                  </button>
                )}
                {device.status === 'online' && (
                  <>
                    <button className="btn-secondary text-sm flex-1">
                      <RefreshCw className="w-4 h-4 inline mr-2" />
                      Restart
                    </button>
                    <button className="btn-secondary text-sm flex-1">
                      <Power className="w-4 h-4 inline mr-2" />
                      Update Firmware
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
