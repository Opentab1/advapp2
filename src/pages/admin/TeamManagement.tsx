/**
 * TeamManagement - Admin internal team management
 * 
 * Manage Advizia staff: sales, support, installers
 * Assign permissions and view activity
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  Search, 
  Shield,
  Edit,
  Ban,
  Eye,
  Check,
  ChevronDown,
  Building2,
  RefreshCw,
  UserPlus,
  Settings,
  X
} from 'lucide-react';
import adminService from '../../services/admin.service';

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'sales' | 'support' | 'installer';
  status: 'active' | 'inactive';
  assignedVenues: number;
  permissions: string[];
  createdAt: string;
  lastActivity: string;
}

const AVAILABLE_PERMISSIONS = [
  { id: 'create_venues', label: 'Create Venues', description: 'Can create new client venues' },
  { id: 'edit_venues', label: 'Edit Venues', description: 'Can modify venue settings' },
  { id: 'delete_venues', label: 'Delete Venues', description: 'Can delete venues (dangerous)' },
  { id: 'create_users', label: 'Create Users', description: 'Can create client user accounts' },
  { id: 'reset_passwords', label: 'Reset Passwords', description: 'Can reset client passwords' },
  { id: 'generate_configs', label: 'Generate RPi Configs', description: 'Can generate device configurations' },
  { id: 'view_logs', label: 'View Audit Logs', description: 'Can view system audit logs' },
  { id: 'view_devices', label: 'View Devices', description: 'Can view device status' },
  { id: 'manage_team', label: 'Manage Team', description: 'Can manage other team members' },
];

const ROLE_PRESETS: Record<string, string[]> = {
  admin: ['all'],
  sales: ['create_venues', 'create_users', 'generate_configs', 'edit_venues'],
  support: ['view_venues', 'reset_passwords', 'view_logs', 'view_devices'],
  installer: ['view_venues', 'generate_configs', 'view_devices'],
};

export function TeamManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState<TeamMember | null>(null);
  const [expandedPermissions, setExpandedPermissions] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch team members
  const fetchTeamMembers = useCallback(async () => {
    setLoading(true);
    try {
      const members = await adminService.listTeamMembers();
      setTeamMembers(members);
    } catch (error) {
      console.error('Failed to fetch team members:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeamMembers();
  }, [fetchTeamMembers]);

  // Filter members
  const filteredMembers = teamMembers.filter(member => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return member.email.toLowerCase().includes(search) || 
             member.name.toLowerCase().includes(search);
    }
    return true;
  });

  // Create team member
  const handleCreateMember = async (data: { email: string; name: string; role: 'admin' | 'sales' | 'support' | 'installer' }) => {
    setActionLoading(true);
    try {
      const permissions = ROLE_PRESETS[data.role] || [];
      const result = await adminService.createTeamMember({ ...data, permissions });
      if (result.success) {
        alert('✅ Team member created! They will receive an email invitation.');
        setShowCreateModal(false);
        fetchTeamMembers();
      } else {
        alert(`❌ Error: ${result.message}`);
      }
    } catch (error: any) {
      alert(`❌ Failed: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Update permissions
  const handleUpdatePermissions = async (email: string, permissions: string[]) => {
    setActionLoading(true);
    try {
      const success = await adminService.updateTeamMemberPermissions(email, permissions);
      if (success) {
        setShowPermissionsModal(null);
        fetchTeamMembers();
      } else {
        alert('Failed to update permissions. This requires the updateAdminPermissions resolver.');
      }
    } catch (error: any) {
      alert(`❌ Failed: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Deactivate member
  const handleDeactivate = async (email: string) => {
    if (!confirm('Are you sure you want to deactivate this team member?')) return;
    
    setActionLoading(true);
    try {
      const success = await adminService.deactivateTeamMember(email);
      if (success) {
        fetchTeamMembers();
      } else {
        alert('Failed to deactivate. This requires the deactivateAdminTeamMember resolver.');
      }
    } catch (error: any) {
      alert(`❌ Failed: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'sales': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'support': return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
      case 'installer': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin': return 'Super Admin';
      case 'sales': return 'Sales Team';
      case 'support': return 'Support Team';
      case 'installer': return 'Installer';
      default: return role;
    }
  };

  const getPermissionLabel = (perm: string) => {
    if (perm === 'all') return 'Full System Access';
    return AVAILABLE_PERMISSIONS.find(p => p.id === perm)?.label || perm;
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
            <p className="text-gray-400">
              {loading ? 'Loading...' : `${teamMembers.length} team member${teamMembers.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={fetchTeamMembers}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </motion.button>
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
        </div>

        {/* Search */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search team members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white"
            />
          </div>
          <select className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white">
            <option>All Roles</option>
            <option>Super Admin</option>
            <option>Sales Team</option>
            <option>Support Team</option>
            <option>Installer</option>
          </select>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!loading && teamMembers.length === 0 && (
          <div className="glass-card p-12 text-center">
            <UserPlus className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold text-white mb-2">No Team Members Found</h3>
            <p className="text-gray-400 mb-4">
              Team members will appear once the listAdminTeam resolver is deployed
            </p>
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg max-w-md mx-auto">
              <div className="flex items-start gap-2">
                <Settings className="w-5 h-5 text-yellow-400 mt-0.5" />
                <p className="text-sm text-yellow-300 text-left">
                  Team management requires a <code className="text-yellow-400">listAdminTeam</code> Lambda that queries the admins Cognito group.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Team Members List */}
        {!loading && filteredMembers.length > 0 && (
          <div className="space-y-4">
            {filteredMembers.map((member, index) => (
              <motion.div
                key={member.id}
                className="glass-card p-6 hover:border-purple-500/30 transition-all"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4 flex-1">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                      member.role === 'admin' ? 'bg-gradient-to-br from-red-500 to-orange-500' :
                      member.role === 'sales' ? 'bg-gradient-to-br from-purple-500 to-pink-500' :
                      member.role === 'support' ? 'bg-gradient-to-br from-cyan-500 to-blue-500' :
                      'bg-gradient-to-br from-green-500 to-emerald-500'
                    }`}>
                      {member.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
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
                      <div className="text-sm text-gray-400 mb-2">{member.name}</div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className={`px-3 py-1 rounded-lg border font-medium ${getRoleBadgeColor(member.role)}`}>
                          <Shield className="w-3 h-3 inline mr-1" />
                          {getRoleLabel(member.role)}
                        </span>
                        {member.assignedVenues > 0 && (
                          <span className="text-gray-400">
                            <Building2 className="w-3 h-3 inline mr-1" />
                            {member.assignedVenues} venues
                          </span>
                        )}
                        <span className="text-gray-500">
                          Last active: {member.lastActivity}
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
                  
                  <AnimatePresence>
                    {expandedPermissions === member.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
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
                  </AnimatePresence>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <button className="btn-secondary text-sm">
                    <Eye className="w-4 h-4 inline mr-2" />
                    View Activity
                  </button>
                  <button 
                    onClick={() => setShowPermissionsModal(member)}
                    className="btn-secondary text-sm"
                  >
                    <Edit className="w-4 h-4 inline mr-2" />
                    Edit Permissions
                  </button>
                  {member.role !== 'admin' && (
                    <button 
                      onClick={() => handleDeactivate(member.email)}
                      disabled={actionLoading}
                      className="btn-secondary text-sm text-red-400 border-red-500/30 hover:bg-red-500/10"
                    >
                      <Ban className="w-4 h-4 inline mr-2" />
                      Deactivate
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateTeamMemberModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateMember}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>

      {/* Edit Permissions Modal */}
      <AnimatePresence>
        {showPermissionsModal && (
          <EditPermissionsModal
            member={showPermissionsModal}
            onClose={() => setShowPermissionsModal(null)}
            onSave={handleUpdatePermissions}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Create Team Member Modal
function CreateTeamMemberModal({ 
  onClose, 
  onCreate, 
  loading 
}: { 
  onClose: () => void; 
  onCreate: (data: { email: string; name: string; role: 'admin' | 'sales' | 'support' | 'installer' }) => void;
  loading: boolean;
}) {
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    role: 'support' as 'admin' | 'sales' | 'support' | 'installer'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.name) {
      alert('Please fill in all fields');
      return;
    }
    onCreate(formData);
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <motion.div
        className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md"
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-purple-400" />
          Add Team Member
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email *</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              placeholder="team@advizia.com"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              placeholder="John Smith"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as any }))}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            >
              <option value="support">Support Team</option>
              <option value="sales">Sales Team</option>
              <option value="installer">Installer</option>
              <option value="admin">Super Admin</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Role determines default permissions
            </p>
          </div>
          
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="flex-1 btn-primary flex items-center justify-center gap-2" disabled={loading}>
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Add Member
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Edit Permissions Modal
function EditPermissionsModal({ 
  member, 
  onClose, 
  onSave, 
  loading 
}: { 
  member: TeamMember; 
  onClose: () => void; 
  onSave: (email: string, permissions: string[]) => void;
  loading: boolean;
}) {
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(member.permissions);

  const togglePermission = (permId: string) => {
    setSelectedPermissions(prev => 
      prev.includes(permId) 
        ? prev.filter(p => p !== permId)
        : [...prev, permId]
    );
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <motion.div
        className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg max-h-[80vh] overflow-auto"
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-400" />
          Edit Permissions
        </h2>
        <p className="text-sm text-gray-400 mb-6">{member.email}</p>
        
        <div className="space-y-3 mb-6">
          {AVAILABLE_PERMISSIONS.map(perm => (
            <label 
              key={perm.id}
              className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                selectedPermissions.includes(perm.id) 
                  ? 'bg-purple-500/20 border border-purple-500/30' 
                  : 'bg-gray-800 border border-gray-700 hover:border-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedPermissions.includes(perm.id)}
                onChange={() => togglePermission(perm.id)}
                className="mt-1"
              />
              <div>
                <div className="text-white font-medium">{perm.label}</div>
                <div className="text-xs text-gray-400">{perm.description}</div>
              </div>
            </label>
          ))}
        </div>
        
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 btn-secondary" disabled={loading}>
            Cancel
          </button>
          <button 
            onClick={() => onSave(member.email, selectedPermissions)} 
            className="flex-1 btn-primary flex items-center justify-center gap-2" 
            disabled={loading}
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save Permissions
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
