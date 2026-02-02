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

interface LeadEnrichment {
  location?: string;      // From area code (FREE)
  lineType?: 'mobile' | 'landline' | 'tollfree'; // Pattern detection (FREE)
  timezone?: string;      // From area code (FREE)
  region?: string;        // State/region (FREE)
}

interface Lead {
  id: string;
  phone: string;
  capturedAt: Date;
  source: string;
  status: 'active' | 'opted-out';
  enrichment?: LeadEnrichment;
}

// US Area Code to Location mapping (FREE - no API needed)
const AREA_CODE_MAP: Record<string, string> = {
  '201': 'New Jersey', '202': 'Washington DC', '203': 'Connecticut', '205': 'Alabama',
  '206': 'Seattle, WA', '207': 'Maine', '208': 'Idaho', '209': 'California',
  '210': 'San Antonio, TX', '212': 'New York, NY', '213': 'Los Angeles, CA', '214': 'Dallas, TX',
  '215': 'Philadelphia, PA', '216': 'Cleveland, OH', '217': 'Illinois', '218': 'Minnesota',
  '219': 'Indiana', '224': 'Illinois', '225': 'Louisiana', '228': 'Mississippi',
  '229': 'Georgia', '231': 'Michigan', '234': 'Ohio', '239': 'Florida',
  '240': 'Maryland', '248': 'Michigan', '251': 'Alabama', '252': 'North Carolina',
  '253': 'Washington', '254': 'Texas', '256': 'Alabama', '260': 'Indiana',
  '262': 'Wisconsin', '267': 'Pennsylvania', '269': 'Michigan', '270': 'Kentucky',
  '272': 'Pennsylvania', '276': 'Virginia', '281': 'Houston, TX', '301': 'Maryland',
  '302': 'Delaware', '303': 'Denver, CO', '304': 'West Virginia', '305': 'Miami, FL',
  '307': 'Wyoming', '308': 'Nebraska', '309': 'Illinois', '310': 'Los Angeles, CA',
  '312': 'Chicago, IL', '313': 'Detroit, MI', '314': 'St. Louis, MO', '315': 'New York',
  '316': 'Kansas', '317': 'Indianapolis, IN', '318': 'Louisiana', '319': 'Iowa',
  '320': 'Minnesota', '321': 'Florida', '323': 'Los Angeles, CA', '325': 'Texas',
  '330': 'Ohio', '331': 'Illinois', '332': 'New York, NY', '334': 'Alabama',
  '336': 'North Carolina', '337': 'Louisiana', '339': 'Massachusetts', '340': 'US Virgin Islands',
  '346': 'Houston, TX', '347': 'New York, NY', '351': 'Massachusetts', '352': 'Florida',
  '360': 'Washington', '361': 'Texas', '364': 'Kentucky', '380': 'Ohio',
  '385': 'Utah', '386': 'Florida', '401': 'Rhode Island', '402': 'Nebraska',
  '404': 'Atlanta, GA', '405': 'Oklahoma City, OK', '406': 'Montana', '407': 'Orlando, FL',
  '408': 'San Jose, CA', '409': 'Texas', '410': 'Baltimore, MD', '412': 'Pittsburgh, PA',
  '413': 'Massachusetts', '414': 'Milwaukee, WI', '415': 'San Francisco, CA', '417': 'Missouri',
  '419': 'Ohio', '423': 'Tennessee', '424': 'Los Angeles, CA', '425': 'Washington',
  '430': 'Texas', '432': 'Texas', '434': 'Virginia', '435': 'Utah',
  '440': 'Ohio', '442': 'California', '443': 'Maryland', '445': 'Pennsylvania',
  '447': 'Illinois', '458': 'Oregon', '463': 'Indiana', '469': 'Dallas, TX',
  '470': 'Atlanta, GA', '475': 'Connecticut', '478': 'Georgia', '479': 'Arkansas',
  '480': 'Phoenix, AZ', '484': 'Pennsylvania', '501': 'Arkansas', '502': 'Louisville, KY',
  '503': 'Portland, OR', '504': 'New Orleans, LA', '505': 'New Mexico', '507': 'Minnesota',
  '508': 'Massachusetts', '509': 'Washington', '510': 'Oakland, CA', '512': 'Austin, TX',
  '513': 'Cincinnati, OH', '515': 'Iowa', '516': 'Long Island, NY', '517': 'Michigan',
  '518': 'New York', '520': 'Arizona', '530': 'California', '531': 'Nebraska',
  '534': 'Wisconsin', '539': 'Oklahoma', '540': 'Virginia', '541': 'Oregon',
  '551': 'New Jersey', '559': 'California', '561': 'Florida', '562': 'Long Beach, CA',
  '563': 'Iowa', '567': 'Ohio', '570': 'Pennsylvania', '571': 'Virginia',
  '573': 'Missouri', '574': 'Indiana', '575': 'New Mexico', '580': 'Oklahoma',
  '585': 'Rochester, NY', '586': 'Michigan', '601': 'Mississippi', '602': 'Phoenix, AZ',
  '603': 'New Hampshire', '605': 'South Dakota', '606': 'Kentucky', '607': 'New York',
  '608': 'Wisconsin', '609': 'New Jersey', '610': 'Pennsylvania', '612': 'Minneapolis, MN',
  '614': 'Columbus, OH', '615': 'Nashville, TN', '616': 'Michigan', '617': 'Boston, MA',
  '618': 'Illinois', '619': 'San Diego, CA', '620': 'Kansas', '623': 'Arizona',
  '626': 'California', '628': 'San Francisco, CA', '629': 'Tennessee', '630': 'Illinois',
  '631': 'Long Island, NY', '636': 'Missouri', '641': 'Iowa', '646': 'New York, NY',
  '650': 'California', '651': 'St. Paul, MN', '657': 'California', '660': 'Missouri',
  '661': 'California', '662': 'Mississippi', '667': 'Maryland', '669': 'San Jose, CA',
  '678': 'Atlanta, GA', '680': 'New York', '681': 'West Virginia', '682': 'Texas',
  '689': 'Florida', '701': 'North Dakota', '702': 'Las Vegas, NV', '703': 'Virginia',
  '704': 'Charlotte, NC', '706': 'Georgia', '707': 'California', '708': 'Illinois',
  '712': 'Iowa', '713': 'Houston, TX', '714': 'Orange County, CA', '715': 'Wisconsin',
  '716': 'Buffalo, NY', '717': 'Pennsylvania', '718': 'New York, NY', '719': 'Colorado',
  '720': 'Denver, CO', '724': 'Pennsylvania', '725': 'Las Vegas, NV', '726': 'Texas',
  '727': 'Florida', '731': 'Tennessee', '732': 'New Jersey', '734': 'Michigan',
  '737': 'Austin, TX', '740': 'Ohio', '743': 'North Carolina', '747': 'California',
  '754': 'Florida', '757': 'Virginia', '760': 'California', '762': 'Georgia',
  '763': 'Minnesota', '765': 'Indiana', '769': 'Mississippi', '770': 'Atlanta, GA',
  '772': 'Florida', '773': 'Chicago, IL', '774': 'Massachusetts', '775': 'Nevada',
  '779': 'Illinois', '781': 'Massachusetts', '785': 'Kansas', '786': 'Miami, FL',
  '801': 'Salt Lake City, UT', '802': 'Vermont', '803': 'South Carolina', '804': 'Virginia',
  '805': 'California', '806': 'Texas', '808': 'Hawaii', '810': 'Michigan',
  '812': 'Indiana', '813': 'Tampa, FL', '814': 'Pennsylvania', '815': 'Illinois',
  '816': 'Kansas City, MO', '817': 'Fort Worth, TX', '818': 'Los Angeles, CA', '820': 'California',
  '828': 'North Carolina', '830': 'Texas', '831': 'California', '832': 'Houston, TX',
  '843': 'South Carolina', '845': 'New York', '847': 'Illinois', '848': 'New Jersey',
  '850': 'Florida', '854': 'South Carolina', '856': 'New Jersey', '857': 'Boston, MA',
  '858': 'San Diego, CA', '859': 'Kentucky', '860': 'Connecticut', '862': 'New Jersey',
  '863': 'Florida', '864': 'South Carolina', '865': 'Tennessee', '870': 'Arkansas',
  '872': 'Chicago, IL', '878': 'Pennsylvania', '901': 'Memphis, TN', '903': 'Texas',
  '904': 'Jacksonville, FL', '906': 'Michigan', '907': 'Alaska', '908': 'New Jersey',
  '909': 'California', '910': 'North Carolina', '912': 'Georgia', '913': 'Kansas',
  '914': 'New York', '915': 'Texas', '916': 'Sacramento, CA', '917': 'New York, NY',
  '918': 'Oklahoma', '919': 'North Carolina', '920': 'Wisconsin', '925': 'California',
  '928': 'Arizona', '929': 'New York, NY', '930': 'Indiana', '931': 'Tennessee',
  '936': 'Texas', '937': 'Ohio', '938': 'Alabama', '940': 'Texas',
  '941': 'Florida', '947': 'Michigan', '949': 'Orange County, CA', '951': 'California',
  '952': 'Minnesota', '954': 'Fort Lauderdale, FL', '956': 'Texas', '959': 'Connecticut',
  '970': 'Colorado', '971': 'Oregon', '972': 'Dallas, TX', '973': 'New Jersey',
  '978': 'Massachusetts', '979': 'Texas', '980': 'North Carolina', '984': 'North Carolina',
  '985': 'Louisiana', '989': 'Michigan',
};

// Timezone mapping by state/region (FREE)
const STATE_TIMEZONE_MAP: Record<string, string> = {
  // Eastern Time
  'New York': 'ET', 'New Jersey': 'ET', 'Pennsylvania': 'ET', 'Connecticut': 'ET',
  'Massachusetts': 'ET', 'Rhode Island': 'ET', 'Vermont': 'ET', 'New Hampshire': 'ET',
  'Maine': 'ET', 'Delaware': 'ET', 'Maryland': 'ET', 'Virginia': 'ET',
  'West Virginia': 'ET', 'North Carolina': 'ET', 'South Carolina': 'ET',
  'Georgia': 'ET', 'Florida': 'ET', 'Ohio': 'ET', 'Michigan': 'ET',
  'Indiana': 'ET', 'Kentucky': 'ET', 'Washington DC': 'ET',
  // Central Time
  'Illinois': 'CT', 'Wisconsin': 'CT', 'Minnesota': 'CT', 'Iowa': 'CT',
  'Missouri': 'CT', 'Arkansas': 'CT', 'Louisiana': 'CT', 'Mississippi': 'CT',
  'Alabama': 'CT', 'Tennessee': 'CT', 'Oklahoma': 'CT', 'Texas': 'CT',
  'Kansas': 'CT', 'Nebraska': 'CT', 'South Dakota': 'CT', 'North Dakota': 'CT',
  // Mountain Time
  'Montana': 'MT', 'Wyoming': 'MT', 'Colorado': 'MT', 'New Mexico': 'MT',
  'Utah': 'MT', 'Arizona': 'MT', 'Idaho': 'MT',
  // Pacific Time
  'Washington': 'PT', 'Oregon': 'PT', 'California': 'PT', 'Nevada': 'PT',
  // Other
  'Alaska': 'AKT', 'Hawaii': 'HT',
};

// Extract state from location string
function getStateFromLocation(location: string): string {
  // Check if location contains a state name
  for (const state of Object.keys(STATE_TIMEZONE_MAP)) {
    if (location.includes(state)) return state;
  }
  // Check for state abbreviations in city, STATE format
  const parts = location.split(', ');
  if (parts.length > 1) {
    const stateAbbr = parts[parts.length - 1];
    const stateMap: Record<string, string> = {
      'NY': 'New York', 'NJ': 'New Jersey', 'PA': 'Pennsylvania', 'CT': 'Connecticut',
      'MA': 'Massachusetts', 'RI': 'Rhode Island', 'VT': 'Vermont', 'NH': 'New Hampshire',
      'ME': 'Maine', 'DE': 'Delaware', 'MD': 'Maryland', 'VA': 'Virginia',
      'WV': 'West Virginia', 'NC': 'North Carolina', 'SC': 'South Carolina',
      'GA': 'Georgia', 'FL': 'Florida', 'OH': 'Ohio', 'MI': 'Michigan',
      'IN': 'Indiana', 'KY': 'Kentucky', 'DC': 'Washington DC',
      'IL': 'Illinois', 'WI': 'Wisconsin', 'MN': 'Minnesota', 'IA': 'Iowa',
      'MO': 'Missouri', 'AR': 'Arkansas', 'LA': 'Louisiana', 'MS': 'Mississippi',
      'AL': 'Alabama', 'TN': 'Tennessee', 'OK': 'Oklahoma', 'TX': 'Texas',
      'KS': 'Kansas', 'NE': 'Nebraska', 'SD': 'South Dakota', 'ND': 'North Dakota',
      'MT': 'Montana', 'WY': 'Wyoming', 'CO': 'Colorado', 'NM': 'New Mexico',
      'UT': 'Utah', 'AZ': 'Arizona', 'ID': 'Idaho',
      'WA': 'Washington', 'OR': 'Oregon', 'CA': 'California', 'NV': 'Nevada',
      'AK': 'Alaska', 'HI': 'Hawaii',
    };
    if (stateMap[stateAbbr]) return stateMap[stateAbbr];
  }
  return location;
}

// Get location from phone number area code (FREE)
function getLocationFromPhone(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, '');
  const areaCode = digits.slice(0, 3);
  return AREA_CODE_MAP[areaCode];
}

// Get timezone from location (FREE)
function getTimezoneFromLocation(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const state = getStateFromLocation(location);
  return STATE_TIMEZONE_MAP[state];
}

// Detect line type from phone pattern (FREE)
function detectLineType(phone: string): 'mobile' | 'landline' | 'tollfree' | undefined {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return undefined;
  // Toll-free prefixes
  const tollFreePrefixes = ['800', '888', '877', '866', '855', '844', '833', '822'];
  const areaCode = digits.slice(0, 3);
  if (tollFreePrefixes.includes(areaCode)) return 'tollfree';
  // Default to mobile (most common nowadays)
  return 'mobile';
}

// Enrich a lead with available free data
function enrichLead(lead: Lead): Lead {
  if (lead.enrichment) return lead; // Already enriched
  
  const location = getLocationFromPhone(lead.phone);
  const state = location ? getStateFromLocation(location) : undefined;
  
  const enrichment: LeadEnrichment = {
    location,
    lineType: detectLineType(lead.phone),
    timezone: getTimezoneFromLocation(location),
    region: state,
  };
  
  return { ...lead, enrichment };
}

// Initial mock data for beta display (with real area codes for enrichment demo)
const INITIAL_LEADS: Lead[] = [
  { id: '1', phone: '512-555-4521', capturedAt: new Date(Date.now() - 1000 * 60 * 30), source: 'Table 5', status: 'active' },
  { id: '2', phone: '713-555-8834', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 2), source: 'Bar Top', status: 'active' },
  { id: '3', phone: '214-555-2219', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 5), source: 'Table 3', status: 'active' },
  { id: '4', phone: '305-555-7762', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), source: 'Patio', status: 'active' },
  { id: '5', phone: '415-555-1198', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 26), source: 'Table 1', status: 'active' },
  { id: '6', phone: '310-555-5543', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 48), source: 'Table 5', status: 'active' },
  { id: '7', phone: '212-555-3347', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 50), source: 'Table 2', status: 'active' },
  { id: '8', phone: '404-555-9901', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 72), source: 'Bar Top', status: 'opted-out' },
].map(enrichLead); // Auto-enrich on load

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
    
    const newLead: Lead = enrichLead({
      id: Date.now().toString(),
      phone: newLeadPhone,
      capturedAt: new Date(),
      source: newLeadSource.trim() || 'Manual Entry',
      status: 'active',
    });
    
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
    
    // Create CSV content with enrichment data
    const headers = ['Phone', 'Source', 'Captured Date', 'Captured Time', 'Status', 'Location', 'Region', 'Timezone', 'Line Type'];
    const rows = leadsToExport.map(lead => [
      lead.phone,
      lead.source,
      lead.capturedAt.toLocaleDateString(),
      lead.capturedAt.toLocaleTimeString(),
      lead.status,
      lead.enrichment?.location || '',
      lead.enrichment?.region || '',
      lead.enrichment?.timezone || '',
      lead.enrichment?.lineType || '',
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
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium font-mono text-sm">{lead.phone}</span>
                      {lead.enrichment?.lineType && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-medium ${
                          lead.enrichment.lineType === 'mobile' ? 'bg-blue-500/20 text-blue-400' :
                          lead.enrichment.lineType === 'tollfree' ? 'bg-green-500/20 text-green-400' :
                          'bg-warm-700 text-warm-400'
                        }`}>
                          {lead.enrichment.lineType === 'tollfree' ? 'Toll-Free' : lead.enrichment.lineType}
                        </span>
                      )}
                      {lead.enrichment?.timezone && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
                          {lead.enrichment.timezone}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-warm-400 flex items-center gap-2 flex-wrap">
                      <span className="text-primary">{lead.source}</span>
                      <span className="text-warm-600">•</span>
                      <span>{formatTimeAgo(lead.capturedAt)}</span>
                      {lead.enrichment?.location && (
                        <>
                          <span className="text-warm-600">•</span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {lead.enrichment.location}
                          </span>
                        </>
                      )}
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
      
      {/* Lead Enrichment Info - All Free */}
      <motion.div 
        className="bg-gradient-to-br from-green-900/20 to-emerald-900/20 border border-green-500/20 rounded-xl p-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop flex items-center gap-2">
            <Zap className="w-4 h-4 text-green-400" />
            Auto-Enrichment
          </h3>
          <span className="text-[10px] font-bold text-green-400 bg-green-500/20 px-2 py-0.5 rounded-full">100% FREE</span>
        </div>
        
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-warm-800/50 rounded-lg p-2.5 text-center">
            <MapPin className="w-4 h-4 text-green-400 mx-auto mb-1" />
            <span className="text-warm-300 block">Location</span>
            <span className="text-warm-500 text-[10px]">City/State</span>
          </div>
          
          <div className="bg-warm-800/50 rounded-lg p-2.5 text-center">
            <Smartphone className="w-4 h-4 text-blue-400 mx-auto mb-1" />
            <span className="text-warm-300 block">Line Type</span>
            <span className="text-warm-500 text-[10px]">Mobile/Toll-Free</span>
          </div>
          
          <div className="bg-warm-800/50 rounded-lg p-2.5 text-center">
            <Users className="w-4 h-4 text-purple-400 mx-auto mb-1" />
            <span className="text-warm-300 block">Time Zone</span>
            <span className="text-warm-500 text-[10px]">From area code</span>
          </div>
        </div>
        
        <p className="text-[10px] text-warm-500 mt-3 leading-relaxed">
          All enrichment is automatic and free. Data is derived from the phone number pattern - no external APIs required.
        </p>
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
