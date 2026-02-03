/**
 * NFCLeadsManagement - Admin page for managing NFC lead capture
 * Fetches real data from VenueConfig and VenueLeads APIs
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Smartphone, 
  Phone, 
  MessageSquare, 
  Copy, 
  CheckCircle,
  Users,
  TrendingUp,
  Zap,
  ExternalLink,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

// API endpoints
const VENUE_CONFIG_API = 'https://1vqeyybqrj.execute-api.us-east-2.amazonaws.com';
const LEADS_API = 'https://1vqeyybqrj.execute-api.us-east-2.amazonaws.com';

interface VenueWithNFC {
  venueId: string;
  name: string;
  phone: string;
  leads: number;
  leadsToday: number;
  lastLead: string | null;
}

interface LeadStats {
  total: number;
  today: number;
  thisWeek: number;
}

export function NFCLeadsManagement() {
  const [copied, setCopied] = useState<string | null>(null);
  const [venuesWithNFC, setVenuesWithNFC] = useState<VenueWithNFC[]>([]);
  const [stats, setStats] = useState<LeadStats>({ total: 0, today: 0, thisWeek: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Fetch venues with NFC configured and their lead counts
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch all venues with Twilio numbers configured
      const configResponse = await fetch(`${VENUE_CONFIG_API}/venues-with-nfc`);
      
      let venues: VenueWithNFC[] = [];
      let totalLeads = 0;
      let todayLeads = 0;
      let weekLeads = 0;
      
      if (configResponse.ok) {
        const configData = await configResponse.json();
        venues = configData.venues || [];
        totalLeads = configData.totalLeads || 0;
        todayLeads = configData.leadsToday || 0;
        weekLeads = configData.leadsThisWeek || 0;
      } else {
        // Fallback: scan VenueConfig for venues with twilioPhoneNumber
        // This is a backup in case the dedicated endpoint doesn't exist
        console.log('Falling back to direct venue config scan...');
        
        // For now, show empty state - the endpoint needs to be deployed
        venues = [];
      }
      
      setVenuesWithNFC(venues);
      setStats({
        total: totalLeads,
        today: todayLeads,
        thisWeek: weekLeads
      });
      
    } catch (err) {
      console.error('Failed to fetch NFC data:', err);
      setError('Failed to load NFC lead data. The API endpoint may not be deployed yet.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const conversionRate = stats.total > 0 ? Math.round((stats.thisWeek / stats.total) * 100) : 0;

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">📱 NFC Lead Capture</h1>
            <p className="text-gray-400">
              Manage NFC tags and SMS lead capture for all venues
            </p>
          </div>
          <motion.button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </motion.button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="glass-card p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                <Users className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{stats.today}</div>
                <div className="text-sm text-gray-400">Total Leads Today</div>
              </div>
            </div>
          </div>
          <div className="glass-card p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Smartphone className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{venuesWithNFC.length}</div>
                <div className="text-sm text-gray-400">Venues with NFC</div>
              </div>
            </div>
          </div>
          <div className="glass-card p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{stats.total}</div>
                <div className="text-sm text-gray-400">Total Leads</div>
              </div>
            </div>
          </div>
        </div>

        {/* Setup Guide */}
        <div className="glass-card p-6 mb-8 border-green-500/30">
          <div className="flex items-center gap-3 mb-4">
            <Zap className="w-6 h-6 text-green-400" />
            <h2 className="text-xl font-bold text-white">Quick Setup Guide</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white/5 rounded-lg p-4">
              <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center font-bold mb-2">1</div>
              <h3 className="font-semibold text-white mb-1">Buy Twilio Number</h3>
              <p className="text-sm text-gray-400">Get a local number (~$1/mo)</p>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center font-bold mb-2">2</div>
              <h3 className="font-semibold text-white mb-1">Add to Venue</h3>
              <p className="text-sm text-gray-400">Venues → Edit → NFC Leads tab</p>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center font-bold mb-2">3</div>
              <h3 className="font-semibold text-white mb-1">Program NFC Tags</h3>
              <p className="text-sm text-gray-400">Copy URL → Write to tag</p>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center font-bold mb-2">4</div>
              <h3 className="font-semibold text-white mb-1">Collect Leads!</h3>
              <p className="text-sm text-gray-400">Customers tap → SMS → Done</p>
            </div>
          </div>
        </div>

        {/* Twilio Webhook Info */}
        <div className="glass-card p-6 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Phone className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-bold text-white">Twilio Configuration</h2>
          </div>
          <p className="text-gray-400 mb-4">Set this webhook URL on all your Twilio phone numbers:</p>
          <div className="flex items-center gap-2 bg-black/30 rounded-lg p-3">
            <code className="flex-1 text-green-400 font-mono text-sm">
              https://1vqeyybqrj.execute-api.us-east-2.amazonaws.com/sms
            </code>
            <button
              onClick={() => copyToClipboard('https://1vqeyybqrj.execute-api.us-east-2.amazonaws.com/sms', 'webhook')}
              className="p-2 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              {copied === 'webhook' ? <CheckCircle className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">Method: HTTP POST</p>
          <a 
            href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 text-blue-400 hover:text-blue-300 text-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open Twilio Console
          </a>
        </div>

        {/* Venues with NFC */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <MessageSquare className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-bold text-white">Venues with NFC Leads</h2>
          </div>
          
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-3" />
              <p className="text-gray-400">Loading venues...</p>
            </div>
          ) : venuesWithNFC.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Smartphone className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No venues have NFC lead capture configured yet.</p>
              <p className="text-sm">Go to Venues → Edit → NFC Leads to set up.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {venuesWithNFC.map((venue) => (
                <div key={venue.venueId} className="bg-white/5 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-white">{venue.name}</h3>
                      <p className="text-sm text-gray-400 font-mono">{venue.phone}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-green-400">{venue.leads}</div>
                      <div className="text-xs text-gray-500">total leads</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['TABLE1', 'TABLE2', 'BAR', 'PATIO'].map((loc) => {
                      const url = `sms:${venue.phone}?body=JOIN ${loc}`;
                      return (
                        <button
                          key={loc}
                          onClick={() => copyToClipboard(url, `${venue.venueId}-${loc}`)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-black/30 rounded text-xs font-mono text-gray-300 hover:text-white hover:bg-black/50 transition-colors"
                        >
                          {copied === `${venue.venueId}-${loc}` ? (
                            <CheckCircle className="w-3 h-3 text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          {loc}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default NFCLeadsManagement;
