import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, Send, Clock, Users, CheckCircle, XCircle, RefreshCw,
  Plus, Trash2, ChevronDown, AlertCircle, Zap, Calendar,
  Settings, Shield, ToggleLeft, ToggleRight, Eye, FileText,
  ChevronRight,
} from 'lucide-react';
import adminService, { EmailConfig } from '../../services/admin.service';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VenueWithEmail {
  venueId: string;
  venueName: string;
  ownerEmail?: string;
  emailConfig?: EmailConfig;
}

interface GlobalSettings {
  fromEmail: string;
  senderVerified: boolean;
  senderStatus: string;
  scheduleEnabled: boolean;
  scheduleExpression: string;
  scheduleHourET: number;
  scheduleDayOfWeek: number | null;
}

interface Template {
  introText?: string;
  showStationBreakdown?: boolean;
  showTheftAlerts?: boolean;
  showCTA?: boolean;
  ctaText?: string;
  footerText?: string;
}

interface LogEntry {
  venueId: string; venueName: string; type: string;
  recipients: string[]; subject: string; sentAt: string;
  totalDrinks: number; theftAlerts: number; status: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? 'AM' : 'PM';
  const h    = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { value: i, label: `${h}:00 ${ampm} ET` };
});

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ─── Main Component ───────────────────────────────────────────────────────────

export function EmailReporting() {
  // Venues
  const [venues, setVenues] = useState<VenueWithEmail[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [sendingNow, setSendingNow] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState<Record<string, string>>({});

  // Global settings
  const [global, setGlobal] = useState<GlobalSettings | null>(null);
  const [globalLoading, setGlobalLoading] = useState(true);
  const [fromInput, setFromInput] = useState('');
  const [savingFrom, setSavingFrom] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [togglingSchedule, setTogglingSchedule] = useState(false);
  const [scheduleHour, setScheduleHour] = useState(6);
  const [scheduleDay, setScheduleDay] = useState<number | null>(null);
  const [globalMsg, setGlobalMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Templates
  const [templates, setTemplates] = useState<{ daily: Template; weekly: Template }>({ daily: {}, weekly: {} });
  const [activeTemplate, setActiveTemplate] = useState<'daily' | 'weekly'>('daily');
  const [templateDirty, setTemplateDirty] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Preview modal
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVenue, setPreviewVenue] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Send log
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(true);

  const flash = (ok: boolean, text: string) => {
    setGlobalMsg({ ok, text });
    setTimeout(() => setGlobalMsg(null), 5000);
  };

  // ─── Load functions ──────────────────────────────────────────────────────────

  const loadGlobal = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const s = await adminService.getEmailGlobalSettings();
      setGlobal(s);
      setFromInput(s.fromEmail);
      setScheduleHour(s.scheduleHourET ?? 6);
      setScheduleDay(s.scheduleDayOfWeek ?? null);
    } catch (e) { console.error(e); }
    finally { setGlobalLoading(false); }
  }, []);

  const loadVenues = useCallback(async () => {
    setVenuesLoading(true);
    try {
      const all = await adminService.getAllVenues();
      setVenues(all.map(v => ({
        venueId: v.venueId, venueName: v.venueName, ownerEmail: v.ownerEmail,
        emailConfig: v.emailConfig ?? {
          enabled: false, frequency: 'weekly' as const,
          recipients: v.ownerEmail ? [v.ownerEmail] : [], reportType: 'full' as const,
        },
      })));
    } catch (e) { console.error(e); }
    finally { setVenuesLoading(false); }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const t = await adminService.getEmailTemplate();
      setTemplates({ daily: t.daily ?? {}, weekly: t.weekly ?? {} });
    } catch (e) { console.error(e); }
  }, []);

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try { setLog(await adminService.getEmailLog()); }
    catch (e) { console.error(e); }
    finally { setLogLoading(false); }
  }, []);

  useEffect(() => {
    loadGlobal();
    loadVenues();
    loadTemplates();
    loadLog();
  }, [loadGlobal, loadVenues, loadTemplates, loadLog]);

  // Update iframe when previewHtml changes
  useEffect(() => {
    if (previewHtml && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) { doc.open(); doc.write(previewHtml); doc.close(); }
    }
  }, [previewHtml]);

  // ─── Global settings handlers ────────────────────────────────────────────────

  const handleSaveFrom = async () => {
    if (!fromInput.includes('@')) return;
    setSavingFrom(true);
    try {
      await adminService.saveEmailGlobalSettings(fromInput);
      await loadGlobal();
      flash(true, 'From email saved.');
    } catch (e: any) { flash(false, e.message); }
    finally { setSavingFrom(false); }
  };

  const handleVerify = async () => {
    if (!fromInput.includes('@')) return;
    setVerifying(true);
    try { flash(true, await adminService.verifySenderEmail(fromInput)); }
    catch (e: any) { flash(false, e.message); }
    finally { setVerifying(false); }
  };

  const handleCheckStatus = async () => {
    if (!global?.fromEmail) return;
    setGlobalLoading(true);
    try {
      const res = await adminService.checkSenderStatus(global.fromEmail);
      setGlobal(prev => prev ? { ...prev, senderVerified: res.verified, senderStatus: res.status } : prev);
    } catch (e: any) { flash(false, e.message); }
    finally { setGlobalLoading(false); }
  };

  const handleToggleSchedule = async () => {
    if (!global) return;
    setTogglingSchedule(true);
    try {
      if (global.scheduleEnabled) {
        await adminService.disableAutoSchedule();
        flash(true, 'Auto-schedule disabled.');
      } else {
        await adminService.enableAutoSchedule(scheduleHour, scheduleDay);
        const dayLabel = scheduleDay !== null ? `every ${DAYS[scheduleDay]}` : 'every day';
        flash(true, `Auto-schedule enabled — sends ${dayLabel} at ${HOURS[scheduleHour].label}.`);
      }
      await loadGlobal();
    } catch (e: any) {
      flash(false, `${e.message}. Make sure the Lambda IAM role has events:PutRule and lambda:AddPermission.`);
    }
    finally { setTogglingSchedule(false); }
  };

  const handleUpdateScheduleTime = async () => {
    if (!global?.scheduleEnabled) return;
    setTogglingSchedule(true);
    try {
      await adminService.enableAutoSchedule(scheduleHour, scheduleDay);
      const dayLabel = scheduleDay !== null ? `every ${DAYS[scheduleDay]}` : 'every day';
      flash(true, `Schedule updated — sends ${dayLabel} at ${HOURS[scheduleHour].label}.`);
      await loadGlobal();
    } catch (e: any) { flash(false, e.message); }
    finally { setTogglingSchedule(false); }
  };

  // ─── Template handlers ───────────────────────────────────────────────────────

  const updateTemplate = (field: keyof Template, value: any) => {
    setTemplates(prev => ({
      ...prev,
      [activeTemplate]: { ...prev[activeTemplate], [field]: value },
    }));
    setTemplateDirty(true);
  };

  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    try {
      await adminService.saveEmailTemplate(activeTemplate, templates[activeTemplate]);
      setTemplateDirty(false);
      flash(true, `${activeTemplate === 'daily' ? 'Daily' : 'Weekly'} template saved.`);
    } catch (e: any) { flash(false, e.message); }
    finally { setSavingTemplate(false); }
  };

  const handlePreview = async (venueId: string, type: 'daily' | 'weekly') => {
    setPreviewVenue(venueId);
    setPreviewLoading(true);
    setPreviewHtml(null);
    try {
      const html = await adminService.previewEmail(venueId, type === 'daily' ? 1 : 7);
      setPreviewHtml(html);
    } catch (e: any) { flash(false, `Preview failed: ${e.message}`); setPreviewVenue(null); }
    finally { setPreviewLoading(false); }
  };

  // ─── Venue handlers ──────────────────────────────────────────────────────────

  const saveConfig = async (venueId: string, config: EmailConfig) => {
    setSaving(venueId);
    try {
      await adminService.updateVenueEmailConfig(venueId, config);
      setVenues(prev => prev.map(v => v.venueId === venueId ? { ...v, emailConfig: config } : v));
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  };

  const handleSendNow = async (venueId: string, days: number) => {
    const v = venues.find(x => x.venueId === venueId);
    if (!v?.emailConfig?.recipients.length) { alert('Add at least one recipient first'); return; }
    setSendingNow(venueId);
    try {
      await adminService.sendReportNow(venueId, days);
      alert(`Report sent to ${v.emailConfig.recipients.join(', ')}`);
      loadVenues(); loadLog();
    } catch (e: any) { alert(`Failed: ${e.message}`); }
    finally { setSendingNow(null); }
  };

  const handleSendTest = async (venueId: string) => {
    const v = venues.find(x => x.venueId === venueId);
    if (!v?.emailConfig?.recipients.length) { alert('Add at least one recipient first'); return; }
    setSaving(venueId);
    try {
      await adminService.sendTestEmail(venueId);
      alert('Test email sent! Check your inbox.');
    } catch (e: any) { alert(`Failed: ${e.message}\n\nMake sure SES_FROM_EMAIL is verified in AWS SES.`); }
    finally { setSaving(null); }
  };

  const enabledCount = venues.filter(v => v.emailConfig?.enabled).length;
  const tmpl = templates[activeTemplate];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Mail className="w-7 h-7 text-amber-400" />
            Email Reporting
          </h1>
          <p className="text-gray-400 text-sm mt-1">Configure and send automated reports to venue owners</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold text-amber-400">{enabledCount}</div>
            <div className="text-xs text-gray-500">Venues enabled</div>
          </div>
          <button onClick={() => { loadGlobal(); loadVenues(); loadLog(); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm hover:bg-white/10 transition-colors">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Flash message */}
      <AnimatePresence>
        {globalMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${
              globalMsg.ok ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
            {globalMsg.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
            {globalMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Email System Settings ── */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-5">
          <Settings className="w-5 h-5 text-amber-400" />
          <h2 className="font-semibold text-white">Email System Settings</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* FROM email */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              <Shield className="w-3.5 h-3.5 inline mr-1" />Send Reports From
            </label>
            <div className="flex gap-2 mb-2">
              <input type="email" value={fromInput} onChange={e => setFromInput(e.target.value)}
                placeholder="reports@yourdomain.com"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
              <button onClick={handleSaveFrom} disabled={savingFrom || !fromInput.includes('@')}
                className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-40">
                {savingFrom ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {globalLoading
                ? <span className="text-xs text-gray-500 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" />Checking…</span>
                : global?.senderVerified
                  ? <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" />Verified in SES</span>
                  : <span className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {global?.senderStatus === 'Pending' ? 'Pending — check your inbox' : 'Not verified'}
                    </span>
              }
              <button onClick={handleCheckStatus} className="text-xs text-gray-600 hover:text-gray-400 underline">refresh</button>
              {!global?.senderVerified && (
                <button onClick={handleVerify} disabled={verifying || !fromInput.includes('@')}
                  className="ml-auto px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-40">
                  {verifying ? 'Sending…' : 'Send Verification Email →'}
                </button>
              )}
            </div>
          </div>

          {/* Auto-Schedule */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              <Calendar className="w-3.5 h-3.5 inline mr-1" />Auto-Schedule
            </label>

            <div className="space-y-2">
              {/* Time + day pickers */}
              <div className="flex gap-2">
                <select value={scheduleHour} onChange={e => setScheduleHour(Number(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500">
                  {HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
                <select value={scheduleDay ?? 'daily'} onChange={e => setScheduleDay(e.target.value === 'daily' ? null : Number(e.target.value))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500">
                  <option value="daily">Every Day</option>
                  {DAYS.map((d, i) => <option key={i} value={i}>{`Every ${d}`}</option>)}
                </select>
              </div>

              <button onClick={global?.scheduleEnabled ? handleUpdateScheduleTime : handleToggleSchedule}
                disabled={togglingSchedule}
                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg border transition-all text-sm font-medium ${
                  global?.scheduleEnabled
                    ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                }`}>
                <div className="flex items-center gap-2">
                  {togglingSchedule
                    ? <RefreshCw className="w-4 h-4 animate-spin" />
                    : global?.scheduleEnabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  {global?.scheduleEnabled ? (togglingSchedule ? 'Updating…' : 'Enabled — click to update time') : (togglingSchedule ? 'Enabling…' : 'Click to Enable')}
                </div>
                {global?.scheduleEnabled && (
                  <span className="text-xs opacity-70">
                    {scheduleDay !== null ? DAYS[scheduleDay] : 'Daily'} at {HOURS[scheduleHour]?.label}
                  </span>
                )}
              </button>

              {global?.scheduleEnabled && (
                <button onClick={async () => {
                  setTogglingSchedule(true);
                  try { await adminService.disableAutoSchedule(); flash(true, 'Auto-schedule disabled.'); await loadGlobal(); }
                  catch (e: any) { flash(false, e.message); }
                  finally { setTogglingSchedule(false); }
                }} disabled={togglingSchedule} className="w-full text-xs text-red-500 hover:text-red-400 py-1">
                  Disable schedule
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Email Templates ── */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-400" />
            <h2 className="font-semibold text-white">Email Templates</h2>
          </div>
          <div className="flex gap-1">
            {(['daily', 'weekly'] as const).map(t => (
              <button key={t} onClick={() => setActiveTemplate(t)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTemplate === t
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Intro text (shown below header)</label>
              <input type="text" value={tmpl.introText ?? ''}
                onChange={e => updateTemplate('introText', e.target.value)}
                placeholder="Here's your automated performance report."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CTA button text</label>
              <input type="text" value={tmpl.ctaText ?? ''}
                onChange={e => updateTemplate('ctaText', e.target.value)}
                placeholder="View Full Report →"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Footer note</label>
              <input type="text" value={tmpl.footerText ?? ''}
                onChange={e => updateTemplate('footerText', e.target.value)}
                placeholder="Contact us at support@advizia.ai"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-gray-500">Sections to include</p>
            {([
              ['showStationBreakdown', 'Station Breakdown table'],
              ['showTheftAlerts',      'Theft Alerts section'],
              ['showCTA',              'View Full Report button'],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center gap-3 cursor-pointer">
                <div onClick={() => updateTemplate(field, !(tmpl[field] ?? true))}
                  className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${(tmpl[field] ?? true) ? 'bg-amber-500' : 'bg-white/10'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-transform ${(tmpl[field] ?? true) ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-sm text-gray-300">{label}</span>
              </label>
            ))}

            <div className="flex gap-2 mt-4">
              <button onClick={handleSaveTemplate} disabled={savingTemplate || !templateDirty}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-40">
                {savingTemplate ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {templateDirty ? 'Save Template' : 'Saved'}
              </button>
              {venues.length > 0 && (
                <button onClick={() => handlePreview(venues[0].venueId, activeTemplate)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm hover:bg-white/10 transition-colors">
                  <Eye className="w-4 h-4" /> Preview
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Venues List ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4" /> Venues
        </h2>

        {venuesLoading ? (
          <div className="glass-card p-10 text-center">
            <RefreshCw className="w-6 h-6 text-amber-400 animate-spin mx-auto mb-2" />
            <p className="text-gray-500 text-sm">Loading venues…</p>
          </div>
        ) : (
          venues.map(venue => (
            <div key={venue.venueId} className="glass-card overflow-hidden">
              {/* Venue row */}
              <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/3 transition-colors"
                onClick={() => setExpanded(expanded === venue.venueId ? null : venue.venueId)}>
                <div className="flex items-center gap-4">
                  <button onClick={e => { e.stopPropagation(); saveConfig(venue.venueId, { ...venue.emailConfig!, enabled: !venue.emailConfig?.enabled }); }}
                    disabled={saving === venue.venueId}
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${venue.emailConfig?.enabled ? 'bg-green-500' : 'bg-white/10'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${venue.emailConfig?.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                  <div>
                    <div className="font-medium text-white text-sm">{venue.venueName}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {venue.emailConfig?.enabled
                        ? <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" />{venue.emailConfig.frequency} reports enabled</span>
                        : <span className="text-xs text-gray-600">Reports disabled</span>}
                      {(venue.emailConfig?.recipients?.length ?? 0) > 0 && (
                        <span className="text-xs text-gray-600">· {venue.emailConfig!.recipients.length} recipient(s)</span>
                      )}
                      {venue.emailConfig?.lastSentAt && (
                        <span className="text-xs text-gray-600">· Last sent {new Date(venue.emailConfig.lastSentAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {saving === venue.venueId && <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />}
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${expanded === venue.venueId ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {/* Expanded settings */}
              <AnimatePresence>
                {expanded === venue.venueId && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="border-t border-white/5 p-4 bg-white/2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* Frequency */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-2"><Clock className="w-3.5 h-3.5 inline mr-1" />Frequency</label>
                        <div className="flex gap-2">
                          {(['daily', 'weekly', 'monthly'] as const).map(f => (
                            <button key={f} onClick={() => saveConfig(venue.venueId, { ...venue.emailConfig!, frequency: f })}
                              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${venue.emailConfig?.frequency === f ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent'}`}>
                              {f.charAt(0).toUpperCase() + f.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Report type */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-2"><Calendar className="w-3.5 h-3.5 inline mr-1" />Report Type</label>
                        <div className="flex gap-2">
                          {([['full','Full'],['summary','Summary'],['alerts','Alerts Only']] as const).map(([v, l]) => (
                            <button key={v} onClick={() => saveConfig(venue.venueId, { ...venue.emailConfig!, reportType: v })}
                              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${venue.emailConfig?.reportType === v ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent'}`}>
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Recipients */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-500 mb-2"><Mail className="w-3.5 h-3.5 inline mr-1" />Recipients</label>
                        <div className="space-y-2">
                          {venue.emailConfig?.recipients.map(email => (
                            <div key={email} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                              <span className="text-sm text-white">{email}</span>
                              <button onClick={() => saveConfig(venue.venueId, { ...venue.emailConfig!, recipients: venue.emailConfig!.recipients.filter(r => r !== email) })}
                                className="text-gray-500 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <input type="email" placeholder="Add email address…"
                              value={newEmail[venue.venueId] || ''}
                              onChange={e => setNewEmail(p => ({ ...p, [venue.venueId]: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key !== 'Enter') return;
                                const em = newEmail[venue.venueId]?.trim();
                                if (!em?.includes('@') || venue.emailConfig?.recipients.includes(em)) return;
                                saveConfig(venue.venueId, { ...venue.emailConfig!, recipients: [...venue.emailConfig!.recipients, em] });
                                setNewEmail(p => ({ ...p, [venue.venueId]: '' }));
                              }}
                              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                            <button onClick={() => {
                              const em = newEmail[venue.venueId]?.trim();
                              if (!em?.includes('@') || venue.emailConfig?.recipients.includes(em)) return;
                              saveConfig(venue.venueId, { ...venue.emailConfig!, recipients: [...venue.emailConfig!.recipients, em] });
                              setNewEmail(p => ({ ...p, [venue.venueId]: '' }));
                            }} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="md:col-span-2 border-t border-white/5 pt-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-xs text-gray-600">
                            {venue.emailConfig?.lastSentAt
                              ? `Last sent: ${new Date(venue.emailConfig.lastSentAt).toLocaleString()}`
                              : 'No reports sent yet'}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => handlePreview(venue.venueId, 'daily')} disabled={previewLoading && previewVenue === venue.venueId}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs hover:bg-white/10 transition-colors">
                              <Eye className="w-3.5 h-3.5" /> Preview Daily
                            </button>
                            <button onClick={() => handlePreview(venue.venueId, 'weekly')} disabled={previewLoading && previewVenue === venue.venueId}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs hover:bg-white/10 transition-colors">
                              <Eye className="w-3.5 h-3.5" /> Preview Weekly
                            </button>
                            <button onClick={() => handleSendTest(venue.venueId)} disabled={saving === venue.venueId || !venue.emailConfig?.recipients.length}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs hover:bg-white/10 transition-colors disabled:opacity-40">
                              {saving === venue.venueId ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                              Send Test
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleSendNow(venue.venueId, 1)} disabled={sendingNow === venue.venueId || !venue.emailConfig?.recipients.length}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-40">
                            {sendingNow === venue.venueId ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            Send Daily Now
                          </button>
                          <button onClick={() => handleSendNow(venue.venueId, 7)} disabled={sendingNow === venue.venueId || !venue.emailConfig?.recipients.length}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors disabled:opacity-40">
                            {sendingNow === venue.venueId ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                            Send Weekly Now
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>

      {/* ── Send Log ── */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ChevronRight className="w-5 h-5 text-amber-400" />
            <h2 className="font-semibold text-white">Send Log</h2>
            <span className="text-xs text-gray-600">({log.length} entries)</span>
          </div>
          <button onClick={loadLog} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
            <RefreshCw className={`w-3 h-3 ${logLoading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {logLoading ? (
          <div className="text-center py-6"><RefreshCw className="w-5 h-5 animate-spin text-amber-400 mx-auto" /></div>
        ) : log.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-sm">No emails sent yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="text-xs text-gray-600 font-semibold uppercase pb-2 pr-4">Sent At</th>
                  <th className="text-xs text-gray-600 font-semibold uppercase pb-2 pr-4">Venue</th>
                  <th className="text-xs text-gray-600 font-semibold uppercase pb-2 pr-4">Type</th>
                  <th className="text-xs text-gray-600 font-semibold uppercase pb-2 pr-4">Recipients</th>
                  <th className="text-xs text-gray-600 font-semibold uppercase pb-2 pr-4">Drinks</th>
                  <th className="text-xs text-gray-600 font-semibold uppercase pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                      {new Date(entry.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2 pr-4 text-white font-medium">{entry.venueName}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${entry.type === 'Daily' ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'}`}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-400 text-xs">{entry.recipients.join(', ')}</td>
                    <td className="py-2 pr-4 text-amber-400 font-bold">{entry.totalDrinks}</td>
                    <td className="py-2">
                      {entry.theftAlerts > 0
                        ? <span className="text-red-400 text-xs font-medium">⚠️ {entry.theftAlerts} alerts</span>
                        : <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" />Sent</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Preview Modal ── */}
      <AnimatePresence>
        {(previewHtml || previewLoading) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => { setPreviewHtml(null); setPreviewVenue(null); }}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="w-full max-w-2xl bg-[#0a0a0a] rounded-xl border border-white/10 overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <span className="text-sm font-medium text-white">Email Preview</span>
                <button onClick={() => { setPreviewHtml(null); setPreviewVenue(null); }}
                  className="text-gray-500 hover:text-white text-xl leading-none">×</button>
              </div>
              {previewLoading
                ? <div className="flex items-center justify-center h-96"><RefreshCw className="w-8 h-8 animate-spin text-amber-400" /></div>
                : <iframe ref={iframeRef} className="w-full h-[600px] border-0" title="Email Preview" />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

export default EmailReporting;
