/**
 * Leads Page - NFC Tag Lead Capture Dashboard (BETA)
 * 
 * Phase 1: Display leads + stats
 * - Total leads captured
 * - Leads this period
 * - Lead list with masked phone numbers
 * - Stats by table/location
 * 
 * Currently using mock data - backend coming soon.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Users, 
  TrendingUp, 
  TrendingDown,
  Smartphone,
  MapPin,
  Clock,
  AlertCircle,
  Zap,
  QrCode,
} from 'lucide-react';
import type { InsightsTimeRange } from '../types/insights';

// Mock data for beta display
const MOCK_LEADS = [
  { id: '1', phone: '***-***-4521', capturedAt: new Date(Date.now() - 1000 * 60 * 30), source: 'Table 5', status: 'active' },
  { id: '2', phone: '***-***-8834', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 2), source: 'Bar Top', status: 'active' },
  { id: '3', phone: '***-***-2219', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 5), source: 'Table 3', status: 'active' },
  { id: '4', phone: '***-***-7762', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 24), source: 'Patio', status: 'active' },
  { id: '5', phone: '***-***-1198', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 26), source: 'Table 1', status: 'active' },
  { id: '6', phone: '***-***-5543', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 48), source: 'Table 5', status: 'active' },
  { id: '7', phone: '***-***-9901', capturedAt: new Date(Date.now() - 1000 * 60 * 60 * 72), source: 'Bar Top', status: 'opted-out' },
];

const MOCK_STATS = {
  total: 47,
  thisWeek: 12,
  lastWeek: 9,
  bySource: [
    { source: 'Table 5', count: 14 },
    { source: 'Bar Top', count: 11 },
    { source: 'Table 3', count: 8 },
    { source: 'Patio', count: 7 },
    { source: 'Table 1', count: 5 },
    { source: 'Other', count: 2 },
  ],
};

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

function StatCard({ 
  icon: Icon, 
  label, 
  value, 
  delta,
  highlight = false,
}: { 
  icon: typeof Users;
  label: string;
  value: string | number;
  delta?: number;
  highlight?: boolean;
}) {
  const showDelta = delta !== undefined && delta !== 0;
  
  return (
    <div className={`p-4 rounded-xl ${highlight ? 'bg-primary/10 border border-primary/30' : 'bg-warm-800/50 border border-warm-700'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${highlight ? 'text-primary' : 'text-warm-400'}`} />
        <span className="text-xs text-warm-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {showDelta && (
        <div className={`flex items-center gap-1 mt-1 text-sm ${delta > 0 ? 'text-recovery-high' : 'text-recovery-low'}`}>
          {delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{delta > 0 ? '+' : ''}{delta}% vs last week</span>
        </div>
      )}
    </div>
  );
}

export function Leads() {
  const [timeRange, setTimeRange] = useState<InsightsTimeRange>('7d');
  
  const weekDelta = MOCK_STATS.lastWeek > 0 
    ? Math.round(((MOCK_STATS.thisWeek - MOCK_STATS.lastWeek) / MOCK_STATS.lastWeek) * 100)
    : 0;

  return (
    <div className="space-y-6 pb-24">
      {/* Header with Beta Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">Leads</h1>
          <span className="px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary border border-primary/30 rounded-full">
            BETA
          </span>
        </div>
      </div>
      
      {/* Beta Notice */}
      <motion.div 
        className="bg-primary/5 border border-primary/20 rounded-xl p-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <QrCode className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-white font-semibold mb-1">NFC Lead Capture Coming Soon</h3>
            <p className="text-sm text-warm-300">
              Place NFC tags at tables to capture customer phone numbers. When patrons tap, they opt-in via SMS and you get a verified lead.
            </p>
            <p className="text-xs text-warm-500 mt-2">
              This is sample data. Real lead capture will be enabled once your NFC tags are configured.
            </p>
          </div>
        </div>
      </motion.div>
      
      {/* Stats Grid */}
      <motion.div 
        className="grid grid-cols-2 gap-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <StatCard
          icon={Users}
          label="Total Leads"
          value={MOCK_STATS.total}
          highlight={true}
        />
        <StatCard
          icon={Zap}
          label="This Week"
          value={MOCK_STATS.thisWeek}
          delta={weekDelta}
        />
      </motion.div>
      
      {/* Leads by Location */}
      <motion.div 
        className="bg-whoop-panel border border-whoop-divider rounded-xl p-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop mb-4 flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          By Location
        </h3>
        <div className="space-y-2">
          {MOCK_STATS.bySource.map((item, idx) => {
            const maxCount = Math.max(...MOCK_STATS.bySource.map(s => s.count));
            const width = (item.count / maxCount) * 100;
            
            return (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-20 text-sm text-warm-400 flex-shrink-0">{item.source}</div>
                <div className="flex-1 h-6 bg-warm-800 rounded overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={{ duration: 0.5, delay: idx * 0.05 }}
                    className="h-full bg-primary/60 rounded"
                  />
                </div>
                <div className="w-8 text-sm text-white font-medium text-right">{item.count}</div>
              </div>
            );
          })}
        </div>
      </motion.div>
      
      {/* Recent Leads List */}
      <motion.div 
        className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="p-4 border-b border-whoop-divider">
          <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            Recent Leads
          </h3>
        </div>
        
        <div className="divide-y divide-whoop-divider">
          {MOCK_LEADS.map((lead) => (
            <div 
              key={lead.id} 
              className={`p-4 flex items-center justify-between ${lead.status === 'opted-out' ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-warm-700 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-warm-400" />
                </div>
                <div>
                  <div className="text-white font-medium">{lead.phone}</div>
                  <div className="text-xs text-warm-400 flex items-center gap-2">
                    <span>{lead.source}</span>
                    <span>•</span>
                    <span>{formatTimeAgo(lead.capturedAt)}</span>
                  </div>
                </div>
              </div>
              {lead.status === 'opted-out' && (
                <span className="text-xs text-warm-500 bg-warm-800 px-2 py-1 rounded">
                  Opted out
                </span>
              )}
            </div>
          ))}
        </div>
      </motion.div>
      
      {/* How It Works */}
      <motion.div 
        className="bg-warm-800/30 border border-warm-700 rounded-xl p-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h3 className="text-sm font-semibold text-warm-200 mb-3">How It Works</h3>
        <div className="space-y-3 text-sm text-warm-400">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0 text-xs font-bold">1</div>
            <p>Place NFC tags at tables, bar top, or other locations in your venue</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0 text-xs font-bold">2</div>
            <p>Customers tap the tag with their phone - opens SMS with pre-filled message</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0 text-xs font-bold">3</div>
            <p>They hit send - you capture a verified phone number with consent</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0 text-xs font-bold">4</div>
            <p>Message your leads about specials, events, and promotions</p>
          </div>
        </div>
      </motion.div>
      
    </div>
  );
}

export default Leads;
