/**
 * AdminSettings - System-wide configuration
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Settings, Bell, Clock, ThermometerSun, Globe, Zap, Save,
  RefreshCw, AlertTriangle, Mail, MessageSquare, CheckCircle
} from 'lucide-react';
import adminService from '../../services/admin.service';

interface AdminSettingsData {
  alertThresholds: { offlineMinutes: number; dataGapHours: number; tempAnomalyDegrees: number; };
  notifications: { emailOnCritical: boolean; emailOnNewVenue: boolean; slackWebhook?: string; };
  defaults: { defaultPlan: string; defaultTimezone: string; autoProvisionDevice: boolean; };
}

export function AdminSettings() {
  const [settings, setSettings] = useState<AdminSettingsData>({
    alertThresholds: { offlineMinutes: 30, dataGapHours: 4, tempAnomalyDegrees: 20 },
    notifications: { emailOnCritical: true, emailOnNewVenue: true, slackWebhook: '' },
    defaults: { defaultPlan: 'Standard', defaultTimezone: 'America/New_York', autoProvisionDevice: true }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getAdminSettings();
      setSettings(data);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const success = await adminService.saveAdminSettings(settings);
      if (success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        alert('Failed to save settings. This requires the saveAdminSettings resolver.');
      }
    } catch (error: any) {
      alert(`Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateAlertThreshold = (key: keyof AdminSettingsData['alertThresholds'], value: number) => {
    setSettings(prev => ({ ...prev, alertThresholds: { ...prev.alertThresholds, [key]: value } }));
  };

  const updateNotification = (key: keyof AdminSettingsData['notifications'], value: boolean | string) => {
    setSettings(prev => ({ ...prev, notifications: { ...prev.notifications, [key]: value } }));
  };

  const updateDefault = (key: keyof AdminSettingsData['defaults'], value: string | boolean) => {
    setSettings(prev => ({ ...prev, defaults: { ...prev.defaults, [key]: value } }));
  };

  if (loading) {
    return <div className="min-h-screen p-8 flex items-center justify-center"><RefreshCw className="w-8 h-8 text-purple-400 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">⚙️ Admin Settings</h1>
            <p className="text-gray-400">System-wide configuration</p>
          </div>
          <motion.button onClick={handleSave} disabled={saving} className={`btn-primary flex items-center gap-2 ${saved ? 'bg-green-600' : ''}`} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved!' : 'Save Changes'}
          </motion.button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Alert Thresholds */}
          <motion.div className="glass-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />Alert Thresholds
            </h2>
            <div className="space-y-6">
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2"><Clock className="w-4 h-4 text-red-400" />Device Offline Alert (minutes)</label>
                <input type="number" value={settings.alertThresholds.offlineMinutes} onChange={(e) => updateAlertThreshold('offlineMinutes', parseInt(e.target.value))} className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white" min={5} max={120} />
                <p className="text-xs text-gray-500 mt-1">Alert when device has been offline for this many minutes</p>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2"><Zap className="w-4 h-4 text-yellow-400" />Data Gap Alert (hours)</label>
                <input type="number" value={settings.alertThresholds.dataGapHours} onChange={(e) => updateAlertThreshold('dataGapHours', parseInt(e.target.value))} className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white" min={1} max={48} />
                <p className="text-xs text-gray-500 mt-1">Alert when no data received for this many hours</p>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2"><ThermometerSun className="w-4 h-4 text-orange-400" />Temperature Anomaly (°F)</label>
                <input type="number" value={settings.alertThresholds.tempAnomalyDegrees} onChange={(e) => updateAlertThreshold('tempAnomalyDegrees', parseInt(e.target.value))} className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white" min={5} max={50} />
                <p className="text-xs text-gray-500 mt-1">Alert when temperature deviates by this many degrees</p>
              </div>
            </div>
          </motion.div>

          {/* Notifications */}
          <motion.div className="glass-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><Bell className="w-5 h-5 text-cyan-400" />Notifications</h2>
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-red-400" />
                  <div><div className="text-white font-medium">Email on Critical Alerts</div><div className="text-xs text-gray-400">Get notified when venues go critical</div></div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={settings.notifications.emailOnCritical} onChange={(e) => updateNotification('emailOnCritical', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-green-400" />
                  <div><div className="text-white font-medium">Email on New Venue</div><div className="text-xs text-gray-400">Get notified when venues are created</div></div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={settings.notifications.emailOnNewVenue} onChange={(e) => updateNotification('emailOnNewVenue', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2"><MessageSquare className="w-4 h-4 text-purple-400" />Slack Webhook URL</label>
                <input type="url" value={settings.notifications.slackWebhook || ''} onChange={(e) => updateNotification('slackWebhook', e.target.value)} className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white" placeholder="https://hooks.slack.com/services/..." />
              </div>
            </div>
          </motion.div>

          {/* Defaults */}
          <motion.div className="glass-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><Settings className="w-5 h-5 text-purple-400" />Default Values</h2>
            <div className="space-y-6">
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2"><Zap className="w-4 h-4 text-yellow-400" />Default Plan</label>
                <select value={settings.defaults.defaultPlan} onChange={(e) => updateDefault('defaultPlan', e.target.value)} className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white">
                  <option value="Starter">Starter ($49/mo)</option>
                  <option value="Standard">Standard ($99/mo)</option>
                  <option value="Premium">Premium ($199/mo)</option>
                  <option value="Enterprise">Enterprise (Custom)</option>
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mb-2"><Globe className="w-4 h-4 text-cyan-400" />Default Timezone</label>
                <select value={settings.defaults.defaultTimezone} onChange={(e) => updateDefault('defaultTimezone', e.target.value)} className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white">
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                </select>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-green-400" />
                  <div><div className="text-white font-medium">Auto-Provision Device</div><div className="text-xs text-gray-400">Create IoT thing on venue creation</div></div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={settings.defaults.autoProvisionDevice} onChange={(e) => updateDefault('autoProvisionDevice', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>
            </div>
          </motion.div>

          {/* System Info */}
          <motion.div className="glass-card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><Settings className="w-5 h-5 text-gray-400" />System Information</h2>
            <div className="space-y-4">
              <div className="flex justify-between p-3 bg-gray-800 rounded-lg"><span className="text-gray-400">Version</span><span className="text-white font-mono">1.0.0</span></div>
              <div className="flex justify-between p-3 bg-gray-800 rounded-lg"><span className="text-gray-400">Environment</span><span className="text-green-400 font-mono">Production</span></div>
              <div className="flex justify-between p-3 bg-gray-800 rounded-lg"><span className="text-gray-400">AWS Region</span><span className="text-white font-mono">us-east-2</span></div>
              <div className="flex justify-between p-3 bg-gray-800 rounded-lg"><span className="text-gray-400">Last Deployed</span><span className="text-white font-mono">{new Date().toLocaleDateString()}</span></div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
