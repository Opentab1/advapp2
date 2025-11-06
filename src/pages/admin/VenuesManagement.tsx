import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Building2, 
  Plus, 
  Search, 
  MoreVertical,
  MapPin,
  Users,
  Wifi,
  Edit,
  Trash2,
  FileDown,
  Eye
} from 'lucide-react';
import { CreateVenueModal, VenueFormData } from '../../components/admin/CreateVenueModal';

interface Venue {
  id: string;
  name: string;
  venueId: string;
  createdDate: string;
  locations: number;
  users: number;
  devices: number;
  status: 'active' | 'inactive' | 'suspended';
  plan: string;
  lastData: string;
}

export function VenuesManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleCreateVenue = (venueData: VenueFormData) => {
    // TODO: Call API to create venue
    console.log('Creating venue:', venueData);
    alert('Venue creation will be wired to AWS backend. For now, this shows the UI works!');
    // In production: call Lambda/AppSync mutation to create venue
  };

  // TODO: Replace with real data from API
  const venues: Venue[] = [
    {
      id: '1',
      name: "Ferg's Sports Bar",
      venueId: 'FergData',
      createdDate: 'Oct 15, 2025',
      locations: 3,
      users: 5,
      devices: 3,
      status: 'active',
      plan: 'Premium ($150/mo)',
      lastData: '30 seconds ago'
    },
    {
      id: '2',
      name: 'Downtown Lounge',
      venueId: 'DowntownLounge',
      createdDate: 'Nov 1, 2025',
      locations: 1,
      users: 2,
      devices: 1,
      status: 'active',
      plan: 'Basic ($50/mo)',
      lastData: '1 minute ago'
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
            <h1 className="text-3xl font-bold gradient-text mb-2">🏢 Venues Management</h1>
            <p className="text-gray-400">Manage all client venues and locations</p>
          </div>
          <motion.button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Plus className="w-4 h-4" />
            Create New Venue
          </motion.button>
        </div>

        {/* Search & Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search venues..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
            />
          </div>
          <select className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
            <option>All Statuses</option>
            <option>Active</option>
            <option>Inactive</option>
            <option>Suspended</option>
          </select>
          <select className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
            <option>Sort: Newest</option>
            <option>Sort: Oldest</option>
            <option>Sort: Name A-Z</option>
            <option>Sort: Name Z-A</option>
          </select>
        </div>

        {/* Venues List */}
        <div className="space-y-4">
          {venues.length === 0 ? (
            <motion.div
              className="glass-card p-12 text-center"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <h3 className="text-xl font-bold text-white mb-2">No Venues Yet</h3>
              <p className="text-gray-400 mb-6">Create your first venue to get started</p>
              <button onClick={() => setShowCreateModal(true)} className="btn-primary">
                <Plus className="w-4 h-4 inline mr-2" />
                Create First Venue
              </button>
            </motion.div>
          ) : (
            venues.map((venue, index) => (
              <motion.div
                key={venue.id}
                className="glass-card p-6 hover:border-purple-500/30 transition-all"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-white">{venue.name}</h3>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        venue.status === 'active' 
                          ? 'bg-green-500/20 text-green-400' 
                          : venue.status === 'inactive'
                          ? 'bg-gray-500/20 text-gray-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {venue.status === 'active' ? '✅ Active' : venue.status === 'inactive' ? '⚪ Inactive' : '⛔ Suspended'}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400 mb-3">
                      ID: <span className="text-purple-400 font-mono">{venue.venueId}</span> · 
                      Created: {venue.createdDate}
                    </div>
                  </div>
                  <button className="p-2 hover:bg-white/5 rounded transition-colors">
                    <MoreVertical className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-cyan-400" />
                    <div>
                      <div className="text-white font-semibold">{venue.locations}</div>
                      <div className="text-xs text-gray-400">Locations</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-green-400" />
                    <div>
                      <div className="text-white font-semibold">{venue.users}</div>
                      <div className="text-xs text-gray-400">Users</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-purple-400" />
                    <div>
                      <div className="text-white font-semibold">{venue.devices}</div>
                      <div className="text-xs text-gray-400">Devices</div>
                    </div>
                  </div>
                </div>

                {/* Info */}
                <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/10">
                  <div>
                    <div className="text-sm text-gray-400">Plan</div>
                    <div className="text-white font-medium">{venue.plan}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400">Last Data</div>
                    <div className="text-white font-medium">{venue.lastData}</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button className="btn-secondary text-sm flex-1">
                    <Eye className="w-4 h-4 inline mr-2" />
                    View Details
                  </button>
                  <button className="btn-secondary text-sm flex-1">
                    <Edit className="w-4 h-4 inline mr-2" />
                    Edit
                  </button>
                  <button className="btn-primary text-sm flex-1">
                    <FileDown className="w-4 h-4 inline mr-2" />
                    RPi Config
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {/* Create Venue Modal */}
      {showCreateModal && (
        <CreateVenueModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateVenue}
        />
      )}
    </div>
  );
}
