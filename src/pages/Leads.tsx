/**
 * Leads Page - NFC Lead Capture Dashboard (BETA)
 * 
 * Premium UI for lead capture via NFC tags.
 * Shows stats, lead list, location breakdown.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  TrendingUp, 
  TrendingDown,
  Smartphone,
  MapPin,
  Search,
  Download,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  Target,
  HelpCircle,
  ExternalLink,
  Filter,
  Plus,
  FileDown,
  Check,
} from 'lucide-react';
import { haptic } from '../utils/haptics';

interface Lead {
  id: string;
  phone: string;
  capturedAt: Date;
  source: string;
  status: 'active' | 'opted-out';
}

// Initial mock data for beta display
const INITIAL_LEADS: Lead[] = [
  { id: '1', phone: '***-***-4521', capturedAt: new Date(Date.now() - 1000 * 60 * 30), source: 'Table 5', status: 'active' },
  { id: '2', phone: '***-***-8834', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 2), source: 'Bar Top', status: 'active' },
  { id: '3', phone: '***-***-2219', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 5), source: 'Table 3', status: 'active' },
  { id: '4', phone: '***-***-7762', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), source: 'Patio', status: 'active' },
  { id: '5', phone: '***-***-1198', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 26), source: 'Table 1', status: 'active' },
  { id: '6', phone: '***-***-5543', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 48), source: 'Table 5', status: 'active' },
  { id: '7', phone: '***-***-3347', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 50), source: 'Table 2', status: 'active' },
  { id: '8', phone: '***-***-9901', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 72), source: 'Bar Top', status: 'opted-out' },
];

const MOCK_STATS = {
  total: 47,
  thisWeek: 12,
  lastWeek: 9,
  estimatedVisitors: 312,
  bySource: [
    { source: 'Table 5', count: 14 },
    { source: 'Bar Top', count: 11 },
    { source: 'Table 3', count: 8 },
    { source: 'Patio', count: 7 },
    { source: 'Table 1', count: 5 },
    { source: 'Table 2', count: 2 },
  ],
};

type TimeRange = '7d' | '14d' | '30d' | 'all';

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Leads() {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [showBetaBanner, setShowBetaBanner] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [leads, setLeads] = useState<Lead[]>(INITIAL_LEADS);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadSource, setNewLeadSource] = useState('');
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  
  const weekDelta = MOCK_STATS.lastWeek > 0 
    ? Math.round(((MOCK_STATS.thisWeek - MOCK_STATS.lastWeek) / MOCK_STATS.lastWeek) * 100)
    : 0;
  
  const conversionRate = MOCK_STATS.estimatedVisitors > 0
    ? Math.round((MOCK_STATS.total / MOCK_STATS.estimatedVisitors) * 100)
    : 0;
  
  const activeLeads = leads.filter(l => l.status === 'active');
  
  // Filter leads
  const filteredLeads = leads.filter(lead => {
    if (sourceFilter && lead.source !== sourceFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return lead.phone.includes(query) || lead.source.toLowerCase().includes(query);
    }
    return true;
  });
  
  // Handle select all toggle
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map(l => l.id)));
    }
    setSelectAll(!selectAll);
  };
  
  // Handle individual lead selection
  const handleSelectLead = (id: string) => {
    const newSelected = new Set(selectedLeads);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedLeads(newSelected);
    setSelectAll(newSelected.size === filteredLeads.length);
  };
  
  // Format phone number as user types
  const formatPhoneInput = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };
  
  // Add new lead
  const handleAddLead = () => {
    if (!newLeadPhone.trim()) return;
    
    const newLead: Lead = {
      id: Date.now().toString(),
      phone: newLeadPhone,
      capturedAt: new Date(),
      source: newLeadSource.trim() || 'Manual Entry',
      status: 'active',
    };
    
    setLeads([newLead, ...leads]);
    setNewLeadPhone('');
    setNewLeadSource('');
    setShowAddModal(false);
    haptic('success');
  };
  
  // Export leads to CSV
  const handleExport = () => {
    haptic('medium');
    
    // Get leads to export (selected or all filtered)
    const leadsToExport = selectedLeads.size > 0 
      ? filteredLeads.filter(l => selectedLeads.has(l.id))
      : filteredLeads;
    
    if (leadsToExport.length === 0) {
      alert('No leads to export');
      return;
    }
    
    // Create CSV content
    const headers = ['Phone', 'Source', 'Captured Date', 'Captured Time', 'Status'];
    const rows = leadsToExport.map(lead => [
      lead.phone,
      lead.source,
      lead.capturedAt.toLocaleDateString(),
      lead.capturedAt.toLocaleTimeString(),
      lead.status,
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `leads-export-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    haptic('success');
  };

  return (
    <div className="space-y-4 pb-24">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">Leads</h1>
          <span className="px-2 py-0.5 text-[10px] font-bold bg-primary/20 text-primary border border-primary/30 rounded-full uppercase tracking-wider">
            Beta
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <motion.button
            onClick={() => { haptic('light'); setShowAddModal(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
            whileTap={{ scale: 0.95 }}
          >
            <Plus className="w-4 h-4" />
            Add
          </motion.button>
          <motion.button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-300 text-sm font-medium hover:text-white transition-colors"
            whileTap={{ scale: 0.95 }}
            title={selectedLeads.size > 0 ? `Export ${selectedLeads.size} selected` : 'Export all'}
          >
            <FileDown className="w-4 h-4" />
            {selectedLeads.size > 0 ? `(${selectedLeads.size})` : ''}
          </motion.button>
        </div>
      </div>
      
      {/* Add Lead Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-warm-900 border border-warm-700 rounded-2xl p-6 w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-primary" />
                  Add Lead
                </h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-warm-500 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-warm-400 mb-2">Phone Number *</label>
                  <input
                    type="tel"
                    placeholder="555-123-4567"
                    value={newLeadPhone}
                    onChange={(e) => setNewLeadPhone(formatPhoneInput(e.target.value))}
                    className="w-full px-4 py-3 bg-warm-800 border border-warm-700 rounded-xl text-white placeholder-warm-500 focus:outline-none focus:border-primary/50 font-mono"
                    autoFocus
                  />
                </div>
                
                <div>
                  <label className="block text-sm text-warm-400 mb-2">Source / Location</label>
                  <input
                    type="text"
                    placeholder="e.g., Walk-in, Referral, Event..."
                    value={newLeadSource}
                    onChange={(e) => setNewLeadSource(e.target.value)}
                    className="w-full px-4 py-3 bg-warm-800 border border-warm-700 rounded-xl text-white placeholder-warm-500 focus:outline-none focus:border-primary/50"
                  />
                  <p className="text-xs text-warm-500 mt-1">Optional - defaults to "Manual Entry"</p>
                </div>
                
                <div className="flex gap-3 pt-2">
                  <motion.button
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-3 rounded-xl bg-warm-800 border border-warm-700 text-warm-300 font-medium hover:text-white transition-colors"
                    whileTap={{ scale: 0.98 }}
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    onClick={handleAddLead}
                    disabled={!newLeadPhone.trim()}
                    className="flex-1 py-3 rounded-xl bg-primary text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
                    whileTap={{ scale: 0.98 }}
                  >
                    Add Lead
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Compact Beta Banner */}
      <AnimatePresence>
        {showBetaBanner && (
          <motion.div 
            className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-lg px-4 py-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="flex items-center gap-2 text-sm">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-warm-200">NFC lead capture is in beta</span>
              <span className="text-warm-500">•</span>
              <span className="text-warm-400">Showing sample data</span>
            </div>
            <button 
              onClick={() => setShowBetaBanner(false)}
              className="text-warm-500 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Time Range Selector */}
      <div className="flex gap-1 p-1 bg-warm-800/50 rounded-lg border border-warm-700 w-fit">
        {[
          { value: '7d' as const, label: '7 Days' },
          { value: '14d' as const, label: '14 Days' },
          { value: '30d' as const, label: '30 Days' },
          { value: 'all' as const, label: 'All Time' },
        ].map((option) => (
          <motion.button
            key={option.value}
            onClick={() => { haptic('selection'); setTimeRange(option.value); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              timeRange === option.value
                ? 'bg-primary text-white'
                : 'text-warm-400 hover:text-white'
            }`}
            whileTap={{ scale: 0.95 }}
          >
            {option.label}
          </motion.button>
        ))}
      </div>
      
      {/* Hero Stats */}
      <motion.div 
        className="bg-gradient-to-br from-warm-800/80 to-warm-900/80 border border-whoop-divider rounded-2xl p-5"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="grid grid-cols-3 gap-4">
          {/* Total Leads */}
          <div className="text-center">
            <div className="text-4xl font-bold text-white mb-1">
              {MOCK_STATS.total}
            </div>
            <div className="text-xs text-warm-400 uppercase tracking-wide">
              Total Leads
            </div>
          </div>
          
          {/* This Week */}
          <div className="text-center border-x border-warm-700">
            <div className="text-4xl font-bold text-white mb-1">
              {MOCK_STATS.thisWeek}
            </div>
            <div className="text-xs text-warm-400 uppercase tracking-wide mb-1">
              This Week
            </div>
            {weekDelta !== 0 && (
              <div className={`inline-flex items-center gap-1 text-xs font-medium ${weekDelta > 0 ? 'text-recovery-high' : 'text-recovery-low'}`}>
                {weekDelta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {weekDelta > 0 ? '+' : ''}{weekDelta}%
              </div>
            )}
          </div>
          
          {/* Conversion Rate */}
          <div className="text-center">
            <div className="text-4xl font-bold text-primary mb-1">
              {conversionRate}%
            </div>
            <div className="text-xs text-warm-400 uppercase tracking-wide">
              Capture Rate
            </div>
          </div>
        </div>
      </motion.div>
      
      {/* Location Breakdown */}
      <motion.div 
        className="bg-whoop-panel border border-whoop-divider rounded-xl p-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            By Location
          </h3>
          <span className="text-xs text-warm-500">{MOCK_STATS.bySource.length} locations</span>
        </div>
        
        <div className="space-y-2">
          {MOCK_STATS.bySource.slice(0, 5).map((item, idx) => {
            const maxCount = Math.max(...MOCK_STATS.bySource.map(s => s.count));
            const width = (item.count / maxCount) * 100;
            const isFiltered = sourceFilter === item.source;
            
            return (
              <motion.button
                key={idx}
                onClick={() => {
                  haptic('light');
                  setSourceFilter(isFiltered ? null : item.source);
                }}
                className={`w-full flex items-center gap-3 p-1 rounded-lg transition-colors ${
                  isFiltered ? 'bg-primary/10' : 'hover:bg-warm-800/50'
                }`}
                whileTap={{ scale: 0.98 }}
              >
                <div className="w-20 text-sm text-warm-300 text-left flex-shrink-0">{item.source}</div>
                <div className="flex-1 h-5 bg-warm-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={{ duration: 0.5, delay: idx * 0.05 }}
                    className={`h-full rounded-full ${isFiltered ? 'bg-primary' : 'bg-primary/60'}`}
                  />
                </div>
                <div className="w-10 text-sm text-white font-semibold text-right">{item.count}</div>
              </motion.button>
            );
          })}
        </div>
        
        {sourceFilter && (
          <button
            onClick={() => setSourceFilter(null)}
            className="mt-3 text-xs text-primary flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Clear filter
          </button>
        )}
      </motion.div>
      
      {/* Recent Leads */}
      <motion.div 
        className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {/* Header with search */}
        <div className="p-4 border-b border-whoop-divider space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={handleSelectAll}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  selectAll 
                    ? 'bg-primary border-primary' 
                    : selectedLeads.size > 0 
                      ? 'bg-primary/30 border-primary/50'
                      : 'border-warm-600 hover:border-warm-500'
                }`}
              >
                {(selectAll || selectedLeads.size > 0) && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </button>
              <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-primary" />
                {selectedLeads.size > 0 ? `${selectedLeads.size} Selected` : 'Recent Leads'}
              </h3>
            </div>
            <span className="text-xs text-warm-500">
              {activeLeads.length} active
            </span>
          </div>
          
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-500" />
            <input
              type="text"
              placeholder="Search by phone or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-warm-800 border border-warm-700 rounded-lg text-sm text-white placeholder-warm-500 focus:outline-none focus:border-primary/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        
        {/* Lead List */}
        <div className="divide-y divide-whoop-divider max-h-80 overflow-y-auto">
          {filteredLeads.length > 0 ? (
            filteredLeads.map((lead, idx) => (
              <motion.div 
                key={lead.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.03 }}
                className={`p-4 flex items-center justify-between ${
                  lead.status === 'opted-out' ? 'opacity-40' : ''
                } ${selectedLeads.has(lead.id) ? 'bg-primary/5' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleSelectLead(lead.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                      selectedLeads.has(lead.id) 
                        ? 'bg-primary border-primary' 
                        : 'border-warm-600 hover:border-warm-500'
                    }`}
                  >
                    {selectedLeads.has(lead.id) && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </button>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    lead.status === 'opted-out' ? 'bg-warm-800' : 'bg-primary/10'
                  }`}>
                    <Smartphone className={`w-5 h-5 ${
                      lead.status === 'opted-out' ? 'text-warm-600' : 'text-primary'
                    }`} />
                  </div>
                  <div>
                    <div className="text-white font-medium font-mono text-sm">{lead.phone}</div>
                    <div className="text-xs text-warm-400 flex items-center gap-2">
                      <span className="text-primary">{lead.source}</span>
                      <span className="text-warm-600">•</span>
                      <span>{formatTimeAgo(lead.capturedAt)}</span>
                    </div>
                  </div>
                </div>
                {lead.status === 'opted-out' && (
                  <span className="text-[10px] text-warm-500 bg-warm-800 px-2 py-1 rounded uppercase tracking-wide">
                    Opted out
                  </span>
                )}
              </motion.div>
            ))
          ) : (
            <div className="p-8 text-center text-warm-500">
              No leads found matching your search
            </div>
          )}
        </div>
      </motion.div>
      
      {/* How It Works - Collapsible */}
      <motion.div 
        className="bg-warm-800/30 border border-warm-700 rounded-xl overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <button
          onClick={() => { haptic('light'); setShowHowItWorks(!showHowItWorks); }}
          className="w-full p-4 flex items-center justify-between text-left"
        >
          <h3 className="text-sm font-semibold text-warm-200 flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            How It Works
          </h3>
          {showHowItWorks ? (
            <ChevronUp className="w-4 h-4 text-warm-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-warm-500" />
          )}
        </button>
        
        <AnimatePresence>
          {showHowItWorks && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { step: '1', title: 'Place Tags', desc: 'Put NFC tags on tables, bar, patio' },
                    { step: '2', title: 'Guest Taps', desc: 'Opens SMS with pre-filled message' },
                    { step: '3', title: 'Instant Opt-in', desc: 'They hit send, you get the lead' },
                    { step: '4', title: 'Engage', desc: 'Message about specials & events' },
                  ].map((item) => (
                    <div key={item.step} className="bg-warm-800/50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                          {item.step}
                        </div>
                        <span className="text-white text-sm font-medium">{item.title}</span>
                      </div>
                      <p className="text-xs text-warm-400 ml-7">{item.desc}</p>
                    </div>
                  ))}
                </div>
                
                <a
                  href="#"
                  className="flex items-center justify-center gap-2 w-full py-2 bg-primary/10 border border-primary/30 rounded-lg text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Get NFC Tags
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      
    </div>
  );
}

export default Leads;
