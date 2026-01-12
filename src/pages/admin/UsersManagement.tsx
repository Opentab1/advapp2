/**
 * UsersManagement - Admin user management page
 * 
 * Features:
 * - List all users from Cognito
 * - Create new user
 * - Reset password
 * - Enable/disable users
 * - Edit user attributes
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  Search, 
  MoreVertical,
  Building2,
  Shield,
  Edit,
  Key,
  Ban,
  Eye,
  Check,
  X,
  RefreshCw,
  UserPlus,
  Mail,
  AlertTriangle,
  Settings,
  CheckCircle
} from 'lucide-react';
import adminService, { AdminUser, CreateUserInput } from '../../services/admin.service';

export function UsersManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'owner' | 'manager' | 'staff'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'pending'>('all');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState<AdminUser | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const userList = await adminService.listUsers();
      setUsers(userList);
    } catch (err: any) {
      console.error('Failed to fetch users:', err);
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Filter users
  const filteredUsers = users.filter(user => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false;
    if (statusFilter !== 'all' && user.status !== statusFilter) return false;
    
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        user.email.toLowerCase().includes(search) ||
        user.name.toLowerCase().includes(search) ||
        user.venueName.toLowerCase().includes(search)
      );
    }
    return true;
  });

  // Handle create user
  const handleCreateUser = async (formData: CreateUserInput) => {
    setActionLoading(true);
    try {
      const result = await adminService.createUser(formData);
      if (result.success) {
        alert(`✅ User created!\n\nEmail: ${formData.email}\nTemporary Password: ${result.tempPassword}\n\n⚠️ Share this password securely with the user.`);
        setShowCreateModal(false);
        fetchUsers();
      } else {
        alert(`❌ Error: ${result.message}`);
      }
    } catch (error: any) {
      alert(`❌ Failed to create user: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle reset password
  const handleResetPassword = async (email: string) => {
    setActionLoading(true);
    try {
      const result = await adminService.resetUserPassword(email);
      if (result.success) {
        alert(`✅ Password reset!\n\nNew temporary password: ${result.tempPassword}\n\n⚠️ Share this password securely with the user.`);
        setShowResetPasswordModal(null);
      } else {
        alert(`❌ Error: ${result.message}`);
      }
    } catch (error: any) {
      alert(`❌ Failed to reset password: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle enable/disable
  const handleToggleEnabled = async (user: AdminUser) => {
    const newEnabled = user.status !== 'active';
    setActionLoading(true);
    try {
      const success = await adminService.setUserEnabled(user.email, newEnabled);
      if (success) {
        fetchUsers();
      } else {
        alert('Failed to update user status. This action requires the setUserEnabled resolver.');
      }
    } catch (error: any) {
      alert(`❌ Failed to update user: ${error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Get role badge color
  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner: 'bg-purple-500/20 text-purple-400',
      manager: 'bg-cyan-500/20 text-cyan-400',
      staff: 'bg-gray-500/20 text-gray-400',
      admin: 'bg-red-500/20 text-red-400',
    };
    return colors[role] || colors.staff;
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
            <CheckCircle className="w-3 h-3" />
            Active
          </span>
        );
      case 'disabled':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">
            <Ban className="w-3 h-3" />
            Disabled
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">
            <AlertTriangle className="w-3 h-3" />
            Pending
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">👥 Users Management</h1>
            <p className="text-gray-400">
              {loading ? 'Loading...' : `${users.length} user${users.length !== 1 ? 's' : ''} total`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={fetchUsers}
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
              Create New User
            </motion.button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
          >
            <option value="all">All Roles</option>
            <option value="owner">Owners</option>
            <option value="manager">Managers</option>
            <option value="staff">Staff</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        {/* Error State */}
        {error && (
          <motion.div
            className="glass-card p-6 mb-6 border-red-500/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          </motion.div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!loading && users.length === 0 && (
          <motion.div
            className="glass-card p-12 text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <UserPlus className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold text-white mb-2">No Users Found</h3>
            <p className="text-gray-400 mb-4">
              {searchTerm || roleFilter !== 'all' || statusFilter !== 'all'
                ? 'No users match your filters'
                : 'Users will appear here once the listAllUsers resolver is deployed'}
            </p>
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-left max-w-md mx-auto">
              <div className="flex items-start gap-2">
                <Settings className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-yellow-300">
                  User listing requires a <code className="text-yellow-400">listAllUsers</code> Lambda that queries Cognito User Pool.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Users List */}
        {!loading && filteredUsers.length > 0 && (
          <div className="space-y-4">
            {filteredUsers.map((user, index) => (
              <motion.div
                key={user.userId || user.email}
                className="glass-card p-6 hover:border-purple-500/30 transition-all"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4 flex-1">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                      {user.name ? user.name.split(' ').map(n => n[0]).join('').slice(0, 2) : user.email[0].toUpperCase()}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <h3 className="text-lg font-bold text-white truncate">{user.email}</h3>
                        {getStatusBadge(user.status)}
                      </div>
                      <div className="text-sm text-gray-400 mb-2">{user.name || 'No name set'}</div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
                        <div className="flex items-center gap-1">
                          <Building2 className="w-4 h-4" />
                          {user.venueName || 'No venue'}
                        </div>
                        <div className="flex items-center gap-1">
                          <Shield className="w-4 h-4" />
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getRoleBadge(user.role)}`}>
                            {user.role}
                          </span>
                        </div>
                        {user.lastLoginAt && (
                          <div className="text-gray-500">
                            Last login: {new Date(user.lastLoginAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <button className="p-2 hover:bg-white/5 rounded transition-colors">
                    <MoreVertical className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                {/* Email Verified Status */}
                <div className="mb-4 p-3 bg-white/5 rounded flex items-center justify-between">
                  <span className="text-sm text-gray-400">Email Verified</span>
                  <div className="flex items-center gap-2">
                    {user.emailVerified ? (
                      <>
                        <Check className="w-4 h-4 text-green-400" />
                        <span className="text-green-400 text-sm">Verified</span>
                      </>
                    ) : (
                      <>
                        <X className="w-4 h-4 text-yellow-400" />
                        <span className="text-yellow-400 text-sm">Pending</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <button className="btn-secondary text-sm flex items-center justify-center gap-1">
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button 
                    onClick={() => setShowResetPasswordModal(user)}
                    className="btn-secondary text-sm flex items-center justify-center gap-1"
                  >
                    <Key className="w-4 h-4" />
                    Reset Password
                  </button>
                  <button className="btn-secondary text-sm flex items-center justify-center gap-1">
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button 
                    onClick={() => handleToggleEnabled(user)}
                    disabled={actionLoading}
                    className={`btn-secondary text-sm flex items-center justify-center gap-1 ${
                      user.status === 'active' 
                        ? 'text-red-400 border-red-500/30 hover:bg-red-500/10'
                        : 'text-green-400 border-green-500/30 hover:bg-green-500/10'
                    }`}
                  >
                    {user.status === 'active' ? (
                      <>
                        <Ban className="w-4 h-4" />
                        Disable
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        Enable
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Create User Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateUserModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateUser}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>

      {/* Reset Password Modal */}
      <AnimatePresence>
        {showResetPasswordModal && (
          <ResetPasswordModal
            user={showResetPasswordModal}
            onClose={() => setShowResetPasswordModal(null)}
            onReset={handleResetPassword}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ CREATE USER MODAL ============

interface CreateUserModalProps {
  onClose: () => void;
  onCreate: (data: CreateUserInput) => void;
  loading: boolean;
}

function CreateUserModal({ onClose, onCreate, loading }: CreateUserModalProps) {
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    venueId: '',
    venueName: '',
    role: 'staff' as 'owner' | 'manager' | 'staff',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.name || !formData.venueId) {
      alert('Please fill in all required fields');
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
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-cyan-400" />
          Create New User
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email *</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              placeholder="user@venue.com"
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
            <label className="block text-sm text-gray-400 mb-1">Venue ID *</label>
            <input
              type="text"
              value={formData.venueId}
              onChange={(e) => setFormData(prev => ({ ...prev, venueId: e.target.value }))}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              placeholder="FergData"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-1">Venue Name</label>
            <input
              type="text"
              value={formData.venueName}
              onChange={(e) => setFormData(prev => ({ ...prev, venueName: e.target.value }))}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              placeholder="Ferg's Sports Bar"
            />
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-1">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as any }))}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            >
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 btn-primary flex items-center justify-center gap-2"
              disabled={loading}
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Create User
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ============ RESET PASSWORD MODAL ============

interface ResetPasswordModalProps {
  user: AdminUser;
  onClose: () => void;
  onReset: (email: string) => void;
  loading: boolean;
}

function ResetPasswordModal({ user, onClose, onReset, loading }: ResetPasswordModalProps) {
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
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Key className="w-5 h-5 text-yellow-400" />
          Reset Password
        </h2>
        
        <p className="text-gray-400 mb-4">
          This will generate a new temporary password for:
        </p>
        
        <div className="p-4 bg-gray-800 rounded-lg mb-6">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-cyan-400" />
            <span className="text-white font-medium">{user.email}</span>
          </div>
          <p className="text-sm text-gray-500 mt-2">{user.name}</p>
        </div>
        
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-6">
          <p className="text-sm text-yellow-300">
            ⚠️ The user will need to change this password on their next login.
          </p>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={() => onReset(user.email)}
            className="flex-1 btn-primary flex items-center justify-center gap-2"
            disabled={loading}
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
            Reset Password
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
