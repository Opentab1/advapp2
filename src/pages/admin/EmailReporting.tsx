import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Mail, Send, Clock, Users, CheckCircle, XCircle, RefreshCw,
  Plus, Trash2, ChevronDown, Calendar, AlertCircle, Zap,
  Settings, Shield, ToggleLeft, ToggleRight
} from 'lucide-react';
import adminService, { EmailConfig } from '../../services/admin.service';

interface VenueWithEmail {
  venueId: string;
  venueName: string;
  ownerEmail?: string;
  emailConfig?: EmailConfig;
}

interface GlobalEmailSettings {
  fromEmail: string;
  senderVerified: boolean;
  senderStatus: string;
  scheduleEnabled: boolean;
  scheduleExpression: string;
}

export function EmailReporting() {
  const [venues, setVenues] = useState<VenueWithEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [sendingNow, setSendingNow] = useState<string | null>(null);
  const [expandedVenue, setExpandedVenue] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState<{ [venueId: string]: string }>({});

  // Global settings state
  const [globalSettings, setGlobalSettings] = useState<GlobalEmailSettings | null>(null);
  const [globalLoading, setGlobalLoading] = useState(true);
  const [fromEmailInput, setFromEmailInput] = useState('');
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [togglingSchedule, setTogglingSchedule] = useState(false);
  const [globalMsg, setGlobalMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadGlobalSettings = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const s = await adminService.getEmailGlobalSettings();
      setGlobalSettings(s);
      setFromEmailInput(s.fromEmail);
    } catch (e) {
      console.error('Failed to load email settings:', e);
    } finally {
      setGlobalLoading(false);
    }
  }, []);

  const showMsg = (ok: boolean, text: string) => {
    setGlobalMsg({ ok, text });
    setTimeout(() => setGlobalMsg(null), 4000);
  };

  const handleSaveFromEmail = async () => {
    if (!fromEmailInput.includes('@')) return;
    setSavingGlobal(true);
    try {
      await adminService.saveEmailGlobalSettings(fromEmailInput);
      await loadGlobalSettings();
      showMsg(true, 'From email saved.');
    } catch (e: any) {
      showMsg(false, e.message);
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleVerify = async () => {
    if (!fromEmailInput.includes('@')) return;
    setVerifying(true);
    try {
      const msg = await adminService.verifySenderEmail(fromEmailInput);
      showMsg(true, msg);
    } catch (e: any) {
      showMsg(false, e.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!globalSettings?.fromEmail) return;
    setGlobalLoading(true);
    try {
      const res = await adminService.checkSenderStatus(globalSettings.fromEmail);
      setGlobalSettings(prev => prev ? { ...prev, senderVerified: res.verified, senderStatus: res.status } : prev);
    } catch (e: any) {
      showMsg(false, e.message);
    } finally {
      setGlobalLoading(false);
    }
  };

  const handleToggleSchedule = async () => {
    if (!globalSettings) return;
    setTogglingSchedule(true);
    try {
      if (globalSettings.scheduleEnabled) {
        await adminService.disableAutoSchedule();
        showMsg(true, 'Auto-schedule disabled.');
      } else {
        await adminService.enableAutoSchedule();
        showMsg(true, 'Auto-schedule enabled — reports will send daily at 6 AM ET.');
      }
      await loadGlobalSettings();
    } catch (e: any) {
      showMsg(false, `Failed: ${e.message}. Make sure Lambda IAM role has events:PutRule and lambda:AddPermission.`);
    } finally {
      setTogglingSchedule(false);
    }
  };

  const loadVenues = useCallback(async () => {
    setLoading(true);
    try {
      const allVenues = await adminService.getAllVenues();
      setVenues(allVenues.map(v => ({
        venueId: v.venueId,
        venueName: v.venueName,
        ownerEmail: v.ownerEmail,
        emailConfig: v.emailConfig ?? {
          enabled: false,
          frequency: 'weekly' as const,
          recipients: v.ownerEmail ? [v.ownerEmail] : [],
          reportType: 'full' as const,
        },
      })));
    } catch (error) {
      console.error('Error loading venues:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVenues();
    loadGlobalSettings();
  }, [loadVenues, loadGlobalSettings]);

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
      alert('Test email sent! Check your inbox.');
    } catch (error: any) {
      alert(`Failed to send test email: ${error.message}\n\nMake sure SES_FROM_EMAIL is verified in AWS SES.`);
    } finally {
      setSaving(null);
    }
  };

  const handleSendNow = async (venueId: string, periodDays: number) => {
    const venue = venues.find(v => v.venueId === venueId);
    if (!venue?.emailConfig?.recipients.length) {
      alert('Please add at least one recipient first');
      return;
    }
    setSendingNow(venueId);
    try {
      await adminService.sendReportNow(venueId, periodDays);
      alert(`Report sent to ${venue.emailConfig.recipients.join(', ')}`);
      loadVenues(); // refresh lastSentAt
    } catch (error: any) {
      alert(`Failed to send report: ${error.message}`);
    } finally {
      setSendingNow(null);
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

        {/* Global Email System Settings */}
        <div className="glass-card p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-5 h-5 text-amber-400" />
            <h2 className="font-semibold text-white">Email System Settings</h2>
          </div>

          {globalMsg && (
            <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 ${
              globalMsg.ok ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              {globalMsg.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
              {globalMsg.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* FROM Email */}
            <div>
              <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider mb-2">
                <Shield className="w-3.5 h-3.5 inline mr-1.5" />
                Send Reports From
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="email"
                  value={fromEmailInput}
                  onChange={e => setFromEmailInput(e.target.value)}
                  placeholder="reports@yourdomain.com"
                  className="flex-1 bg-warm-700 rounded-lg px-3 py-2 text-sm text-white placeholder-warm-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button
                  onClick={handleSaveFromEmail}
                  disabled={savingGlobal || !fromEmailInput.includes('@')}
                  className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                >
                  {savingGlobal ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Save'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {globalLoading ? (
                  <span className="text-xs text-warm-500 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Checking…</span>
                ) : globalSettings?.senderVerified ? (
                  <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Verified in SES</span>
                ) : (
                  <span className="text-xs text-amber-400 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {globalSettings?.senderStatus === 'Pending' ? 'Verification pending — check inbox' : 'Not verified'}</span>
                )}
                <button onClick={handleCheckStatus} disabled={globalLoading} className="text-xs text-warm-500 hover:text-warm-300 underline">refresh</button>
                {!globalSettings?.senderVerified && (
                  <button
                    onClick={handleVerify}
                    disabled={verifying || !fromEmailInput.includes('@')}
                    className="ml-auto px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-warm-300 hover:bg-white/10 transition-colors disabled:opacity-40"
                  >
                    {verifying ? 'Sending…' : 'Send Verification Email →'}
                  </button>
                )}
              </div>
            </div>

            {/* Auto-Schedule */}
            <div>
              <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider mb-2">
                <Calendar className="w-3.5 h-3.5 inline mr-1.5" />
                Auto-Schedule
              </label>
              <button
                onClick={handleToggleSchedule}
                disabled={togglingSchedule}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
                  globalSettings?.scheduleEnabled
                    ? 'bg-green-500/10 border-green-500/30 text-green-400'
                    : 'bg-white/5 border-white/10 text-warm-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  {togglingSchedule
                    ? <RefreshCw className="w-4 h-4 animate-spin" />
                    : globalSettings?.scheduleEnabled
                      ? <ToggleRight className="w-5 h-5" />
                      : <ToggleLeft className="w-5 h-5" />}
                  <span className="text-sm font-medium">
                    {globalSettings?.scheduleEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <span className="text-xs opacity-70">
                  {globalSettings?.scheduleEnabled ? 'Sends daily at 6 AM ET' : 'Click to enable'}
                </span>
              </button>
              <p className="text-xs text-warm-500 mt-2">
                When enabled, daily reports send every morning. Weekly/monthly based on per-venue frequency setting.
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
                      <div className="md:col-span-2 pt-4 border-t border-warm-700">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-xs text-warm-500">
                            {venue.emailConfig?.lastSentAt ? (
                              <>Last sent: {new Date(venue.emailConfig.lastSentAt).toLocaleString()}</>
                            ) : (
                              'No reports sent yet'
                            )}
                          </div>
                          <button
                            onClick={() => handleSendTestEmail(venue.venueId)}
                            disabled={saving === venue.venueId || !venue.emailConfig?.recipients.length}
                            className="btn-secondary flex items-center gap-2 text-sm"
                          >
                            {saving === venue.venueId
                              ? <RefreshCw className="w-4 h-4 animate-spin" />
                              : <Send className="w-4 h-4" />}
                            Send Test
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSendNow(venue.venueId, 1)}
                            disabled={sendingNow === venue.venueId || !venue.emailConfig?.recipients.length}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                          >
                            {sendingNow === venue.venueId
                              ? <RefreshCw className="w-4 h-4 animate-spin" />
                              : <Zap className="w-4 h-4" />}
                            Send Daily Now
                          </button>
                          <button
                            onClick={() => handleSendNow(venue.venueId, 7)}
                            disabled={sendingNow === venue.venueId || !venue.emailConfig?.recipients.length}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                          >
                            {sendingNow === venue.venueId
                              ? <RefreshCw className="w-4 h-4 animate-spin" />
                              : <Calendar className="w-4 h-4" />}
                            Send Weekly Now
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
