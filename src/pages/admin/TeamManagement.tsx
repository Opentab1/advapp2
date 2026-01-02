import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Plus, 
  Search, 
  Shield,
  Edit,
  Ban,
  Eye,
  Check,
  ChevronDown,
  Building2
} from 'lucide-react';

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'sales' | 'support' | 'installer' | 'custom';
  status: 'active' | 'inactive';
  assignedVenues: number;
  permissions: string[];
  createdDate: string;
  lastActivity: string;
}

export function TeamManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [, setShowCreateModal] = useState(false);
  const [expandedPermissions, setExpandedPermissions] = useState<string | null>(null);

  // TODO: Replace with real data from API
  const teamMembers: TeamMember[] = [
    {
      id: '1',
      email: 'you@advizia.com',
      name: 'You (Super Admin)',
      role: 'admin',
      status: 'active',
      assignedVenues: 47,
      permissions: ['all'],
      createdDate: 'Jan 1, 2025',
      lastActivity: 'Just now'
    },
    {
      id: '2',
      email: 'sarah@advizia.com',
      name: 'Sarah Johnson',
      role: 'sales',
      status: 'active',
      assignedVenues: 12,
      permissions: ['create_venues', 'create_users', 'generate_configs', 'edit_venues'],
      createdDate: 'Mar 15, 2025',
      lastActivity: '5 hours ago'
    },
    {
      id: '3',
      email: 'john@advizia.com',
      name: 'John Davis',
      role: 'support',
      status: 'active',
      assignedVenues: 47,
      permissions: ['view_venues', 'reset_passwords', 'view_logs', 'view_devices'],
      createdDate: 'Apr 1, 2025',
      lastActivity: '2 days ago'
    }
  ];

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'sales': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'support': return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
      case 'installer': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getPermissionLabel = (perm: string) => {
    const labels: Record<string, string> = {
      all: 'Full System Access',
      create_venues: 'Create Venues',
      create_users: 'Create Users',
      generate_configs: 'Generate RPi Configs',
      edit_venues: 'Edit Venues',
      delete_venues: 'Delete Venues',
      view_venues: 'View Venues',
      reset_passwords: 'Reset Passwords',
      view_logs: 'View Audit Logs',
      view_devices: 'View Devices',
      manage_team: 'Manage Team Members'
    };
    return labels[perm] || perm;
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">👨‍💼 Team Management</h1>
            <p className="text-gray-400">Manage internal staff and their permissions</p>
          </div>
          <motion.button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Plus className="w-4 h-4" />
            Add Team Member
          </motion.button>
        </div>

        {/* Search & Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search team members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
            />
          </div>
          <select className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
            <option>All Roles</option>
            <option>Super Admin</option>
            <option>Sales Team</option>
            <option>Support Team</option>
            <option>Installer</option>
            <option>Custom</option>
          </select>
        </div>

        {/* Team Members List */}
        <div className="space-y-4">
          {teamMembers.map((member, index) => (
            <motion.div
              key={member.id}
              className="glass-card p-6 hover:border-purple-500/30 transition-all"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4 flex-1">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white font-bold text-lg">
                    {member.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-bold text-white">{member.email}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        member.status === 'active' 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {member.status === 'active' ? '✅ Active' : '⚪ Inactive'}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400 mb-2">Name: {member.name}</div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className={`px-3 py-1 rounded-lg border font-medium ${getRoleBadgeColor(member.role)}`}>
                        <Shield className="w-3 h-3 inline mr-1" />
                        {member.role === 'admin' ? 'Super Admin' : member.role === 'sales' ? 'Sales Team' : member.role === 'support' ? 'Support Team' : member.role}
                      </span>
                      {member.assignedVenues > 0 && (
                        <span className="text-gray-400">
                          <Building2 className="w-3 h-3 inline mr-1" />
                          {member.assignedVenues} venues
                        </span>
                      )}
                      <span className="text-gray-400">
                        Last activity: {member.lastActivity}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Permissions */}
              <div className="mb-4">
                <button
                  onClick={() => setExpandedPermissions(expandedPermissions === member.id ? null : member.id)}
                  className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-2"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${expandedPermissions === member.id ? 'rotate-180' : ''}`} />
                  Permissions ({member.permissions.length})
                </button>
                
                {expandedPermissions === member.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="flex flex-wrap gap-2 mt-2"
                  >
                    {member.permissions[0] === 'all' ? (
                      <span className="px-3 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs border border-red-500/30">
                        <Check className="w-3 h-3 inline mr-1" />
                        Full System Access
                      </span>
                    ) : (
                      member.permissions.map((perm) => (
                        <span key={perm} className="px-3 py-1 rounded-lg bg-purple-500/20 text-purple-400 text-xs border border-purple-500/30">
                          <Check className="w-3 h-3 inline mr-1" />
                          {getPermissionLabel(perm)}
                        </span>
                      ))
                    )}
                  </motion.div>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <button className="btn-secondary text-sm">
                  <Eye className="w-4 h-4 inline mr-2" />
                  View Activity
                </button>
                <button className="btn-secondary text-sm">
                  <Edit className="w-4 h-4 inline mr-2" />
                  Edit Permissions
                </button>
                {member.role !== 'admin' && (
                  <button className="btn-secondary text-sm text-red-400 border-red-500/30 hover:bg-red-500/10">
                    <Ban className="w-4 h-4 inline mr-2" />
                    Deactivate
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
