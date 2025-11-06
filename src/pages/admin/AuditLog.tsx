import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  ScrollText, 
  Search, 
  Filter,
  Download,
  Calendar,
  User,
  Building2,
  Settings,
  UserPlus,
  Trash2,
  Edit,
  Key,
  FileDown
} from 'lucide-react';

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  actionType: 'create' | 'update' | 'delete' | 'access' | 'config';
  targetType: 'venue' | 'user' | 'device' | 'system';
  targetName: string;
  performedBy: string;
  performedByRole: string;
  details: string;
  ipAddress: string;
}

export function AuditLog() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'venue' | 'user' | 'device' | 'system'>('all');
  const [dateRange, setDateRange] = useState('7d');

  // TODO: Replace with real data from API
  const auditEntries: AuditEntry[] = [
    {
      id: '1',
      timestamp: 'Nov 6, 2025 2:45 PM',
      action: 'CREATE_VENUE',
      actionType: 'create',
      targetType: 'venue',
      targetName: 'Downtown Lounge',
      performedBy: 'sarah@advizia.com',
      performedByRole: 'Sales',
      details: 'Created new venue with 1 location',
      ipAddress: '192.168.1.100'
    },
    {
      id: '2',
      timestamp: 'Nov 6, 2025 2:30 PM',
      action: 'PASSWORD_RESET',
      actionType: 'update',
      targetType: 'user',
      targetName: 'john@fergsbar.com',
      performedBy: 'support@advizia.com',
      performedByRole: 'Support',
      details: 'User requested password reset',
      ipAddress: '192.168.1.105'
    },
    {
      id: '3',
      timestamp: 'Nov 6, 2025 1:15 PM',
      action: 'UPDATE_PERMISSIONS',
      actionType: 'update',
      targetType: 'user',
      targetName: 'sarah@advizia.com',
      performedBy: 'you@advizia.com',
      performedByRole: 'Super Admin',
      details: 'Added "Delete venues" permission',
      ipAddress: '192.168.1.50'
    },
    {
      id: '4',
      timestamp: 'Nov 6, 2025 12:00 PM',
      action: 'GENERATE_CONFIG',
      actionType: 'config',
      targetType: 'device',
      targetName: 'rpi-downtown-001',
      performedBy: 'sarah@advizia.com',
      performedByRole: 'Sales',
      details: 'Generated RPi configuration for new venue',
      ipAddress: '192.168.1.100'
    },
    {
      id: '5',
      timestamp: 'Nov 5, 2025 4:30 PM',
      action: 'DELETE_USER',
      actionType: 'delete',
      targetType: 'user',
      targetName: 'old@venue.com',
      performedBy: 'you@advizia.com',
      performedByRole: 'Super Admin',
      details: 'User account closed at client request',
      ipAddress: '192.168.1.50'
    }
  ];

  const getActionIcon = (type: AuditEntry['actionType']) => {
    switch (type) {
      case 'create': return <UserPlus className="w-4 h-4 text-green-400" />;
      case 'update': return <Edit className="w-4 h-4 text-cyan-400" />;
      case 'delete': return <Trash2 className="w-4 h-4 text-red-400" />;
      case 'access': return <Key className="w-4 h-4 text-purple-400" />;
      case 'config': return <FileDown className="w-4 h-4 text-yellow-400" />;
    }
  };

  const getActionColor = (type: AuditEntry['actionType']) => {
    switch (type) {
      case 'create': return 'border-green-500/30 bg-green-500/5';
      case 'update': return 'border-cyan-500/30 bg-cyan-500/5';
      case 'delete': return 'border-red-500/30 bg-red-500/5';
      case 'access': return 'border-purple-500/30 bg-purple-500/5';
      case 'config': return 'border-yellow-500/30 bg-yellow-500/5';
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">📜 Audit Log</h1>
            <p className="text-gray-400">Track all system actions and changes</p>
          </div>
          <motion.button
            className="btn-secondary flex items-center gap-2"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </motion.button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search actions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 text-white"
            />
          </div>
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white"
          >
            <option value="all">All Types</option>
            <option value="venue">Venues</option>
            <option value="user">Users</option>
            <option value="device">Devices</option>
            <option value="system">System</option>
          </select>
          <select 
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="all">All Time</option>
          </select>
          <select className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white">
            <option>All Actions</option>
            <option>Create</option>
            <option>Update</option>
            <option>Delete</option>
            <option>Access</option>
            <option>Config</option>
          </select>
        </div>

        {/* Audit Entries */}
        <div className="space-y-3">
          {auditEntries.map((entry, index) => (
            <motion.div
              key={entry.id}
              className={`glass-card p-5 border ${getActionColor(entry.actionType)}`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  {getActionIcon(entry.actionType)}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-semibold">{entry.action}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-gray-400">
                          {entry.targetType}
                        </span>
                      </div>
                      <div className="text-sm text-gray-300 mb-1">{entry.targetName}</div>
                      <div className="text-sm text-gray-400">{entry.details}</div>
                    </div>
                    <div className="text-right text-sm text-gray-400">
                      {entry.timestamp}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 mt-3 pt-3 border-t border-white/10">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {entry.performedBy} ({entry.performedByRole})
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                      {entry.ipAddress}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Load More */}
        <div className="mt-6 text-center">
          <button className="btn-secondary">
            Load More Entries
          </button>
        </div>
      </motion.div>
    </div>
  );
}
