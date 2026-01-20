import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  ToggleLeft, ToggleRight, Search, Building2, Crown, Zap,
  BarChart3, Users, Calendar, Music, CreditCard, Mail,
  TrendingUp, Clock, Save, RefreshCw, Filter
} from 'lucide-react';

// Feature definitions with tiers
const FEATURES = [
  // Core (Free)
  { id: 'live_dashboard', name: 'Live Dashboard', description: 'Real-time occupancy and metrics', tier: 'core', icon: Zap },
  { id: 'basic_analytics', name: 'Basic Analytics', description: '7-day analytics with trends', tier: 'core', icon: BarChart3 },
  { id: 'song_detection', name: 'Song Detection', description: 'Music recognition and logging', tier: 'core', icon: Music },
  
  // Pro
  { id: 'advanced_analytics', name: 'Advanced Analytics', description: '90-day analytics, exports, raw data', tier: 'pro', icon: TrendingUp },
  { id: 'year_over_year', name: 'Year-over-Year', description: 'Compare performance vs last year', tier: 'pro', icon: Calendar },
  { id: 'event_tracking', name: 'Event ROI Tracker', description: 'Log events and measure impact', tier: 'pro', icon: Calendar },
  { id: 'staffing', name: 'Staff Performance', description: 'Track staff impact on metrics', tier: 'pro', icon: Users },
  { id: 'email_reports', name: 'Weekly Email Reports', description: 'Automated weekly summaries', tier: 'pro', icon: Mail },
  
  // Enterprise
  { id: 'pos_integration', name: 'POS Integration', description: 'Connect Square, Toast, Clover', tier: 'enterprise', icon: CreditCard },
  { id: 'revenue_correlation', name: 'Revenue Correlation', description: 'See revenue vs crowd data', tier: 'enterprise', icon: TrendingUp },
  { id: 'multi_location', name: 'Multi-Location', description: 'Manage multiple venues', tier: 'enterprise', icon: Building2 },
  { id: 'api_access', name: 'API Access', description: 'Custom integrations via API', tier: 'enterprise', icon: Zap },
  { id: 'white_label', name: 'White Label', description: 'Custom branding options', tier: 'enterprise', icon: Crown },
  { id: 'priority_support', name: 'Priority Support', description: '24/7 dedicated support', tier: 'enterprise', icon: Clock },
];

const TIERS = {
  core: { name: 'Core', color: 'text-warm-400', bg: 'bg-warm-700' },
  pro: { name: 'Pro', color: 'text-primary', bg: 'bg-primary/20' },
  enterprise: { name: 'Enterprise', color: 'text-amber-400', bg: 'bg-amber-500/20' }
};

interface VenueFeatures {
  venueId: string;
  venueName: string;
  tier: 'core' | 'pro' | 'enterprise' | 'custom';
  features: Record<string, boolean>;
  customUntil?: string; // For trial periods
}

// API endpoint
const FEATURES_API = 'https://4unsp74svc.execute-api.us-east-2.amazonaws.com/prod/features';

export function FeatureControls() {
  const [venues, setVenues] = useState<VenueFeatures[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [expandedVenue, setExpandedVenue] = useState<string | null>(null);

  useEffect(() => {
    loadVenues();
  }, []);

  const loadVenues = async () => {
    setLoading(true);
    try {
      const response = await fetch(FEATURES_API);
      if (response.ok) {
        const data = await response.json();
        setVenues(data);
      } else {
        // Load from localStorage as fallback
        const stored = localStorage.getItem('admin_venue_features');
        if (stored) {
          setVenues(JSON.parse(stored));
        } else {
          // Demo data
          setVenues([
            {
              venueId: 'jimmyneutron',
              venueName: "Ferg's",
              tier: 'pro',
              features: getDefaultFeatures('pro')
            },
            {
              venueId: 'demovenue',
              venueName: 'Demo Venue',
              tier: 'core',
              features: getDefaultFeatures('core')
            }
          ]);
        }
      }
    } catch (error) {
      console.error('Error loading venues:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDefaultFeatures = (tier: string): Record<string, boolean> => {
    const features: Record<string, boolean> = {};
    FEATURES.forEach(f => {
      if (tier === 'enterprise') {
        features[f.id] = true;
      } else if (tier === 'pro') {
        features[f.id] = f.tier === 'core' || f.tier === 'pro';
      } else {
        features[f.id] = f.tier === 'core';
      }
    });
    return features;
  };

  const handleTierChange = async (venueId: string, newTier: 'core' | 'pro' | 'enterprise') => {
    const updated = venues.map(v => {
      if (v.venueId === venueId) {
        return {
          ...v,
          tier: newTier,
          features: getDefaultFeatures(newTier)
        };
      }
      return v;
    });
    setVenues(updated);
    await saveVenueFeatures(venueId, updated.find(v => v.venueId === venueId)!);
  };

  const handleFeatureToggle = async (venueId: string, featureId: string) => {
    const updated = venues.map(v => {
      if (v.venueId === venueId) {
        const newFeatures = { ...v.features, [featureId]: !v.features[featureId] };
        // Check if it matches a tier or is custom
        const matchesTier = Object.keys(TIERS).find(tier => {
          const defaults = getDefaultFeatures(tier);
          return JSON.stringify(defaults) === JSON.stringify(newFeatures);
        });
        return {
          ...v,
          tier: (matchesTier || 'custom') as VenueFeatures['tier'],
          features: newFeatures
        };
      }
      return v;
    });
    setVenues(updated);
    await saveVenueFeatures(venueId, updated.find(v => v.venueId === venueId)!);
  };

  const saveVenueFeatures = async (venueId: string, venue: VenueFeatures) => {
    setSaving(venueId);
    try {
      // Save to API
      await fetch(`${FEATURES_API}/${venueId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(venue)
      });
      
      // Also save to localStorage as backup
      localStorage.setItem('admin_venue_features', JSON.stringify(venues));
    } catch (error) {
      console.error('Error saving:', error);
      // Still save to localStorage
      localStorage.setItem('admin_venue_features', JSON.stringify(venues));
    } finally {
      setSaving(null);
    }
  };

  const filteredVenues = venues.filter(v => {
    const matchesSearch = v.venueName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         v.venueId.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTier = tierFilter === 'all' || v.tier === tierFilter;
    return matchesSearch && matchesTier;
  });

  const getEnabledCount = (features: Record<string, boolean>) => 
    Object.values(features).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Crown className="w-7 h-7 text-amber-400" />
            Feature Controls
          </h2>
          <p className="text-warm-400 mt-1">Manage feature access per venue for upselling</p>
        </div>
        
        <button
          onClick={loadVenues}
          disabled={loading}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Tier Legend */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-medium text-warm-400 mb-3">Pricing Tiers</h3>
        <div className="flex gap-4">
          {Object.entries(TIERS).map(([key, tier]) => (
            <div key={key} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${tier.bg} ${tier.color}`} />
              <span className={tier.color}>{tier.name}</span>
              <span className="text-xs text-warm-500">
                ({FEATURES.filter(f => f.tier === key).length} features)
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-warm-500" />
          <input
            type="text"
            placeholder="Search venues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-warm-800 rounded-lg pl-10 pr-4 py-3 text-white placeholder-warm-500 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-2 bg-warm-800 rounded-lg p-1">
          {['all', 'core', 'pro', 'enterprise', 'custom'].map(tier => (
            <button
              key={tier}
              onClick={() => setTierFilter(tier)}
              className={`px-3 py-2 rounded-md text-sm transition-colors ${
                tierFilter === tier
                  ? 'bg-primary/20 text-primary'
                  : 'text-warm-400 hover:text-white'
              }`}
            >
              {tier === 'all' ? 'All' : tier.charAt(0).toUpperCase() + tier.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Venues List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : filteredVenues.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Building2 className="w-12 h-12 text-warm-600 mx-auto mb-3" />
          <p className="text-warm-400">No venues found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredVenues.map((venue) => {
            const isExpanded = expandedVenue === venue.venueId;
            const tierInfo = venue.tier === 'custom' 
              ? { name: 'Custom', color: 'text-purple-400', bg: 'bg-purple-500/20' }
              : TIERS[venue.tier];
            
            return (
              <motion.div
                key={venue.venueId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card overflow-hidden"
              >
                {/* Venue Header */}
                <div
                  onClick={() => setExpandedVenue(isExpanded ? null : venue.venueId)}
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-warm-800/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-warm-800 flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium text-white">{venue.venueName}</div>
                      <div className="text-xs text-warm-400">{venue.venueId}</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={`text-sm font-medium ${tierInfo.color}`}>
                        {tierInfo.name}
                      </div>
                      <div className="text-xs text-warm-500">
                        {getEnabledCount(venue.features)}/{FEATURES.length} features
                      </div>
                    </div>
                    
                    {saving === venue.venueId && (
                      <RefreshCw className="w-4 h-4 text-primary animate-spin" />
                    )}
                    
                    <motion.div
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      className="text-warm-500"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </motion.div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-warm-700"
                  >
                    {/* Quick Tier Selector */}
                    <div className="p-4 bg-warm-800/30 border-b border-warm-700">
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-warm-400">Quick Set Tier:</span>
                        {Object.entries(TIERS).map(([key, tier]) => (
                          <button
                            key={key}
                            onClick={() => handleTierChange(venue.venueId, key as 'core' | 'pro' | 'enterprise')}
                            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                              venue.tier === key
                                ? `${tier.bg} ${tier.color} border border-current`
                                : 'bg-warm-800 text-warm-400 hover:text-white'
                            }`}
                          >
                            {tier.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Feature Toggles */}
                    <div className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {FEATURES.map((feature) => {
                          const isEnabled = venue.features[feature.id];
                          const tierInfo = TIERS[feature.tier as keyof typeof TIERS];
                          const Icon = feature.icon;
                          
                          return (
                            <div
                              key={feature.id}
                              className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                                isEnabled ? 'bg-warm-800' : 'bg-warm-800/30'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <Icon className={`w-5 h-5 ${isEnabled ? tierInfo.color : 'text-warm-600'}`} />
                                <div>
                                  <div className={`text-sm font-medium ${isEnabled ? 'text-white' : 'text-warm-500'}`}>
                                    {feature.name}
                                  </div>
                                  <div className="text-xs text-warm-500 flex items-center gap-2">
                                    {feature.description}
                                    <span className={`${tierInfo.bg} ${tierInfo.color} px-1.5 py-0.5 rounded text-[10px]`}>
                                      {tierInfo.name}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              
                              <button
                                onClick={() => handleFeatureToggle(venue.venueId, feature.id)}
                                className="flex-shrink-0"
                              >
                                {isEnabled ? (
                                  <ToggleRight className="w-8 h-8 text-emerald-400" />
                                ) : (
                                  <ToggleLeft className="w-8 h-8 text-warm-600" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {Object.entries(TIERS).map(([key, tier]) => {
          const count = venues.filter(v => v.tier === key).length;
          return (
            <div key={key} className="glass-card p-4 text-center">
              <div className={`text-2xl font-bold ${tier.color}`}>{count}</div>
              <div className="text-sm text-warm-400">{tier.name} Venues</div>
            </div>
          );
        })}
        <div className="glass-card p-4 text-center">
          <div className="text-2xl font-bold text-purple-400">
            {venues.filter(v => v.tier === 'custom').length}
          </div>
          <div className="text-sm text-warm-400">Custom Plans</div>
        </div>
      </div>
    </div>
  );
}

export default FeatureControls;
