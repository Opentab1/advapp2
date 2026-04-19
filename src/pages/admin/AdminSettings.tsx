/**
 * AdminSettings — System-wide configuration (now backed by DynamoDB via Lambda).
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Settings, Bell, Clock, Globe, Zap, Save,
  RefreshCw, AlertTriangle, Mail, MessageSquare, CheckCircle,
  Shield, Users, Info,
} from 'lucide-react';
import adminService, { AdminSettingsData } from '../../services/admin.service';

const DEFAULT_SETTINGS: AdminSettingsData = {
  alertThresholds: { offlineMinutes: 30, dataGapHours: 4, tempAnomalyDegrees: 20 },
  notifications:   { emailOnCritical: true, emailOnNewVenue: true, slackWebhook: '', alertEmail: '' },
  defaults:        { defaultPlan: 'Standard', defaultTimezone: 'America/New_York', autoProvisionDevice: true },
  venuescope:      { theftThreshold: 5, workerCount: 0 },
};

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-gray-500 mt-1">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-600" />
      {children}
    </p>
  );
}

export function AdminSettings() {
  const [settings, setSettings] = useState<AdminSettingsData>(DEFAULT_SETTINGS);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [saveErr,  setSaveErr]  = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getAdminSettings();
      setSettings(data);
    } catch (e) {
      console.error('Failed to fetch settings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveErr(null);
    try {
      const ok = await adminService.saveAdminSettings(settings);
      if (ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setSaveErr('Save failed — check console for details.');
      }
    } catch (e: any) {
      setSaveErr(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Typed setters
  const setAT  = (k: keyof AdminSettingsData['alertThresholds'], v: number) =>
    setSettings(p => ({ ...p, alertThresholds: { ...p.alertThresholds, [k]: v } }));
  const setNot = (k: keyof AdminSettingsData['notifications'], v: boolean | string) =>
    setSettings(p => ({ ...p, notifications:   { ...p.notifications,   [k]: v } }));
  const setDef = (k: keyof AdminSettingsData['defaults'], v: string | boolean) =>
    setSettings(p => ({ ...p, defaults:         { ...p.defaults,        [k]: v } }));
  const setVS  = (k: keyof AdminSettingsData['venuescope'], v: number) =>
    setSettings(p => ({ ...p, venuescope:       { ...p.venuescope,      [k]: v } }));

  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">Admin Settings</h1>
            <p className="text-gray-400">System-wide configuration — saved to cloud, persists across sessions</p>
          </div>
          <div className="flex items-center gap-3">
            {saveErr && (
              <span className="text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> {saveErr}
              </span>
            )}
            <motion.button
              onClick={handleSave}
              disabled={saving}
              className={`btn-primary flex items-center gap-2 ${saved ? 'bg-green-600' : ''}`}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" />
                : saved ? <CheckCircle className="w-4 h-4" />
                : <Save className="w-4 h-4" />}
              {saved ? 'Saved!' : 'Save Changes'}
            </motion.button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── VenueScope Behaviour ─────────────────────────────────────── */}
          <motion.div className="glass-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Shield className="w-5 h-5 text-amber-400" />
              VenueScope — Behaviour
            </h2>
            <div className="space-y-6">

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Theft Alert Threshold (unrung drinks)
                </label>
                <input
                  type="number"
                  value={settings.venuescope.theftThreshold}
                  onChange={e => setVS('theftThreshold', parseInt(e.target.value) || 1)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white"
                  min={1} max={50}
                />
                <Note>Send a theft alert when a bartender has this many unrung drinks. Lower = more sensitive. Current: {settings.venuescope.theftThreshold} drinks.</Note>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <Users className="w-4 h-4 text-cyan-400" />
                  Worker Process Override (0 = auto)
                </label>
                <input
                  type="number"
                  value={settings.venuescope.workerCount}
                  onChange={e => setVS('workerCount', parseInt(e.target.value) || 0)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white"
                  min={0} max={64}
                />
                <Note>0 = auto-scale based on camera count. Set a number to cap it. Requires worker restart to take effect (use Ops Monitor → Restart Worker).</Note>
              </div>

            </div>
          </motion.div>

          {/* ── Notifications ─────────────────────────────────────────────── */}
          <motion.div className="glass-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Bell className="w-5 h-5 text-cyan-400" />
              Notifications
            </h2>
            <div className="space-y-5">

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <Mail className="w-4 h-4 text-amber-400" />
                  Alert Email Recipients
                </label>
                <input
                  type="text"
                  value={settings.notifications.alertEmail ?? ''}
                  onChange={e => setNot('alertEmail', e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white"
                  placeholder="ops@yourcompany.com, steph@advizia.ai"
                />
                <Note>Comma-separated. Receives theft alerts and venue connection notifications. Changes are saved to cloud — worker reads this on next alert.</Note>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-red-400" />
                  <div>
                    <div className="text-white font-medium">Email on Critical Alerts</div>
                    <div className="text-xs text-gray-400">Theft flags and camera errors</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={settings.notifications.emailOnCritical}
                    onChange={e => setNot('emailOnCritical', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600" />
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-green-400" />
                  <div>
                    <div className="text-white font-medium">Email on New Venue</div>
                    <div className="text-xs text-gray-400">When a venue connects Tailscale</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={settings.notifications.emailOnNewVenue}
                    onChange={e => setNot('emailOnNewVenue', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600" />
                </label>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <MessageSquare className="w-4 h-4 text-purple-400" />
                  Slack Webhook URL
                </label>
                <input
                  type="url"
                  value={settings.notifications.slackWebhook || ''}
                  onChange={e => setNot('slackWebhook', e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white"
                  placeholder="https://hooks.slack.com/services/..."
                />
              </div>

            </div>
          </motion.div>

          {/* ── Alert Thresholds ──────────────────────────────────────────── */}
          <motion.div className="glass-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              Alert Thresholds
            </h2>
            <div className="space-y-6">
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <Clock className="w-4 h-4 text-red-400" />
                  Device Offline Alert (minutes)
                </label>
                <input type="number" value={settings.alertThresholds.offlineMinutes}
                  onChange={e => setAT('offlineMinutes', parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white" min={5} max={120} />
                <Note>Alert when device has been offline for this many minutes.</Note>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  Data Gap Alert (hours)
                </label>
                <input type="number" value={settings.alertThresholds.dataGapHours}
                  onChange={e => setAT('dataGapHours', parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white" min={1} max={48} />
                <Note>Alert when no data is received for this many hours.</Note>
              </div>
            </div>
          </motion.div>

          {/* ── Defaults + System Info ─────────────────────────────────────── */}
          <motion.div className="glass-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-400" />
              Defaults
            </h2>
            <div className="space-y-6">
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <Zap className="w-4 h-4 text-yellow-400" />Default Plan
                </label>
                <select value={settings.defaults.defaultPlan}
                  onChange={e => setDef('defaultPlan', e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white">
                  <option value="Starter">Starter ($49/mo)</option>
                  <option value="Standard">Standard ($99/mo)</option>
                  <option value="Premium">Premium ($199/mo)</option>
                  <option value="Enterprise">Enterprise (Custom)</option>
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                  <Globe className="w-4 h-4 text-cyan-400" />Default Timezone
                </label>
                <select value={settings.defaults.defaultTimezone}
                  onChange={e => setDef('defaultTimezone', e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white">
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                </select>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-white/10">
              <h3 className="text-sm font-semibold text-gray-400 mb-4">System Information</h3>
              <div className="space-y-2">
                {[
                  ['Version',     '1.0.0'],
                  ['Environment', 'Production'],
                  ['AWS Region',  'us-east-2'],
                  ['Settings',    'Saved to DynamoDB (VenueScopeVenues)'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between p-3 bg-gray-800 rounded-lg text-sm">
                    <span className="text-gray-400">{k}</span>
                    <span className="text-white font-mono text-xs">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

        </div>
      </motion.div>
    </div>
  );
}
