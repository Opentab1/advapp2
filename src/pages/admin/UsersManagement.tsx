import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Users, 
  Plus, 
  Search, 
  MoreVertical,
  Mail,
  Building2,
  Shield,
  Edit,
  Key,
  Ban,
  Eye,
  Check,
  X
} from 'lucide-react';

interface UserAccount {
  id: string;
  email: string;
  name: string;
  venueName: string;
  venueId: string;
  role: string;
  status: 'active' | 'inactive' | 'suspended';
  lastLogin: string;
  termsAccepted: boolean;
  termsDate?: string;
}

export function UsersManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // TODO: Replace with real data from API
  const users: UserAccount[] = [
    {
      id: '1',
      email: 'john@fergsbar.com',
      name: 'John Smith',
      venueName: "Ferg's Sports Bar",
      venueId: 'FergData',
      role: 'Owner',
      status: 'active',
      lastLogin: '2 hours ago',
      termsAccepted: true,
      termsDate: 'Nov 6, 2025'
    },
    {
      id: '2',
      email: 'staff@fergsbar.com',
      name: 'Jane Doe',
      venueName: "Ferg's Sports Bar",
      venueId: 'FergData',
      role: 'Staff',
      status: 'active',
      lastLogin: '1 day ago',
      termsAccepted: true,
      termsDate: 'Oct 20, 2025'
    }
  ];

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">👥 Users Management</h1>
            <p className="text-gray-400">Manage client user accounts and permissions</p>
          </div>
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

        {/* Search & Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
            />
          </div>
          <select className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
            <option>All Roles</option>
            <option>Owners</option>
            <option>Managers</option>
            <option>Staff</option>
          </select>
          <select className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
            <option>All Statuses</option>
            <option>Active</option>
            <option>Inactive</option>
            <option>Suspended</option>
          </select>
        </div>

        {/* Users List */}
        <div className="space-y-4">
          {users.map((user, index) => (
            <motion.div
              key={user.id}
              className="glass-card p-6 hover:border-purple-500/30 transition-all"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4 flex-1">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg">
                    {user.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-bold text-white">{user.email}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        user.status === 'active' 
                          ? 'bg-green-500/20 text-green-400' 
                          : user.status === 'inactive'
                          ? 'bg-gray-500/20 text-gray-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {user.status === 'active' ? '✅ Active' : user.status === 'inactive' ? '⚪ Inactive' : '⛔ Suspended'}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400 mb-2">Name: {user.name}</div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <div className="flex items-center gap-1">
                        <Building2 className="w-4 h-4" />
                        {user.venueName}
                      </div>
                      <div className="flex items-center gap-1">
                        <Shield className="w-4 h-4" />
                        {user.role}
                      </div>
                      <div>Last login: {user.lastLogin}</div>
                    </div>
                  </div>
                </div>
                <button className="p-2 hover:bg-white/5 rounded transition-colors">
                  <MoreVertical className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              {/* Terms Status */}
              <div className="mb-4 p-3 bg-white/5 rounded">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-400">Terms Accepted</div>
                  <div className="flex items-center gap-2">
                    {user.termsAccepted ? (
                      <>
                        <Check className="w-4 h-4 text-green-400" />
                        <span className="text-green-400 text-sm">{user.termsDate}</span>
                      </>
                    ) : (
                      <>
                        <X className="w-4 h-4 text-red-400" />
                        <span className="text-red-400 text-sm">Not Accepted</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <button className="btn-secondary text-sm">
                  <Eye className="w-4 h-4 inline mr-2" />
                  View
                </button>
                <button className="btn-secondary text-sm">
                  <Key className="w-4 h-4 inline mr-2" />
                  Reset Password
                </button>
                <button className="btn-secondary text-sm">
                  <Edit className="w-4 h-4 inline mr-2" />
                  Edit
                </button>
                <button className="btn-secondary text-sm text-red-400 border-red-500/30 hover:bg-red-500/10">
                  <Ban className="w-4 h-4 inline mr-2" />
                  Disable
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
