import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Target,
  Plus,
  Search,
  List,
  LayoutGrid,
  Mail,
  Phone,
  MapPin,
  Calendar,
  DollarSign,
  ChevronRight,
  X,
  Save,
  Trash2,
  Edit,
  Copy,
  CheckCircle,
  AlertTriangle,
  Clock,
  User,
  Building2,
  MessageSquare,
  TrendingUp,
  Filter,
  SortAsc,
  FileText,
  Download,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = 'prospect' | 'contacted' | 'demo' | 'trial' | 'customer' | 'lost';
type VenueType = 'bar' | 'restaurant' | 'nightclub' | 'hotel' | 'other';
type Source = 'cold_outreach' | 'referral' | 'inbound' | 'conference' | 'other';
type SortField = 'stage' | 'followUpDate' | 'createdAt';
type ListFilter = 'all' | 'active' | 'lost' | 'overdue';

interface LeadNote {
  id: string;
  text: string;
  createdAt: string;
}

interface Lead {
  id: string;
  venueName: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  venueType: VenueType;
  stage: Stage;
  notes: LeadNote[];
  followUpDate?: string;
  source: Source;
  dealValue?: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'venuescope_crm_leads';

const PIPELINE_STAGES: Stage[] = ['prospect', 'contacted', 'demo', 'trial', 'customer'];

const STAGE_CONFIG: Record<Stage, { label: string; color: string; bg: string; border: string; dot: string }> = {
  prospect:  { label: 'Prospect',  color: 'text-indigo-400',  bg: 'bg-indigo-500/20',  border: 'border-indigo-500/40',  dot: 'bg-indigo-400' },
  contacted: { label: 'Contacted', color: 'text-amber-400',   bg: 'bg-amber-500/20',   border: 'border-amber-500/40',   dot: 'bg-amber-400' },
  demo:      { label: 'Demo',      color: 'text-purple-400',  bg: 'bg-purple-500/20',  border: 'border-purple-500/40',  dot: 'bg-purple-400' },
  trial:     { label: 'Trial',     color: 'text-cyan-400',    bg: 'bg-cyan-500/20',    border: 'border-cyan-500/40',    dot: 'bg-cyan-400' },
  customer:  { label: 'Customer',  color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', dot: 'bg-emerald-400' },
  lost:      { label: 'Lost',      color: 'text-zinc-400',    bg: 'bg-zinc-500/20',    border: 'border-zinc-500/40',    dot: 'bg-zinc-400' },
};

const VENUE_TYPES: { value: VenueType; label: string }[] = [
  { value: 'bar',       label: 'Bar' },
  { value: 'restaurant',label: 'Restaurant' },
  { value: 'nightclub', label: 'Nightclub' },
  { value: 'hotel',     label: 'Hotel' },
  { value: 'other',     label: 'Other' },
];

const SOURCES: { value: Source; label: string }[] = [
  { value: 'cold_outreach', label: 'Cold Outreach' },
  { value: 'referral',      label: 'Referral' },
  { value: 'inbound',       label: 'Inbound' },
  { value: 'conference',    label: 'Conference' },
  { value: 'other',         label: 'Other' },
];

const EMAIL_TEMPLATES = [
  {
    subject: 'Are your bartenders ringing every drink?',
    body: `Hi [Name],

I wanted to reach out because we work with bars like [Venue Name] to solve a problem that costs most operators thousands per month — unrung drinks.

VenueScope uses an overhead camera + AI to count every drink served and compare it to your POS. On average, we find a 12–18% gap between drinks poured and drinks rung.

Would you be open to a quick 15-minute demo? I can show you exactly what we found at a bar similar to yours in the first week.

Best,
[Your Name]`,
  },
  {
    subject: 'Know exactly how many drinks were served last Friday night',
    body: `Hi [Name],

Quick question — do you know how many drinks your bar served last Friday, broken down by hour?

Most operators don't, and that's exactly the visibility gap VenueScope closes. Our system counts every drink served from an overhead camera, gives you hourly breakdowns, and flags slow periods so you can optimize staffing.

Several bars in [City] are already using it. Happy to share what their data looks like if you're curious.

15 minutes this week?

Best,
[Your Name]`,
  },
  {
    subject: 'Just wanted to check in, [Venue Name]',
    body: `Hi [Name],

I reached out a few weeks ago about VenueScope — wanted to follow up in case the timing is better now.

If theft prevention or bar efficiency is on your radar for this quarter, I'd love to reconnect. We've had a few bars recently find 15%+ of pours going unrung in their first week.

No pressure at all — just let me know if it makes sense to talk.

Best,
[Your Name]`,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function exportCsv(leads: Lead[]): void {
  const headers = [
    'Venue Name', 'Contact Name', 'Email', 'Phone', 'City', 'Venue Type',
    'Stage', 'Source', 'Deal Value ($/mo)', 'Follow-up Date',
    'Notes Count', 'Last Note', 'Created', 'Updated',
  ];
  const rows = leads.map(l => [
    l.venueName,
    l.contactName,
    l.email,
    l.phone,
    l.city,
    l.venueType,
    STAGE_CONFIG[l.stage].label,
    l.source.replace(/_/g, ' '),
    l.dealValue ?? '',
    l.followUpDate ?? '',
    l.notes.length,
    l.notes.length > 0 ? `"${l.notes[l.notes.length - 1].text.replace(/"/g, '""')}"` : '',
    new Date(l.createdAt).toLocaleDateString(),
    new Date(l.updatedAt).toLocaleDateString(),
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `venuescope_crm_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadLeads(): Lead[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Lead[]) : [];
  } catch {
    return [];
  }
}

function saveLeads(leads: Lead[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
}

function isOverdue(lead: Lead): boolean {
  if (!lead.followUpDate || lead.stage === 'lost' || lead.stage === 'customer') return false;
  return lead.followUpDate < new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatMrr(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value}`;
}

// ─── Stage Pill ───────────────────────────────────────────────────────────────

function StagePill({ stage, size = 'sm' }: { stage: Stage; size?: 'sm' | 'md' }) {
  const cfg = STAGE_CONFIG[stage];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium border ${cfg.bg} ${cfg.color} ${cfg.border} ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ─── Follow-up date display ───────────────────────────────────────────────────

function FollowUpBadge({ date }: { date?: string }) {
  if (!date) return null;
  const overdue = date < new Date().toISOString().slice(0, 10);
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${overdue ? 'text-red-400' : 'text-gray-400'}`}>
      <Calendar className="w-3 h-3" />
      {overdue && <AlertTriangle className="w-3 h-3" />}
      {date}
    </span>
  );
}

// ─── Add/Edit Lead Modal ──────────────────────────────────────────────────────

interface LeadFormData {
  venueName: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  venueType: VenueType;
  stage: Stage;
  source: Source;
  dealValue: string;
  followUpDate: string;
  firstNote: string;
}

const BLANK_FORM: LeadFormData = {
  venueName: '',
  contactName: '',
  email: '',
  phone: '',
  city: '',
  venueType: 'bar',
  stage: 'prospect',
  source: 'cold_outreach',
  dealValue: '',
  followUpDate: '',
  firstNote: '',
};

function leadToForm(lead: Lead): LeadFormData {
  return {
    venueName: lead.venueName,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    venueType: lead.venueType,
    stage: lead.stage,
    source: lead.source,
    dealValue: lead.dealValue != null ? String(lead.dealValue) : '',
    followUpDate: lead.followUpDate ?? '',
    firstNote: '',
  };
}

function inputClass(extra = '') {
  return `w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 text-sm ${extra}`;
}

function labelClass() {
  return 'block text-xs font-medium text-gray-400 mb-1.5';
}

interface AddLeadModalProps {
  initial?: Lead;
  onClose: () => void;
  onSave: (data: LeadFormData) => void;
}

function AddLeadModal({ initial, onClose, onSave }: AddLeadModalProps) {
  const [form, setForm] = useState<LeadFormData>(initial ? leadToForm(initial) : BLANK_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof LeadFormData, string>>>({});

  const set = (field: keyof LeadFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof LeadFormData, string>> = {};
    if (!form.venueName.trim()) errs.venueName = 'Required';
    if (!form.contactName.trim()) errs.contactName = 'Required';
    if (!form.city.trim()) errs.city = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) onSave(form);
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
        initial={{ scale: 0.93, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.93, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="glass-card p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-white">{initial ? 'Edit Lead' : 'Add New Lead'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass()}>Venue Name *</label>
              <input
                value={form.venueName}
                onChange={e => set('venueName', e.target.value)}
                placeholder="The Rusty Nail"
                className={inputClass(errors.venueName ? 'border-red-500/50' : '')}
              />
              {errors.venueName && <p className="text-xs text-red-400 mt-1">{errors.venueName}</p>}
            </div>
            <div>
              <label className={labelClass()}>Contact Name *</label>
              <input
                value={form.contactName}
                onChange={e => set('contactName', e.target.value)}
                placeholder="Jane Smith"
                className={inputClass(errors.contactName ? 'border-red-500/50' : '')}
              />
              {errors.contactName && <p className="text-xs text-red-400 mt-1">{errors.contactName}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass()}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="jane@venue.com"
                className={inputClass()}
              />
            </div>
            <div>
              <label className={labelClass()}>Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="+1 512 555 0100"
                className={inputClass()}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass()}>City *</label>
              <input
                value={form.city}
                onChange={e => set('city', e.target.value)}
                placeholder="Austin, TX"
                className={inputClass(errors.city ? 'border-red-500/50' : '')}
              />
              {errors.city && <p className="text-xs text-red-400 mt-1">{errors.city}</p>}
            </div>
            <div>
              <label className={labelClass()}>Venue Type</label>
              <select
                value={form.venueType}
                onChange={e => set('venueType', e.target.value)}
                className={inputClass()}
              >
                {VENUE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass()}>Stage</label>
              <select
                value={form.stage}
                onChange={e => set('stage', e.target.value)}
                className={inputClass()}
              >
                {(Object.keys(STAGE_CONFIG) as Stage[]).map(s => (
                  <option key={s} value={s}>{STAGE_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Source</label>
              <select
                value={form.source}
                onChange={e => set('source', e.target.value)}
                className={inputClass()}
              >
                {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass()}>Deal Value ($/mo MRR)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="number"
                  min="0"
                  value={form.dealValue}
                  onChange={e => set('dealValue', e.target.value)}
                  placeholder="299"
                  className={inputClass('pl-8')}
                />
              </div>
            </div>
            <div>
              <label className={labelClass()}>Follow-up Date</label>
              <input
                type="date"
                value={form.followUpDate}
                onChange={e => set('followUpDate', e.target.value)}
                className={inputClass()}
              />
            </div>
          </div>

          {!initial && (
            <div>
              <label className={labelClass()}>First Note (optional)</label>
              <textarea
                value={form.firstNote}
                onChange={e => set('firstNote', e.target.value)}
                placeholder="Initial context, intro call outcome, etc."
                rows={3}
                className={inputClass('resize-none')}
              />
            </div>
          )}

          <div className="flex gap-3 pt-2 border-t border-white/10">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              Cancel
            </button>
            <button type="submit" className="flex-1 btn-primary flex items-center justify-center gap-2">
              <Save className="w-4 h-4" />
              {initial ? 'Save Changes' : 'Add Lead'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Lead Detail Drawer ───────────────────────────────────────────────────────

interface LeadDetailProps {
  lead: Lead;
  onClose: () => void;
  onUpdate: (lead: Lead) => void;
  onDelete: (id: string) => void;
}

function LeadDetailDrawer({ lead, onClose, onUpdate, onDelete }: LeadDetailProps) {
  const [noteText, setNoteText] = useState('');
  const [editingFollowUp, setEditingFollowUp] = useState(lead.followUpDate ?? '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const changeStage = (stage: Stage) => {
    onUpdate({ ...lead, stage, updatedAt: new Date().toISOString() });
  };

  const addNote = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    const newNote: LeadNote = { id: uid(), text: trimmed, createdAt: new Date().toISOString() };
    onUpdate({
      ...lead,
      notes: [...lead.notes, newNote],
      updatedAt: new Date().toISOString(),
    });
    setNoteText('');
  };

  const updateFollowUp = (date: string) => {
    setEditingFollowUp(date);
    onUpdate({ ...lead, followUpDate: date || undefined, updatedAt: new Date().toISOString() });
  };

  const handleEdit = (data: LeadFormData) => {
    onUpdate({
      ...lead,
      venueName: data.venueName,
      contactName: data.contactName,
      email: data.email,
      phone: data.phone,
      city: data.city,
      venueType: data.venueType,
      stage: data.stage,
      source: data.source,
      dealValue: data.dealValue ? Number(data.dealValue) : undefined,
      followUpDate: data.followUpDate || undefined,
      updatedAt: new Date().toISOString(),
    });
    setShowEditModal(false);
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(lead.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sortedNotes = [...lead.notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="fixed top-0 right-0 h-full w-full max-w-md glass-card border-l border-white/10 z-50 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-white/10 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <h3 className="text-lg font-bold text-white truncate">{lead.venueName}</h3>
            <p className="text-sm text-gray-400 truncate">{lead.city}</p>
            <div className="mt-2">
              <StagePill stage={lead.stage} size="md" />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowEditModal(true)}
              className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Contact info */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</p>
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
              {lead.contactName}
            </div>
            {lead.email && (
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Mail className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <span className="truncate">{lead.email}</span>
                <button onClick={copyEmail} className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                  {copied ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
            {lead.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Phone className="w-4 h-4 text-gray-500 flex-shrink-0" />
                {lead.phone}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <Building2 className="w-4 h-4 text-gray-500 flex-shrink-0" />
              {VENUE_TYPES.find(t => t.value === lead.venueType)?.label ?? lead.venueType}
              {lead.dealValue != null && (
                <span className="ml-auto text-emerald-400 font-semibold">{formatMrr(lead.dealValue)}/mo</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
              {lead.city}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
              Added {formatDate(lead.createdAt)}
              <span className="text-gray-600">·</span>
              {SOURCES.find(s => s.value === lead.source)?.label ?? lead.source}
            </div>
          </div>

          {/* Stage changer */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Change Stage</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(STAGE_CONFIG) as Stage[]).map(s => (
                <button
                  key={s}
                  onClick={() => changeStage(s)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    lead.stage === s
                      ? `${STAGE_CONFIG[s].bg} ${STAGE_CONFIG[s].color} ${STAGE_CONFIG[s].border}`
                      : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {STAGE_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Follow-up date */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Follow-up Date</p>
            <input
              type="date"
              value={editingFollowUp}
              onChange={e => updateFollowUp(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30"
            />
            {isOverdue(lead) && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Overdue
              </p>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex gap-2">
            {lead.stage !== 'customer' && (
              <button
                onClick={() => changeStage('customer')}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-sm font-medium hover:bg-emerald-500/30 transition-colors"
              >
                <CheckCircle className="w-4 h-4" /> Mark as Customer
              </button>
            )}
            {lead.stage !== 'lost' && (
              <button
                onClick={() => changeStage('lost')}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-zinc-500/20 text-zinc-400 border border-zinc-500/30 text-sm font-medium hover:bg-zinc-500/30 transition-colors"
              >
                <X className="w-4 h-4" /> Archive (Lost)
              </button>
            )}
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Notes ({lead.notes.length})
            </p>
            <div className="space-y-2">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add a note..."
                rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 resize-none"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); }}
              />
              <button
                onClick={addNote}
                disabled={!noteText.trim()}
                className="btn-primary text-sm px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Add Note
              </button>
            </div>

            {sortedNotes.length > 0 && (
              <div className="mt-3 space-y-2">
                {sortedNotes.map(note => (
                  <div key={note.id} className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{note.text}</p>
                    <p className="text-xs text-gray-500 mt-1.5">{formatDate(note.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-white/10 flex-shrink-0">
          {showDeleteConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-400 flex-1">Delete this lead?</span>
              <button
                onClick={() => onDelete(lead.id)}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-sm hover:bg-red-500/30 transition-colors"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 border border-white/10 text-sm hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete Lead
            </button>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showEditModal && (
          <AddLeadModal
            initial={lead}
            onClose={() => setShowEditModal(false)}
            onSave={handleEdit}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Email Templates Modal ────────────────────────────────────────────────────

function EmailTemplatesModal({ onClose }: { onClose: () => void }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copy = (index: number) => {
    const tpl = EMAIL_TEMPLATES[index];
    navigator.clipboard.writeText(`Subject: ${tpl.subject}\n\n${tpl.body}`);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
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
        initial={{ scale: 0.93, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.93, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="glass-card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-white">Cold Email Templates</h3>
            <p className="text-sm text-gray-400 mt-0.5">Copy and personalise before sending</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5">
          {EMAIL_TEMPLATES.map((tpl, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Subject</p>
                  <p className="text-sm font-semibold text-white">{tpl.subject}</p>
                </div>
                <button
                  onClick={() => copy(i)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    copiedIndex === i
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-white/5 text-gray-400 border-white/10 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {copiedIndex === i ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedIndex === i ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{tpl.body}</pre>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Kanban Card ──────────────────────────────────────────────────────────────

function KanbanCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const overdue = isOverdue(lead);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={onClick}
      className="bg-white/5 border border-white/10 rounded-xl p-3 cursor-pointer hover:border-purple-500/30 hover:bg-white/8 transition-all group"
      whileHover={{ y: -1 }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-semibold text-white leading-snug group-hover:text-purple-300 transition-colors">
          {lead.venueName}
        </p>
        <ChevronRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 flex-shrink-0 mt-0.5" />
      </div>
      <p className="text-xs text-gray-400 mb-2">{lead.city} · {lead.contactName}</p>
      <div className="flex items-center justify-between gap-2">
        {lead.followUpDate ? (
          <FollowUpBadge date={lead.followUpDate} />
        ) : (
          <span />
        )}
        {lead.dealValue != null && (
          <span className="text-xs text-emerald-400 font-semibold">{formatMrr(lead.dealValue)}</span>
        )}
      </div>
      {overdue && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-400">
          <AlertTriangle className="w-3 h-3" /> Follow-up overdue
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SalesCRM() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [view, setView] = useState<'pipeline' | 'list'>('pipeline');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [listFilter, setListFilter] = useState<ListFilter>('all');

  // Load from localStorage on mount
  useEffect(() => {
    setLeads(loadLeads());
  }, []);

  const persistLeads = useCallback((updated: Lead[]) => {
    setLeads(updated);
    saveLeads(updated);
  }, []);

  const handleAddLead = (data: LeadFormData) => {
    const now = new Date().toISOString();
    const notes: LeadNote[] = data.firstNote.trim()
      ? [{ id: uid(), text: data.firstNote.trim(), createdAt: now }]
      : [];
    const newLead: Lead = {
      id: uid(),
      venueName: data.venueName,
      contactName: data.contactName,
      email: data.email,
      phone: data.phone,
      city: data.city,
      venueType: data.venueType,
      stage: data.stage,
      source: data.source,
      notes,
      dealValue: data.dealValue ? Number(data.dealValue) : undefined,
      followUpDate: data.followUpDate || undefined,
      createdAt: now,
      updatedAt: now,
    };
    persistLeads([...leads, newLead]);
    setShowAddModal(false);
  };

  const handleUpdateLead = (updated: Lead) => {
    const next = leads.map(l => l.id === updated.id ? updated : l);
    persistLeads(next);
    // Keep the drawer in sync
    setSelectedLead(updated);
  };

  const handleDeleteLead = (id: string) => {
    persistLeads(leads.filter(l => l.id !== id));
    setSelectedLead(null);
  };

  // Stats
  const today = new Date().toISOString().slice(0, 10);
  const overdueLeads = leads.filter(l => l.followUpDate && l.followUpDate < today && l.stage !== 'lost' && l.stage !== 'customer');
  const pipelineMrr = leads.filter(l => l.stage !== 'lost').reduce((sum, l) => sum + (l.dealValue ?? 0), 0);

  const stageCounts = (Object.keys(STAGE_CONFIG) as Stage[]).reduce<Record<Stage, number>>(
    (acc, s) => { acc[s] = leads.filter(l => l.stage === s).length; return acc; },
    {} as Record<Stage, number>
  );

  // Filtered/sorted leads for list view
  const filteredLeads = leads
    .filter(l => {
      if (listFilter === 'active') return l.stage !== 'lost';
      if (listFilter === 'lost') return l.stage === 'lost';
      if (listFilter === 'overdue') return isOverdue(l);
      return true;
    })
    .filter(l => {
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        l.venueName.toLowerCase().includes(q) ||
        l.contactName.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortField === 'stage') {
        const order: Stage[] = ['prospect', 'contacted', 'demo', 'trial', 'customer', 'lost'];
        return order.indexOf(a.stage) - order.indexOf(b.stage);
      }
      if (sortField === 'followUpDate') {
        const da = a.followUpDate ?? '9999-99-99';
        const db = b.followUpDate ?? '9999-99-99';
        return da.localeCompare(db);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-1">Sales CRM</h1>
            <p className="text-gray-400 text-sm">{leads.length} lead{leads.length !== 1 ? 's' : ''} in pipeline</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {leads.length > 0 && (
              <motion.button
                onClick={() => exportCsv(leads)}
                className="btn-secondary flex items-center gap-2 text-sm"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Download className="w-4 h-4" />
                Export CSV
              </motion.button>
            )}
            <motion.button
              onClick={() => setShowEmailModal(true)}
              className="btn-secondary flex items-center gap-2 text-sm"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <FileText className="w-4 h-4" />
              Email Templates
            </motion.button>
            <motion.button
              onClick={() => setShowAddModal(true)}
              className="btn-primary flex items-center gap-2 text-sm"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Plus className="w-4 h-4" />
              Add Lead
            </motion.button>
          </div>
        </div>

        {/* ── Stats bar ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="glass-card p-4">
            <p className="text-xs text-gray-400 mb-1">Total Leads</p>
            <p className="text-2xl font-bold text-white">{leads.length}</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-xs text-gray-400 mb-1">MRR Pipeline</p>
            <p className="text-2xl font-bold text-emerald-400">{pipelineMrr > 0 ? formatMrr(pipelineMrr) : '—'}</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-xs text-gray-400 mb-1">Overdue Follow-ups</p>
            <p className={`text-2xl font-bold ${overdueLeads.length > 0 ? 'text-red-400' : 'text-white'}`}>
              {overdueLeads.length}
            </p>
          </div>
          <div className="glass-card p-4">
            <p className="text-xs text-gray-400 mb-2">By Stage</p>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(STAGE_CONFIG) as Stage[]).map(s => stageCounts[s] > 0 && (
                <span
                  key={s}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium border ${STAGE_CONFIG[s].bg} ${STAGE_CONFIG[s].color} ${STAGE_CONFIG[s].border}`}
                >
                  {stageCounts[s]}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── View toggle + search ── */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {/* Pipeline / List toggle */}
          <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-1 gap-1">
            <button
              onClick={() => setView('pipeline')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                view === 'pipeline' ? 'bg-purple-500/30 text-purple-300 border border-purple-500/30' : 'text-gray-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" /> <span className="hidden sm:inline">Pipeline</span>
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                view === 'list' ? 'bg-purple-500/30 text-purple-300 border border-purple-500/30' : 'text-gray-400 hover:text-white'
              }`}
            >
              <List className="w-4 h-4" /> <span className="hidden sm:inline">List</span>
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search venues, contacts..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30"
            />
          </div>

          {/* List-view controls */}
          {view === 'list' && (
            <>
              <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
                {(['all', 'active', 'lost', 'overdue'] as ListFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setListFilter(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-all ${
                      listFilter === f ? 'bg-purple-500/30 text-purple-300' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Filter className="w-3 h-3 inline mr-1" />
                    {f}
                  </button>
                ))}
              </div>
              <select
                value={sortField}
                onChange={e => setSortField(e.target.value as SortField)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
              >
                <option value="createdAt">
                  Sort: Date Added
                </option>
                <option value="stage">Sort: Stage</option>
                <option value="followUpDate">Sort: Follow-up</option>
              </select>
            </>
          )}
        </div>

        {/* ── Empty state ── */}
        {leads.length === 0 && (
          <motion.div
            className="glass-card p-12 text-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <Target className="w-14 h-14 mx-auto mb-4 text-gray-600" />
            <h3 className="text-xl font-bold text-white mb-2">No leads yet</h3>
            <p className="text-gray-400 mb-5">Add your first prospect to start tracking your sales pipeline.</p>
            <button onClick={() => setShowAddModal(true)} className="btn-primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add First Lead
            </button>
          </motion.div>
        )}

        {/* ── Pipeline / Kanban view ── */}
        {leads.length > 0 && view === 'pipeline' && (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-4 min-w-max">
              {PIPELINE_STAGES.map(stage => {
                const cfg = STAGE_CONFIG[stage];
                const stageLeads = leads.filter(l => l.stage === stage && (
                  !searchTerm || l.venueName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  l.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  l.city.toLowerCase().includes(searchTerm.toLowerCase())
                ));
                const stageMrr = stageLeads.reduce((s, l) => s + (l.dealValue ?? 0), 0);
                return (
                  <div key={stage} className="w-60 flex-shrink-0">
                    {/* Column header */}
                    <div className={`flex items-center justify-between mb-3 px-1`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-xs text-gray-500 bg-white/5 px-1.5 py-0.5 rounded-full">
                          {stageLeads.length}
                        </span>
                      </div>
                      {stageMrr > 0 && (
                        <span className="text-xs text-emerald-400 font-medium">{formatMrr(stageMrr)}</span>
                      )}
                    </div>
                    {/* Cards */}
                    <div className={`min-h-[120px] rounded-xl border ${cfg.border} bg-white/2 p-2 space-y-2`}>
                      <AnimatePresence>
                        {stageLeads.map(lead => (
                          <KanbanCard
                            key={lead.id}
                            lead={lead}
                            onClick={() => setSelectedLead(lead)}
                          />
                        ))}
                      </AnimatePresence>
                      {stageLeads.length === 0 && (
                        <p className="text-xs text-gray-600 text-center py-4">No leads</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Lost column summary */}
              <div className="w-40 flex-shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span className="w-2 h-2 rounded-full bg-zinc-400" />
                  <span className="text-sm font-semibold text-zinc-400">Lost</span>
                  <span className="text-xs text-gray-500 bg-white/5 px-1.5 py-0.5 rounded-full">
                    {stageCounts['lost']}
                  </span>
                </div>
                <div className="min-h-[80px] rounded-xl border border-zinc-500/20 bg-white/2 p-3 flex flex-col items-center justify-center">
                  {stageCounts['lost'] > 0 ? (
                    <button
                      onClick={() => { setView('list'); setListFilter('lost'); }}
                      className="text-xs text-zinc-400 hover:text-white transition-colors underline underline-offset-2"
                    >
                      View {stageCounts['lost']} in list
                    </button>
                  ) : (
                    <p className="text-xs text-gray-600 text-center">None</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── List view ── */}
        {leads.length > 0 && view === 'list' && (
          <div className="glass-card overflow-hidden">
            {filteredLeads.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">No leads match your filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left">
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Venue</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Contact</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">City</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Stage</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Follow-up</span>
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">
                        <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> MRR</span>
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        <span className="flex items-center gap-1"><SortAsc className="w-3 h-3" /> Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence>
                      {filteredLeads.map((lead, i) => (
                        <motion.tr
                          key={lead.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                          onClick={() => setSelectedLead(lead)}
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-white">{lead.venueName}</p>
                            <p className="text-xs text-gray-500">{VENUE_TYPES.find(t => t.value === lead.venueType)?.label}</p>
                          </td>
                          <td className="px-4 py-3 text-gray-300 hidden md:table-cell">
                            <p>{lead.contactName}</p>
                            {lead.email && <p className="text-xs text-gray-500 truncate max-w-[160px]">{lead.email}</p>}
                          </td>
                          <td className="px-4 py-3 text-gray-400 hidden lg:table-cell">{lead.city}</td>
                          <td className="px-4 py-3">
                            <StagePill stage={lead.stage} />
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <FollowUpBadge date={lead.followUpDate} />
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            {lead.dealValue != null ? (
                              <span className="text-emerald-400 font-semibold">{formatMrr(lead.dealValue)}</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={e => { e.stopPropagation(); setSelectedLead(lead); }}
                              className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
                            >
                              Open <ChevronRight className="w-3 h-3" />
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </motion.div>

      {/* ── Modals / Drawers ── */}
      <AnimatePresence>
        {showAddModal && (
          <AddLeadModal onClose={() => setShowAddModal(false)} onSave={handleAddLead} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEmailModal && (
          <EmailTemplatesModal onClose={() => setShowEmailModal(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedLead && (
          <LeadDetailDrawer
            key={selectedLead.id}
            lead={selectedLead}
            onClose={() => setSelectedLead(null)}
            onUpdate={handleUpdateLead}
            onDelete={handleDeleteLead}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
