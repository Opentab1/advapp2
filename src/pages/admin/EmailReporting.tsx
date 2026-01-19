import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Mail, Send, Clock, Users, CheckCircle, XCircle, RefreshCw,
  Plus, Trash2, Eye, ChevronDown, Calendar, AlertCircle
} from 'lucide-react';
import adminService from '../../services/admin.service';

interface EmailConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  reportType: 'full' | 'summary' | 'alerts';
  lastSentAt?: string;
}

interface VenueWithEmail {
  venueId: string;
  venueName: string;
  ownerEmail?: string;
  emailConfig?: EmailConfig;
}

export function EmailReporting() {
  const [venues, setVenues] = useState<VenueWithEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedVenue, setExpandedVenue] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState<{ [venueId: string]: string }>({});
  // Preview modal state (to be implemented)
  const [, setPreviewVenue] = useState<string | null>(null);

  const loadVenues = useCallback(async () => {
    setLoading(true);
    try {
      const allVenues = await adminService.getAllVenues();
      setVenues(allVenues.map(v => ({
        venueId: v.venueId,
        venueName: v.venueName,
        ownerEmail: v.ownerEmail,
        emailConfig: v.emailConfig || {
          enabled: false,
          frequency: 'weekly',
          recipients: v.ownerEmail ? [v.ownerEmail] : [],
          reportType: 'full'
        }
      })));
    } catch (error) {
      console.error('Error loading venues:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  const handleToggleEnabled = async (venueId: string) => {
    const venue = venues.find(v => v.venueId === venueId);
    if (!venue?.emailConfig) return;

    const newConfig = { ...venue.emailConfig, enabled: !venue.emailConfig.enabled };
    await saveEmailConfig(venueId, newConfig);
  };

  const handleFrequencyChange = async (venueId: string, frequency: 'daily' | 'weekly' | 'monthly') => {
    const venue = venues.find(v => v.venueId === venueId);
    if (!venue?.emailConfig) return;

    const newConfig = { ...venue.emailConfig, frequency };
    await saveEmailConfig(venueId, newConfig);
  };

  const handleReportTypeChange = async (venueId: string, reportType: 'full' | 'summary' | 'alerts') => {
    const venue = venues.find(v => v.venueId === venueId);
    if (!venue?.emailConfig) return;

    const newConfig = { ...venue.emailConfig, reportType };
    await saveEmailConfig(venueId, newConfig);
  };

  const handleAddRecipient = async (venueId: string) => {
    const email = newEmail[venueId]?.trim();
    if (!email || !email.includes('@')) return;

    const venue = venues.find(v => v.venueId === venueId);
    if (!venue?.emailConfig) return;

    if (venue.emailConfig.recipients.includes(email)) return;

    const newConfig = {
      ...venue.emailConfig,
      recipients: [...venue.emailConfig.recipients, email]
    };
    await saveEmailConfig(venueId, newConfig);
    setNewEmail(prev => ({ ...prev, [venueId]: '' }));
  };

  const handleRemoveRecipient = async (venueId: string, email: string) => {
    const venue = venues.find(v => v.venueId === venueId);
    if (!venue?.emailConfig) return;

    const newConfig = {
      ...venue.emailConfig,
      recipients: venue.emailConfig.recipients.filter(r => r !== email)
    };
    await saveEmailConfig(venueId, newConfig);
  };

  const saveEmailConfig = async (venueId: string, config: EmailConfig) => {
    setSaving(venueId);
    try {
      await adminService.updateVenueEmailConfig(venueId, config);
      setVenues(prev => prev.map(v =>
        v.venueId === venueId ? { ...v, emailConfig: config } : v
      ));
    } catch (error) {
      console.error('Error saving email config:', error);
    } finally {
      setSaving(null);
    }
  };

  const handleSendTestEmail = async (venueId: string) => {
    const venue = venues.find(v => v.venueId === venueId);
    if (!venue?.emailConfig?.recipients.length) {
      alert('Please add at least one recipient first');
      return;
    }

    setSaving(venueId);
    try {
      await adminService.sendTestEmail(venueId);
      alert('Test email sent successfully!');
    } catch (error) {
      console.error('Error sending test email:', error);
      alert('Failed to send test email. Check console for details.');
    } finally {
      setSaving(null);
    }
  };

  const enabledCount = venues.filter(v => v.emailConfig?.enabled).length;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Mail className="w-7 h-7 text-primary" />
              Email Reporting
            </h1>
            <p className="text-warm-400 text-sm mt-1">
              Configure automated weekly reports for venue owners
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-2xl font-bold text-primary">{enabledCount}</div>
              <div className="text-xs text-warm-400">Venues with reports enabled</div>
            </div>
            <motion.button
              onClick={loadVenues}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </motion.button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="glass-card p-4 mb-6 border-l-4 border-primary">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-white">How Email Reports Work</h3>
              <p className="text-sm text-warm-400 mt-1">
                Reports are sent automatically based on each venue's schedule. All data in emails
                is 100% based on real sensor data — no fabricated metrics.
              </p>
            </div>
          </div>
        </div>

        {/* Venues List */}
        <div className="space-y-4">
          {loading ? (
            <div className="glass-card p-12 text-center">
              <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
              <p className="text-warm-400">Loading venues...</p>
            </div>
          ) : venues.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <Users className="w-12 h-12 text-warm-600 mx-auto mb-3" />
              <p className="text-warm-400">No venues found</p>
            </div>
          ) : (
            venues.map(venue => (
              <motion.div
                key={venue.venueId}
                className="glass-card overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {/* Venue Header */}
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-warm-800/50 transition-colors"
                  onClick={() => setExpandedVenue(expandedVenue === venue.venueId ? null : venue.venueId)}
                >
                  <div className="flex items-center gap-4">
                    {/* Enable/Disable Toggle */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleEnabled(venue.venueId);
                      }}
                      disabled={saving === venue.venueId}
                      className={`w-12 h-6 rounded-full transition-colors relative ${
                        venue.emailConfig?.enabled ? 'bg-emerald-500' : 'bg-warm-700'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${
                          venue.emailConfig?.enabled ? 'translate-x-6' : 'translate-x-0.5'
                        }`}
                      />
                    </button>

                    <div>
                      <h3 className="font-medium text-white">{venue.venueName}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        {venue.emailConfig?.enabled ? (
                          <>
                            <CheckCircle className="w-3 h-3 text-emerald-400" />
                            <span className="text-xs text-emerald-400">
                              {venue.emailConfig.frequency} reports enabled
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 text-warm-500" />
                            <span className="text-xs text-warm-500">Reports disabled</span>
                          </>
                        )}
                        {venue.emailConfig?.recipients.length ? (
                          <span className="text-xs text-warm-400">
                            • {venue.emailConfig.recipients.length} recipient(s)
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {saving === venue.venueId && (
                      <RefreshCw className="w-4 h-4 text-primary animate-spin" />
                    )}
                    <ChevronDown
                      className={`w-5 h-5 text-warm-400 transition-transform ${
                        expandedVenue === venue.venueId ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </div>

                {/* Expanded Settings */}
                {expandedVenue === venue.venueId && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-warm-700 p-4 bg-warm-800/30"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Frequency */}
                      <div>
                        <label className="block text-sm font-medium text-warm-300 mb-2">
                          <Clock className="w-4 h-4 inline mr-2" />
                          Report Frequency
                        </label>
                        <div className="flex gap-2">
                          {(['daily', 'weekly', 'monthly'] as const).map(freq => (
                            <button
                              key={freq}
                              onClick={() => handleFrequencyChange(venue.venueId, freq)}
                              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                venue.emailConfig?.frequency === freq
                                  ? 'bg-primary/20 text-primary border border-primary/30'
                                  : 'bg-warm-700 text-warm-400 hover:bg-warm-600'
                              }`}
                            >
                              {freq.charAt(0).toUpperCase() + freq.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Report Type */}
                      <div>
                        <label className="block text-sm font-medium text-warm-300 mb-2">
                          <Calendar className="w-4 h-4 inline mr-2" />
                          Report Type
                        </label>
                        <div className="flex gap-2">
                          {([
                            { value: 'full', label: 'Full Report' },
                            { value: 'summary', label: 'Summary' },
                            { value: 'alerts', label: 'Alerts Only' }
                          ] as const).map(type => (
                            <button
                              key={type.value}
                              onClick={() => handleReportTypeChange(venue.venueId, type.value)}
                              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                venue.emailConfig?.reportType === type.value
                                  ? 'bg-primary/20 text-primary border border-primary/30'
                                  : 'bg-warm-700 text-warm-400 hover:bg-warm-600'
                              }`}
                            >
                              {type.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Recipients */}
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-warm-300 mb-2">
                          <Mail className="w-4 h-4 inline mr-2" />
                          Recipients
                        </label>
                        <div className="space-y-2">
                          {venue.emailConfig?.recipients.map(email => (
                            <div
                              key={email}
                              className="flex items-center justify-between bg-warm-700 rounded-lg px-3 py-2"
                            >
                              <span className="text-sm text-white">{email}</span>
                              <button
                                onClick={() => handleRemoveRecipient(venue.venueId, email)}
                                className="text-warm-400 hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          
                          <div className="flex gap-2">
                            <input
                              type="email"
                              placeholder="Add email address..."
                              value={newEmail[venue.venueId] || ''}
                              onChange={(e) => setNewEmail(prev => ({ ...prev, [venue.venueId]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddRecipient(venue.venueId)}
                              className="flex-1 bg-warm-700 rounded-lg px-3 py-2 text-sm text-white placeholder-warm-500 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <button
                              onClick={() => handleAddRecipient(venue.venueId)}
                              disabled={!newEmail[venue.venueId]?.includes('@')}
                              className="btn-secondary px-3 py-2"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="md:col-span-2 flex items-center justify-between pt-4 border-t border-warm-700">
                        <div className="text-xs text-warm-500">
                          {venue.emailConfig?.lastSentAt ? (
                            <>Last sent: {new Date(venue.emailConfig.lastSentAt).toLocaleDateString()}</>
                          ) : (
                            'No reports sent yet'
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setPreviewVenue(venue.venueId)}
                            className="btn-secondary flex items-center gap-2 text-sm"
                          >
                            <Eye className="w-4 h-4" />
                            Preview
                          </button>
                          <button
                            onClick={() => handleSendTestEmail(venue.venueId)}
                            disabled={saving === venue.venueId || !venue.emailConfig?.recipients.length}
                            className="btn-primary flex items-center gap-2 text-sm"
                          >
                            <Send className="w-4 h-4" />
                            Send Test
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default EmailReporting;
