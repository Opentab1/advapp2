/**
 * AuditLog - Admin audit log viewer
 * 
 * Track all admin actions: venue creation, user management, config changes
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Search, 
  Download,
  User,
  UserPlus,
  Trash2,
  Edit,
  Key,
  FileDown,
  RefreshCw,
  Settings,
  Calendar,
  Filter
} from 'lucide-react';
import adminService from '../../services/admin.service';

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
  const [dateRange, setDateRange] = useState<'24h' | '7d' | '30d' | '90d' | 'all'>('7d');
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch audit log
  const fetchAuditLog = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await adminService.getAuditLog({
        filterType,
        dateRange,
        searchTerm,
        limit: 100
      });
      setAuditEntries(entries);
    } catch (error) {
      console.error('Failed to fetch audit log:', error);
    } finally {
      setLoading(false);
    }
  }, [filterType, dateRange, searchTerm]);

  useEffect(() => {
    fetchAuditLog();
  }, [fetchAuditLog]);

  // Export to CSV
  const handleExport = () => {
    if (auditEntries.length === 0) {
      alert('No entries to export');
      return;
    }

    const headers = ['Timestamp', 'Action', 'Type', 'Target', 'Performed By', 'Role', 'Details', 'IP Address'];
    const rows = auditEntries.map(e => [
      e.timestamp,
      e.action,
      e.targetType,
      e.targetName,
      e.performedBy,
      e.performedByRole,
      e.details,
      e.ipAddress
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter entries by search
  const filteredEntries = auditEntries.filter(entry => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      entry.action.toLowerCase().includes(search) ||
      entry.targetName.toLowerCase().includes(search) ||
      entry.performedBy.toLowerCase().includes(search) ||
      entry.details.toLowerCase().includes(search)
    );
  });

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
            <p className="text-gray-400">
              {loading ? 'Loading...' : `${auditEntries.length} entries`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={fetchAuditLog}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </motion.button>
            <motion.button
              onClick={handleExport}
              className="btn-secondary flex items-center gap-2"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Download className="w-4 h-4" />
              Export CSV
            </motion.button>
          </div>
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
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white appearance-none"
            >
              <option value="all">All Types</option>
              <option value="venue">Venues</option>
              <option value="user">Users</option>
              <option value="device">Devices</option>
              <option value="system">System</option>
            </select>
          </div>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <select 
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white appearance-none"
            >
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>
          <select className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white">
            <option>All Actions</option>
            <option>Create</option>
            <option>Update</option>
            <option>Delete</option>
            <option>Access</option>
            <option>Config</option>
          </select>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!loading && auditEntries.length === 0 && (
          <div className="glass-card p-12 text-center">
            <FileDown className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold text-white mb-2">No Audit Entries</h3>
            <p className="text-gray-400 mb-4">
              Audit entries will appear once the getAuditLog resolver is deployed
            </p>
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg max-w-md mx-auto">
              <div className="flex items-start gap-2">
                <Settings className="w-5 h-5 text-yellow-400 mt-0.5" />
                <p className="text-sm text-yellow-300 text-left">
                  Audit logging requires a DynamoDB table <code className="text-yellow-400">AdminAuditLog</code> and all admin mutations to log their actions.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Audit Entries */}
        {!loading && filteredEntries.length > 0 && (
          <div className="space-y-3">
            {filteredEntries.map((entry, index) => (
              <motion.div
                key={entry.id}
                className={`glass-card p-5 border ${getActionColor(entry.actionType)}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.03 }}
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
        )}

        {/* Load More */}
        {!loading && filteredEntries.length >= 50 && (
          <div className="mt-6 text-center">
            <button className="btn-secondary">
              Load More Entries
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
