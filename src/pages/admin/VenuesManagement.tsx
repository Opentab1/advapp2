/**
 * VenuesManagement - Admin venue management page
 * 
 * Features:
 * - List all venues with status
 * - Create new venue
 * - Edit venue details
 * - Suspend/activate venues
 * - Generate RPi config
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Building2, 
  Plus, 
  Search, 
  MoreVertical,
  MapPin,
  Users,
  Wifi,
  Edit,
  FileDown,
  Eye,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Ban,
  Settings,
  X,
  Save,
  Mail,
  User,
  Phone,
  MessageSquare,
  Copy,
  Smartphone,
  Zap
} from 'lucide-react';
import { CreateVenueModal, VenueFormData } from '../../components/admin/CreateVenueModal';
import { RPiConfigGenerator } from '../../components/admin/RPiConfigGenerator';
import adminService, { AdminVenue, CreateVenueInput } from '../../services/admin.service';

// Display settings stored separately from system data
interface VenueDisplaySettings {
  displayName?: string;
  ownerName?: string;
  ownerEmail?: string;
  // NFC Lead Capture Settings
  twilioPhoneNumber?: string;
  welcomeMessage?: string;
  returnMessage?: string;
  nfcEnabled?: boolean;
}

// API endpoint for display settings
const DISPLAY_SETTINGS_API = 'https://7ox6y1t1f1.execute-api.us-east-2.amazonaws.com/display-settings';

export function VenuesManagement() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'suspended'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showConfigGenerator, setShowConfigGenerator] = useState<AdminVenue | null>(null);
  const [showEditModal, setShowEditModal] = useState<AdminVenue | null>(null);
  const [, setIsCreating] = useState(false);
  const [venues, setVenues] = useState<AdminVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displaySettings, setDisplaySettings] = useState<Record<string, VenueDisplaySettings>>({});

  // Load display settings from API
  const fetchDisplaySettings = useCallback(async () => {
    try {
      const response = await fetch(DISPLAY_SETTINGS_API);
      if (response.ok) {
        const data = await response.json();
        setDisplaySettings(data);
      }
    } catch (err) {
      console.error('Failed to fetch display settings:', err);
    }
  }, []);

  useEffect(() => {
    fetchDisplaySettings();
  }, [fetchDisplaySettings]);

  const saveDisplaySettings = async (venueId: string, settings: VenueDisplaySettings): Promise<boolean> => {
    try {
      const response = await fetch(`${DISPLAY_SETTINGS_API}/${venueId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (response.ok) {
        // Update local state
        setDisplaySettings(prev => ({ ...prev, [venueId]: settings }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to save display settings:', err);
      return false;
    }
  };

  // Fetch venues
  const fetchVenues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const venueList = await adminService.listVenues();
      setVenues(venueList);
    } catch (err: any) {
      console.error('Failed to fetch venues:', err);
      setError(err.message || 'Failed to load venues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  // Filter and sort venues
  const filteredVenues = venues
    .filter(venue => {
      // Status filter
      if (statusFilter !== 'all' && venue.status !== statusFilter) return false;
      
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          venue.venueName.toLowerCase().includes(search) ||
          venue.venueId.toLowerCase().includes(search) ||
          (venue.locationName?.toLowerCase().includes(search))
        );
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        case 'oldest':
          return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        case 'name':
          return a.venueName.localeCompare(b.venueName);
        default:
          return 0;
      }
    });

  // Handle venue creation
  const handleCreateVenue = async (venueData: VenueFormData) => {
    setIsCreating(true);
    try {
      const input: CreateVenueInput = {
        venueName: venueData.venueName,
        venueId: venueData.venueId,
        locationName: venueData.locationName,
        locationId: venueData.locationId,
        ownerEmail: venueData.ownerEmail,
        ownerName: venueData.ownerName,
      };

      const result = await adminService.createVenue(input);

      if (result.success) {
        alert(`✅ Venue "${venueData.venueName}" created successfully!\n\nOwner: ${venueData.ownerEmail}\nTemporary Password: ${result.tempPassword}\n\n⚠️ Save this password! The owner will need it to login.`);
        setShowCreateModal(false);
        fetchVenues(); // Refresh list
      } else {
        alert(`❌ Error: ${result.message}`);
      }
    } catch (error: any) {
      console.error('Failed to create venue:', error);
      alert(`❌ Failed to create venue: ${error.message || 'Unknown error'}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle venue status update
  const handleStatusChange = async (venueId: string, newStatus: 'active' | 'suspended') => {
    const success = await adminService.updateVenueStatus(venueId, newStatus);
    if (success) {
      fetchVenues();
    } else {
      alert('Failed to update venue status. This action requires the updateVenueStatus resolver.');
    }
  };

  // Generate config
  const handleGenerateConfig = (venue: AdminVenue) => {
    setShowConfigGenerator(venue);
  };

  // Format date
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Unknown';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  // Get status icon
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
            <CheckCircle className="w-3 h-3" />
            Active
          </span>
        );
      case 'suspended':
        return (
          <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400">
            <Ban className="w-3 h-3" />
            Suspended
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-500/20 text-gray-400">
            <XCircle className="w-3 h-3" />
            Inactive
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
            <h1 className="text-3xl font-bold gradient-text mb-2">🏢 Venues Management</h1>
            <p className="text-gray-400">
              {loading ? 'Loading...' : `${venues.length} venue${venues.length !== 1 ? 's' : ''} total`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              onClick={fetchVenues}
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
              Create New Venue
            </motion.button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search venues..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
            />
          </div>
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
          <select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
          >
            <option value="newest">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
            <option value="name">Sort: Name A-Z</option>
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
            <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!loading && venues.length === 0 && (
          <motion.div
            className="glass-card p-12 text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold text-white mb-2">No Venues Found</h3>
            <p className="text-gray-400 mb-4">
              {searchTerm || statusFilter !== 'all' 
                ? 'No venues match your filters' 
                : 'Create your first venue to get started'}
            </p>
            {!searchTerm && statusFilter === 'all' && (
              <>
                <button onClick={() => setShowCreateModal(true)} className="btn-primary mb-4">
                  <Plus className="w-4 h-4 inline mr-2" />
                  Create First Venue
                </button>
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-left max-w-md mx-auto">
                  <div className="flex items-start gap-2">
                    <Settings className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-yellow-300">
                      If venues exist but aren't showing, the <code className="text-yellow-400">listAllVenues</code> GraphQL resolver needs to be deployed.
                    </p>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* Venues List */}
        {!loading && filteredVenues.length > 0 && (
          <div className="space-y-4">
            {filteredVenues.map((venue, index) => (
              <motion.div
                key={venue.venueId}
                className="glass-card p-6 hover:border-purple-500/30 transition-all"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-white">
                        {displaySettings[venue.venueId]?.displayName || venue.venueName}
                      </h3>
                      {getStatusBadge(venue.status)}
                    </div>
                    <div className="text-sm text-gray-400 mb-1">
                      ID: <span className="text-purple-400 font-mono">{venue.venueId}</span>
                      {displaySettings[venue.venueId]?.displayName && (
                        <span className="ml-2 text-gray-500">(System: {venue.venueName})</span>
                      )}
                    </div>
                    {/* Owner Info */}
                    {(displaySettings[venue.venueId]?.ownerName || displaySettings[venue.venueId]?.ownerEmail) && (
                      <div className="flex items-center gap-4 text-sm text-gray-400 mb-1">
                        {displaySettings[venue.venueId]?.ownerName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {displaySettings[venue.venueId]?.ownerName}
                          </span>
                        )}
                        {displaySettings[venue.venueId]?.ownerEmail && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {displaySettings[venue.venueId]?.ownerEmail}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Created: {formatDate(venue.createdAt)}
                      </span>
                      {venue.lastDataTimestamp && (
                        <span className="flex items-center gap-1">
                          <Wifi className="w-3 h-3" />
                          Last data: {formatDate(venue.lastDataTimestamp)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button className="p-2 hover:bg-white/5 rounded transition-colors">
                    <MoreVertical className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-cyan-400" />
                    <div>
                      <div className="text-white font-semibold">{venue.locationName || 'Main'}</div>
                      <div className="text-xs text-gray-400">Location</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-green-400" />
                    <div>
                      <div className="text-white font-semibold">{venue.userCount || 0}</div>
                      <div className="text-xs text-gray-400">Users</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-purple-400" />
                    <div>
                      <div className="text-white font-semibold">{venue.deviceCount || 0}</div>
                      <div className="text-xs text-gray-400">Devices</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Smartphone className={`w-4 h-4 ${displaySettings[venue.venueId]?.twilioPhoneNumber ? 'text-green-400' : 'text-gray-600'}`} />
                    <div>
                      <div className={`font-semibold ${displaySettings[venue.venueId]?.twilioPhoneNumber ? 'text-white' : 'text-gray-500'}`}>
                        {displaySettings[venue.venueId]?.twilioPhoneNumber ? 'Active' : 'Not Set'}
                      </div>
                      <div className="text-xs text-gray-400">NFC Leads</div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary text-sm flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    View
                  </button>
                  <button 
                    onClick={() => setShowEditModal(venue)}
                    className="btn-secondary text-sm flex items-center gap-1"
                  >
                    <Edit className="w-4 h-4" />
                    Edit Display
                  </button>
                  <button 
                    onClick={() => handleGenerateConfig(venue)}
                    className="btn-primary text-sm flex items-center gap-1"
                  >
                    <FileDown className="w-4 h-4" />
                    RPi Config
                  </button>
                  {venue.status === 'active' ? (
                    <button 
                      onClick={() => handleStatusChange(venue.venueId, 'suspended')}
                      className="btn-secondary text-sm flex items-center gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10"
                    >
                      <Ban className="w-4 h-4" />
                      Suspend
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleStatusChange(venue.venueId, 'active')}
                      className="btn-secondary text-sm flex items-center gap-1 text-green-400 border-green-500/30 hover:bg-green-500/10"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Activate
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Create Venue Modal */}
      {showCreateModal && (
        <CreateVenueModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateVenue}
        />
      )}

      {/* RPi Config Generator */}
      {showConfigGenerator && (
        <RPiConfigGenerator
          onClose={() => setShowConfigGenerator(null)}
          venueId={showConfigGenerator.venueId}
          venueName={showConfigGenerator.venueName}
          locationId={showConfigGenerator.locationId || 'mainfloor'}
          locationName={showConfigGenerator.locationName || 'Main Floor'}
          deviceId={`rpi-${showConfigGenerator.venueId}-001`}
          mqttTopic={showConfigGenerator.mqttTopic || `pulse/sensors/${showConfigGenerator.venueId}`}
        />
      )}

      {/* Edit Display Settings Modal */}
      <AnimatePresence>
        {showEditModal && (
          <EditDisplayModal
            venue={showEditModal}
            currentSettings={displaySettings[showEditModal.venueId] || {}}
            onClose={() => setShowEditModal(null)}
            onSave={async (settings) => {
              const success = await saveDisplaySettings(showEditModal.venueId, settings);
              if (success) {
                setShowEditModal(null);
              } else {
                alert('Failed to save display settings. Please try again.');
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Edit Display Settings Modal
function EditDisplayModal({
  venue,
  currentSettings,
  onClose,
  onSave
}: {
  venue: AdminVenue;
  currentSettings: VenueDisplaySettings;
  onClose: () => void;
  onSave: (settings: VenueDisplaySettings) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(currentSettings.displayName || '');
  const [ownerName, setOwnerName] = useState(currentSettings.ownerName || '');
  const [ownerEmail, setOwnerEmail] = useState(currentSettings.ownerEmail || '');
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState(currentSettings.twilioPhoneNumber || '');
  const [welcomeMessage, setWelcomeMessage] = useState(currentSettings.welcomeMessage || '');
  const [returnMessage, setReturnMessage] = useState(currentSettings.returnMessage || '');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'nfc'>('basic');
  const [copied, setCopied] = useState(false);

  // Format phone number as user types
  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    // With country code
    if (digits.startsWith('1')) {
      return `+1-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
    }
    return `+${digits.slice(0, 1)}-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  };

  // Generate NFC tag URL
  const getNfcTagUrl = (location: string = 'TABLE1') => {
    if (!twilioPhoneNumber) return '';
    const cleanNumber = twilioPhoneNumber.replace(/\D/g, '');
    const formattedNumber = cleanNumber.startsWith('1') ? `+${cleanNumber}` : `+1${cleanNumber}`;
    return `sms:${formattedNumber}?body=JOIN ${location.toUpperCase()}`;
  };

  const copyNfcUrl = (location: string) => {
    const url = getNfcTagUrl(location);
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        displayName: displayName.trim() || undefined,
        ownerName: ownerName.trim() || undefined,
        ownerEmail: ownerEmail.trim() || undefined,
        twilioPhoneNumber: twilioPhoneNumber.trim() || undefined,
        welcomeMessage: welcomeMessage.trim() || undefined,
        returnMessage: returnMessage.trim() || undefined,
        nfcEnabled: !!twilioPhoneNumber.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass-card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-white">Venue Settings</h3>
            <p className="text-sm text-gray-400 mt-1">
              <span className="text-purple-400 font-mono">{venue.venueId}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('basic')}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'basic'
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
            }`}
          >
            <Building2 className="w-4 h-4 inline mr-2" />
            Basic Info
          </button>
          <button
            onClick={() => setActiveTab('nfc')}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'nfc'
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
            }`}
          >
            <Smartphone className="w-4 h-4 inline mr-2" />
            NFC Leads
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info Tab */}
          {activeTab === 'basic' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  <Building2 className="w-4 h-4 inline mr-1" />
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={venue.venueName}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  <User className="w-4 h-4 inline mr-1" />
                  Owner Name
                </label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="e.g., John Smith"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  <Mail className="w-4 h-4 inline mr-1" />
                  Owner Email
                </label>
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="e.g., owner@venue.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>
            </>
          )}

          {/* NFC Leads Tab */}
          {activeTab === 'nfc' && (
            <>
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-5 h-5 text-green-400" />
                  <span className="font-semibold text-green-400">NFC Lead Capture</span>
                </div>
                <p className="text-sm text-gray-300">
                  Customers tap NFC tag → SMS opens pre-filled → They hit Send → Lead captured!
                </p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  <Phone className="w-4 h-4 inline mr-1" />
                  Twilio Phone Number *
                </label>
                <input
                  type="tel"
                  value={twilioPhoneNumber}
                  onChange={(e) => setTwilioPhoneNumber(formatPhone(e.target.value))}
                  placeholder="+1-512-555-1234"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Get a number from <a href="https://console.twilio.com/phone-numbers" target="_blank" rel="noopener noreferrer" className="text-green-400 underline">Twilio Console</a> (~$1/month)
                </p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  <MessageSquare className="w-4 h-4 inline mr-1" />
                  Welcome Message
                </label>
                <textarea
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder={`Welcome to ${displayName || venue.venueName}! We'll text you about specials & events. Reply STOP anytime.`}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">Sent to new subscribers</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  <MessageSquare className="w-4 h-4 inline mr-1" />
                  Return Visitor Message
                </label>
                <textarea
                  value={returnMessage}
                  onChange={(e) => setReturnMessage(e.target.value)}
                  placeholder="Welcome back! You're already on our VIP list."
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500/50 resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">Sent to returning subscribers</p>
              </div>

              {/* NFC Tag URLs */}
              {twilioPhoneNumber && (
                <div className="border-t border-white/10 pt-4 mt-4">
                  <label className="block text-sm text-gray-400 mb-3">
                    <Smartphone className="w-4 h-4 inline mr-1" />
                    NFC Tag URLs (copy & program)
                  </label>
                  <div className="space-y-2">
                    {['TABLE1', 'TABLE2', 'BAR', 'PATIO'].map((location) => (
                      <div key={location} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-16">{location}:</span>
                        <code className="flex-1 text-xs bg-black/30 px-2 py-1.5 rounded text-green-400 font-mono truncate">
                          {getNfcTagUrl(location)}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyNfcUrl(location)}
                          className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {copied && (
                    <p className="text-xs text-green-400 mt-2 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Copied to clipboard!
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-3">
                    Use NFC Tools app to write these URLs to your tags
                  </p>
                </div>
              )}
            </>
          )}

          <div className="flex gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 btn-primary flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
