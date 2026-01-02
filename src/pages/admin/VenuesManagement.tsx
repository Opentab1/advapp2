import { useState, useEffect } from 'react';
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
  FileDown,
  Eye
} from 'lucide-react';
import { CreateVenueModal, VenueFormData } from '../../components/admin/CreateVenueModal';
import { RPiConfigGenerator } from '../../components/admin/RPiConfigGenerator';
import apiService from '../../services/api.service';

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
  const [showConfigGenerator, setShowConfigGenerator] = useState<Venue | null>(null);
  const [, setIsCreating] = useState(false);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [, setLoadingVenues] = useState(true);

  const handleCreateVenue = async (venueData: VenueFormData) => {
    setIsCreating(true);
    try {
      // Call API to create venue with auto password generation
      // Password must have: uppercase, lowercase, numbers, special chars
      const randomStr = Math.random().toString(36).slice(2, 10);
      const randomNum = Math.floor(Math.random() * 900) + 100; // 3-digit number
      const tempPassword = `Temp${randomNum}${randomStr}!`;
      
      const result = await apiService.createVenue({
        venueName: venueData.venueName,
        venueId: venueData.venueId,
        locationName: venueData.locationName,
        locationId: venueData.locationId,
        ownerEmail: venueData.ownerEmail,
        ownerName: venueData.ownerName,
        tempPassword: tempPassword
      });

      console.log('🔍 API Result:', result);
      console.log('🔍 tempPassword from result:', result.tempPassword);
      console.log('🔍 deviceData from result:', result.deviceData);

      if (result.success) {
        // Download certificates if available
        if (result.deviceData?.credentials) {
          downloadCertificatesZip(result);
        }
        
        alert(`✅ Venue "${venueData.venueName}" created successfully!\n\nOwner: ${venueData.ownerEmail}\nTemporary Password: ${tempPassword}\n\n⚠️ Save this password! The owner will need it to login.\n\n📥 Certificate package has been downloaded!`);
        
        // Close modal
        setShowCreateModal(false);
        
        // Refresh venues list (when API is connected)
        // TODO: Fetch real venues from DynamoDB/API
        console.log('✅ Venue created, list should refresh here');
      } else {
        alert(`❌ Error: ${result.message || 'Failed to create venue'}`);
      }
    } catch (error: any) {
      console.error('Failed to create venue:', error);
      alert(`❌ Failed to create venue: ${error.message || 'Unknown error'}`);
    } finally {
      setIsCreating(false);
    }
  };

  const downloadCertificatesZip = (venueResult: any) => {
    try {
      const { venueId, deviceData } = venueResult;
      const { credentials, deviceId, iotEndpoint, mqttTopic } = deviceData;
      
      // Create certificate files content
      const files = {
        'certificates/certificate.pem.crt': credentials.certificatePem,
        'certificates/private.pem.key': credentials.privateKey,
        'certificates/public.pem.key': credentials.publicKey,
        'certificates/root-CA.crt': credentials.rootCA,
        'config.json': JSON.stringify({
          venueId,
          deviceId,
          iotEndpoint,
          mqttTopic,
          publishInterval: 15,
          version: '2.0.0'
        }, null, 2),
        'venue-info.json': JSON.stringify({
          venueId,
          venueName: venueResult.venueName || venueId,
          deviceId,
          iotEndpoint,
          mqttTopic,
          createdAt: new Date().toISOString()
        }, null, 2),
        'INSTRUCTIONS.txt': `Pulse Dashboard - Raspberry Pi Setup Instructions

Venue: ${venueId}
Device: ${deviceId}

SETUP STEPS:
============

1. Extract this ZIP to your Raspberry Pi

2. Move certificates to the correct location:
   mkdir -p /home/pi/certs
   mv certificates/* /home/pi/certs/

3. Update your Python script with these values:
   VENUE_ID = "${venueId}"
   DEVICE_ID = "${deviceId}"
   IOT_ENDPOINT = "${iotEndpoint}"
   MQTT_TOPIC = "${mqttTopic}"
   CERT_PATH = "/home/pi/certs/certificate.pem.crt"
   PRIVATE_KEY_PATH = "/home/pi/certs/private.pem.key"
   ROOT_CA_PATH = "/home/pi/certs/root-CA.crt"

4. Run your sensor publisher script

For support: support@advizia.ai
`
      };
      
      // Create a simple text-based "ZIP" (actually a tar-like bundle)
      // For a real ZIP, you'd need JSZip library
      // For now, let's download individual files or use a JSON bundle
      
      // Create a combined JSON bundle for now
      const bundle = {
        venueId,
        deviceId,
        files: files,
        metadata: {
          createdAt: new Date().toISOString(),
          venueId,
          deviceId,
          iotEndpoint,
          mqttTopic
        }
      };
      
      const bundleJson = JSON.stringify(bundle, null, 2);
      const blob = new Blob([bundleJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pulse-${venueId}-certificates.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('✅ Certificate bundle downloaded');
    } catch (error) {
      console.error('Failed to download certificates:', error);
      alert('⚠️ Venue created but failed to download certificates. Please contact support.');
    }
  };

  const handleGenerateConfig = (venue: Venue) => {
    setShowConfigGenerator(venue);
  };

  // Fetch real venues from DynamoDB
  const fetchVenues = async () => {
    setLoadingVenues(true);
    try {
      // For now, we need to implement a GraphQL query or use DynamoDB scan
      // Temporarily show empty list - will be implemented properly next
      // TODO: Add proper GraphQL query to list all venues from VenueConfig
      console.log('TODO: Fetch real venues from DynamoDB VenueConfig table');
      setVenues([]);
    } catch (error) {
      console.error('Failed to fetch venues:', error);
      setVenues([]);
    } finally {
      setLoadingVenues(false);
    }
  };

  // Load venues on mount
  useEffect(() => {
    fetchVenues();
  }, []);

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
                  <button 
                    onClick={() => handleGenerateConfig(venue)}
                    className="btn-primary text-sm flex-1"
                  >
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

      {/* RPi Config Generator */}
      {showConfigGenerator && (
        <RPiConfigGenerator
          onClose={() => setShowConfigGenerator(null)}
          venueId={showConfigGenerator.venueId}
          venueName={showConfigGenerator.name}
          locationId="mainfloor"
          locationName="Main Floor"
          deviceId={`rpi-${showConfigGenerator.venueId}-001`}
          mqttTopic={`pulse/sensors/${showConfigGenerator.venueId}`}
        />
      )}
    </div>
  );
}
