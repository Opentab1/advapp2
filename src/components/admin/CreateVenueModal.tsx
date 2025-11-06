import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Building2, MapPin, Mail, User, Wifi, CheckCircle } from 'lucide-react';

interface CreateVenueModalProps {
  onClose: () => void;
  onCreate: (venueData: VenueFormData) => void;
}

export interface VenueFormData {
  venueName: string;
  venueId: string;
  locationName: string;
  locationId: string;
  address: string;
  timezone: string;
  ownerEmail: string;
  ownerName: string;
  deviceId: string;
  mqttTopic: string;
  features: {
    songDetection: boolean;
    occupancy: boolean;
    aiInsights: boolean;
    predictiveAnalytics: boolean;
    revenueCorrelation: boolean;
  };
}

export function CreateVenueModal({ onClose, onCreate }: CreateVenueModalProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<VenueFormData>({
    venueName: '',
    venueId: '',
    locationName: 'Main Floor',
    locationId: 'mainfloor',
    address: '',
    timezone: 'America/New_York',
    ownerEmail: '',
    ownerName: '',
    deviceId: '',
    mqttTopic: '',
    features: {
      songDetection: true,
      occupancy: true,
      aiInsights: true,
      predictiveAnalytics: true,
      revenueCorrelation: false
    }
  });

  // Auto-generate IDs
  const handleVenueNameChange = (name: string) => {
    const venueId = name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20) || 'venue';
    const deviceId = `rpi-${venueId}-001`;
    const mqttTopic = `pulse/sensors/${venueId}`;
    
    setFormData({
      ...formData,
      venueName: name,
      venueId,
      deviceId,
      mqttTopic
    });
  };

  const handleSubmit = () => {
    // Validate
    if (!formData.venueName || !formData.ownerEmail || !formData.ownerName) {
      alert('Please fill in all required fields');
      return;
    }
    
    onCreate(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        className="bg-gray-900 border border-purple-500/30 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600/20 to-blue-600/20 border-b border-purple-500/30 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-purple-400" />
            <div>
              <h2 className="text-2xl font-bold text-white">Create New Venue</h2>
              <p className="text-gray-400 text-sm">Set up a new client venue in 3 steps</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded transition-colors">
            <X className="w-6 h-6 text-gray-400" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            {['Venue Info', 'Owner Account', 'Device Config'].map((label, index) => (
              <div key={index} className="flex items-center">
                <div className={`flex items-center gap-2 ${index + 1 <= step ? 'text-purple-400' : 'text-gray-600'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                    index + 1 < step 
                      ? 'bg-green-500/20 text-green-400 border-2 border-green-500' 
                      : index + 1 === step
                      ? 'bg-purple-500/20 text-purple-400 border-2 border-purple-500'
                      : 'bg-gray-800 text-gray-600 border-2 border-gray-700'
                  }`}>
                    {index + 1 < step ? '✓' : index + 1}
                  </div>
                  <span className="text-sm font-medium hidden md:block">{label}</span>
                </div>
                {index < 2 && <div className={`w-12 lg:w-24 h-0.5 mx-2 ${index + 1 < step ? 'bg-green-500' : 'bg-gray-700'}`}></div>}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-250px)]">
          {/* Step 1: Venue Info */}
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Venue Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.venueName}
                  onChange={(e) => handleVenueNameChange(e.target.value)}
                  placeholder="e.g., Ferg's Sports Bar"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Venue ID (Auto-generated)
                </label>
                <input
                  type="text"
                  value={formData.venueId}
                  disabled
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">Auto-generated from venue name</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Primary Location Name
                </label>
                <input
                  type="text"
                  value={formData.locationName}
                  onChange={(e) => setFormData({ ...formData, locationName: e.target.value })}
                  placeholder="e.g., Main Floor, Downtown Location"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Address
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="123 Main St, City, State"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Timezone
                </label>
                <select
                  value={formData.timezone}
                  onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 text-white"
                >
                  <option value="America/New_York">Eastern Time (ET)</option>
                  <option value="America/Chicago">Central Time (CT)</option>
                  <option value="America/Denver">Mountain Time (MT)</option>
                  <option value="America/Los_Angeles">Pacific Time (PT)</option>
                </select>
              </div>
            </motion.div>
          )}

          {/* Step 2: Owner Account */}
          {step === 2 && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Owner Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={formData.ownerEmail}
                  onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })}
                  placeholder="owner@venue.com"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Owner Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.ownerName}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                  placeholder="John Smith"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 text-white"
                />
              </div>

              <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-sm text-blue-300 mb-2">
                  <strong>Note:</strong> The owner will receive an email invitation with:
                </p>
                <ul className="text-xs text-blue-300/80 space-y-1 ml-4 list-disc">
                  <li>Temporary password</li>
                  <li>Login instructions</li>
                  <li>Setup guide</li>
                </ul>
              </div>
            </motion.div>
          )}

          {/* Step 3: Device Configuration */}
          {step === 3 && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Device ID (Auto-generated)
                </label>
                <input
                  type="text"
                  value={formData.deviceId}
                  disabled
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed font-mono"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  MQTT Topic (Auto-generated)
                </label>
                <input
                  type="text"
                  value={formData.mqttTopic}
                  disabled
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-gray-400 cursor-not-allowed font-mono"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-4">
                  Enabled Features
                </label>
                <div className="space-y-3">
                  {[
                    { key: 'songDetection' as const, label: 'Song Detection', sublabel: 'Identify songs via Shazam' },
                    { key: 'occupancy' as const, label: 'Occupancy Tracking', sublabel: 'Track customer counts' },
                    { key: 'aiInsights' as const, label: 'AI Insights', sublabel: 'Smart recommendations' },
                    { key: 'predictiveAnalytics' as const, label: 'Predictive Analytics', sublabel: 'Occupancy forecasting' },
                    { key: 'revenueCorrelation' as const, label: 'Revenue Correlation', sublabel: 'Premium feature' }
                  ].map((feature) => (
                    <div key={feature.key} className="flex items-center justify-between p-3 bg-white/5 rounded">
                      <div>
                        <div className="text-white text-sm font-medium">{feature.label}</div>
                        <div className="text-xs text-gray-400">{feature.sublabel}</div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.features[feature.key]}
                          onChange={(e) => setFormData({
                            ...formData,
                            features: { ...formData.features, [feature.key]: e.target.checked }
                          })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:bg-purple-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-green-300 font-medium mb-2">
                      Ready to Create!
                    </p>
                    <p className="text-xs text-green-300/80">
                      When you click "Create Venue", we'll:
                    </p>
                    <ul className="text-xs text-green-300/70 space-y-1 ml-4 mt-2 list-disc">
                      <li>Create venue in DynamoDB</li>
                      <li>Create Cognito user account</li>
                      <li>Generate RPi configuration file</li>
                      <li>Send email invitation to owner</li>
                      <li>Log action in audit trail</li>
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 p-6 flex items-center justify-between">
          <div className="text-sm text-gray-400">
            Step {step} of 3
          </div>
          <div className="flex gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="btn-secondary px-6 py-2"
              >
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && (!formData.venueName || !formData.venueId)}
                className="btn-primary px-6 py-2 disabled:opacity-50"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                className="btn-primary px-6 py-2"
              >
                Create Venue & Send Invite
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
