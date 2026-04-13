/**
 * UsersManagement — Admin user management page
 *
 * All API calls use REST via adminService (no GraphQL).
 * Password reset shows temp password in a modal with copy button.
 * Toggle enable/disable calls POST /admin/users/:email/enable|disable.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
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
  CheckCircle,
  Copy,
} from 'lucide-react';
import adminService, { AdminUser, CreateUserInput } from '../../services/admin.service';

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: string;
  type: 'success' | 'error';
  message: string;
}

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (type: Toast['type'], message: string) => {
    const id = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  return { toasts, addToast };
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`
              px-4 py-3 rounded-xl shadow-xl border text-sm font-medium flex items-center gap-2
              ${toast.type === 'success'
                ? 'bg-gray-900 border-green-500/40 text-green-300'
                : 'bg-gray-900 border-red-500/40 text-red-300'}
            `}
          >
            {toast.type === 'success'
              ? <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />}
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function UsersManagement() {
  const [searchTerm, setSearchTerm]   = useState('');
  const [roleFilter, setRoleFilter]   = useState<'all' | 'owner' | 'manager' | 'staff'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'pending'>('all');
  const [users, setUsers]             = useState<AdminUser[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [resetPasswordModal, setResetPasswordModal] = useState<AdminUser | null>(null);
  const [resetResult, setResetResult]   = useState<{ email: string; tempPassword: string } | null>(null);

  const { toasts, addToast } = useToast();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminService.listUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filteredUsers = users.filter(user => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false;
    if (statusFilter !== 'all' && user.status !== statusFilter) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        user.email.toLowerCase().includes(s) ||
        user.name.toLowerCase().includes(s) ||
        (user.venueName || '').toLowerCase().includes(s)
      );
    }
    return true;
  });

  const handleCreateUser = async (formData: CreateUserInput) => {
    setActionLoading(true);
    try {
      const result = await adminService.createUser(formData);
      if (result.success) {
        addToast('success', `User ${formData.email} created`);
        setShowCreateModal(false);
        fetchUsers();
        if (result.tempPassword) {
          setResetResult({ email: formData.email, tempPassword: result.tempPassword });
        }
      } else {
        addToast('error', result.message);
      }
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async (email: string) => {
    setActionLoading(true);
    try {
      const result = await adminService.resetUserPassword(email);
      if (result.success && result.tempPassword) {
        setResetPasswordModal(null);
        setResetResult({ email, tempPassword: result.tempPassword });
        addToast('success', 'Password reset successfully');
      } else {
        addToast('error', result.message || 'Failed to reset password');
      }
    } catch (err: any) {
      addToast('error', err.message || 'Failed to reset password');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleEnabled = async (user: AdminUser) => {
    const newEnabled = user.status !== 'active';
    setActionLoading(true);
    try {
      const success = await adminService.setUserEnabled(user.email, newEnabled);
      if (success) {
        addToast('success', `User ${newEnabled ? 'enabled' : 'disabled'}`);
        fetchUsers();
      } else {
        addToast('error', 'Failed to update user status');
      }
    } catch (err: any) {
      addToast('error', err.message || 'Failed to update user');
    } finally {
      setActionLoading(false);
    }
  };

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner:   'bg-purple-500/20 text-purple-400',
      manager: 'bg-cyan-500/20 text-cyan-400',
      staff:   'bg-gray-500/20 text-gray-400',
      admin:   'bg-red-500/20 text-red-400',
    };
    return colors[role] || colors.staff;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
            <CheckCircle className="w-3 h-3" /> Active
          </span>
        );
      case 'disabled':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">
            <Ban className="w-3 h-3" /> Disabled
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">
            <AlertTriangle className="w-3 h-3" /> Pending
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Users Management</h1>
            <p className="text-gray-400">
              {loading ? 'Loading...' : `${users.length} user${users.length !== 1 ? 's' : ''} total`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={fetchUsers}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm transition-colors disabled:opacity-50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </motion.button>
            <motion.button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Plus className="w-4 h-4" />
              Create User
            </motion.button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 text-white placeholder-gray-500"
            />
          </div>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value as any)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500/50"
          >
            <option value="all">All Roles</option>
            <option value="owner">Owners</option>
            <option value="manager">Managers</option>
            <option value="staff">Staff</option>
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-amber-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 mb-6">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
        )}

        {/* Empty */}
        {!loading && filteredUsers.length === 0 && (
          <motion.div
            className="glass-card p-12 text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <UserPlus className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold text-white mb-2">No Users Found</h3>
            <p className="text-gray-400">
              {searchTerm || roleFilter !== 'all' || statusFilter !== 'all'
                ? 'No users match your current filters.'
                : 'No users in the system yet.'}
            </p>
          </motion.div>
        )}

        {/* User Cards */}
        {!loading && filteredUsers.length > 0 && (
          <div className="space-y-4">
            {filteredUsers.map((user, i) => (
              <motion.div
                key={user.userId || user.email}
                className="glass-card p-6 hover:border-amber-500/20 transition-all"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-black font-bold text-lg flex-shrink-0">
                      {user.name
                        ? user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                        : user.email[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <h3 className="text-base font-bold text-white truncate">{user.email}</h3>
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
                          <div className="text-gray-500 text-xs">
                            Last login: {new Date(user.lastLoginAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Email Verified */}
                <div className="mb-4 px-4 py-2.5 bg-white/5 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-gray-400">Email Verified</span>
                  <div className="flex items-center gap-2">
                    {user.emailVerified ? (
                      <><Check className="w-4 h-4 text-green-400" /><span className="text-green-400 text-sm">Verified</span></>
                    ) : (
                      <><X className="w-4 h-4 text-yellow-400" /><span className="text-yellow-400 text-sm">Pending</span></>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <button className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10 transition-colors">
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button
                    onClick={() => setResetPasswordModal(user)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10 transition-colors"
                  >
                    <Key className="w-4 h-4" />
                    Reset Password
                  </button>
                  <button className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10 transition-colors">
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleEnabled(user)}
                    disabled={actionLoading}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50 ${
                      user.status === 'active'
                        ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30'
                        : 'bg-green-500/10 hover:bg-green-500/20 text-green-400 border-green-500/30'
                    }`}
                  >
                    {user.status === 'active' ? (
                      <><Ban className="w-4 h-4" />Disable</>
                    ) : (
                      <><CheckCircle className="w-4 h-4" />Enable</>
                    )}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Modals */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateUserModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateUser}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resetPasswordModal && (
          <ResetPasswordModal
            user={resetPasswordModal}
            onClose={() => setResetPasswordModal(null)}
            onReset={handleResetPassword}
            loading={actionLoading}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resetResult && (
          <TempPasswordModal
            email={resetResult.email}
            tempPassword={resetResult.tempPassword}
            onClose={() => setResetResult(null)}
          />
        )}
      </AnimatePresence>

      <ToastContainer toasts={toasts} />
    </div>
  );
}

// ─── Create User Modal ────────────────────────────────────────────────────────

function CreateUserModal({
  onClose,
  onCreate,
  loading,
}: {
  onClose: () => void;
  onCreate: (data: CreateUserInput) => void;
  loading: boolean;
}) {
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    venueId: '',
    venueName: '',
    role: 'staff' as 'owner' | 'manager' | 'staff',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.name || !formData.venueId) return;
    onCreate(formData);
  };

  return (
    <ModalWrapper onClose={onClose}>
      <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
        <UserPlus className="w-5 h-5 text-amber-400" />
        Create New User
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {(['email', 'name', 'venueId', 'venueName'] as const).map(field => (
          <div key={field}>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wide">
              {field === 'venueId' ? 'Venue ID *' : field === 'venueName' ? 'Venue Name' : `${field.charAt(0).toUpperCase() + field.slice(1)} *`}
            </label>
            <input
              type={field === 'email' ? 'email' : 'text'}
              value={formData[field]}
              onChange={e => setFormData(p => ({ ...p, [field]: e.target.value }))}
              required={field !== 'venueName'}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50"
              placeholder={
                field === 'email' ? 'user@venue.com' :
                field === 'name' ? 'John Smith' :
                field === 'venueId' ? 'FergData' :
                "Ferg's Sports Bar"
              }
            />
          </div>
        ))}
        <div>
          <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wide">Role</label>
          <select
            value={formData.role}
            onChange={e => setFormData(p => ({ ...p, role: e.target.value as any }))}
            className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500/50"
          >
            <option value="staff">Staff</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Create User
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// ─── Reset Password Modal ─────────────────────────────────────────────────────

function ResetPasswordModal({
  user,
  onClose,
  onReset,
  loading,
}: {
  user: AdminUser;
  onClose: () => void;
  onReset: (email: string) => void;
  loading: boolean;
}) {
  return (
    <ModalWrapper onClose={onClose}>
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <Key className="w-5 h-5 text-yellow-400" />
        Reset Password
      </h2>
      <p className="text-gray-400 text-sm mb-4">
        This will generate a new temporary password for:
      </p>
      <div className="p-4 bg-gray-800 rounded-lg mb-4">
        <div className="flex items-center gap-3">
          <Mail className="w-5 h-5 text-amber-400" />
          <span className="text-white font-medium">{user.email}</span>
        </div>
        {user.name && <p className="text-sm text-gray-500 mt-1">{user.name}</p>}
      </div>
      <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-5">
        <p className="text-sm text-yellow-300">
          The user will be required to change this password on their next login.
        </p>
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10 transition-colors">
          Cancel
        </button>
        <button onClick={() => onReset(user.email)} disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
          Reset Password
        </button>
      </div>
    </ModalWrapper>
  );
}

// ─── Temp Password Modal ──────────────────────────────────────────────────────

function TempPasswordModal({
  email,
  tempPassword,
  onClose,
}: {
  email: string;
  tempPassword: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(tempPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <ModalWrapper onClose={onClose}>
      <div className="text-center mb-5">
        <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-white">Password Set</h2>
        <p className="text-gray-400 text-sm mt-1">{email}</p>
      </div>
      <p className="text-sm text-gray-400 mb-3">Temporary password (share securely):</p>
      <div className="flex items-center gap-2 p-3 bg-gray-800 border border-gray-700 rounded-lg mb-2">
        <code className="flex-1 text-amber-400 font-mono text-sm tracking-wider">{tempPassword}</code>
        <button
          onClick={copy}
          className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors flex-shrink-0"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-5">
        This password will only be shown once. The user must change it on first login.
      </p>
      <button
        onClick={onClose}
        className="w-full px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-colors"
      >
        Done
      </button>
    </ModalWrapper>
  );
}

// ─── Modal Wrapper ────────────────────────────────────────────────────────────

function ModalWrapper({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <motion.div
        className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
