/**
 * Reports - Advanced Analytics Dashboard
 * 
 * Design Spec Implementation:
 * 1. Persistent Top Bar (Date, Venue, Freshness)
 * 2. Performance Summary (Default View)
 * 3. Environment vs Sales
 * 4. Time-Based Insights
 * 5. Export / History
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Calendar, RefreshCw, ChevronDown, CheckCircle, 
  TrendingUp, TrendingDown, DollarSign, Users, 
  Zap, Volume2, Sun, Thermometer, Music, 
  Download, Share2, Mail, FileText
} from 'lucide-react';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { AreaChart, BarChart } from '../components/common/MiniChart';
import { haptic } from '../utils/haptics';
import type { SensorData, TimeRange } from '../types';

// ============ TYPES ============

type ViewType = 'performance' | 'env_sales' | 'time_insights' | 'export';
type TimeFilter = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

// ============ MOCK DATA GENERATORS (Temporary until real backend logic matches spec) ============
// In a real implementation, these would be calculated on the backend or in a dedicated service
const generateMockEnvironmentSales = () => {
  return [
    { range: '65-70dB', revenue: 12.5, samples: 45 },
    { range: '71-76dB', revenue: 18.2, samples: 120 },
    { range: '77-82dB', revenue: 24.5, samples: 85, isOptimal: true },
    { range: '83-88dB', revenue: 16.8, samples: 30 },
    { range: '89+dB', revenue: 11.2, samples: 15 },
  ];
};

const generateMockHeatmap = () => {
  // 7 days x 24 hours
  const data = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      // Simulate peak hours (Fri/Sat 8pm-2am)
      const isWeekend = day >= 5;
      const isNight = hour >= 20 || hour <= 2;
      let score = 60 + Math.random() * 20;
      if (isWeekend && isNight) score += 15;
      data.push({ day, hour, score: Math.min(100, Math.round(score)) });
    }
  }
  return data;
};

// ============ MAIN COMPONENT ============

export function Reports() {
  const user = authService.getStoredUser();
  const venueId = user?.venueId || '';
  const venueName = user?.venueName || 'Venue';
  
  // State
  const [activeView, setActiveView] = useState<ViewType>('performance');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today');
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [data, setData] = useState<SensorData[]>([]);

  // Fetch Data
  const fetchData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      // Map filter to API range
      const apiRange: TimeRange = timeFilter === 'today' ? '24h' 
        : timeFilter === 'yesterday' ? '24h' // Handle offset logic in real app
        : timeFilter === '7d' ? '7d' 
        : '30d';
        
      const result = await apiService.getHistoricalData(venueId, apiRange);
      if (result?.data) setData(result.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [venueId, timeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    haptic('medium');
    fetchData();
  };

  return (
    <div className="flex flex-col h-full bg-warm-900 min-h-screen pb-20">
      {/* 1. PERSISTENT TOP BAR */}
      <div className="sticky top-0 z-30 bg-warm-900/95 backdrop-blur border-b border-warm-800">
        <div className="px-4 py-3">
          {/* Row 1: Controls */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-2 px-3 py-1.5 bg-warm-800 rounded-lg text-sm font-medium text-warm-100 border border-warm-700">
                <Calendar className="w-4 h-4 text-warm-400" />
                <span>{getTimeLabel(timeFilter)}</span>
                <ChevronDown className="w-3 h-3 text-warm-500" />
              </button>
              
              {/* Venue Selector (Mock) */}
              <button className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-warm-800/50 rounded-lg text-sm font-medium text-warm-300 border border-transparent">
                <span>{venueName}</span>
                <ChevronDown className="w-3 h-3 text-warm-500" />
              </button>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                <span className="text-xs font-medium text-green-500 uppercase tracking-wider">High Confidence</span>
              </div>
              <button onClick={handleRefresh} className="p-2 text-warm-400 hover:text-white">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          
          {/* Row 2: Navigation Tabs */}
          <div className="flex gap-6 overflow-x-auto scrollbar-hide border-b border-transparent">
            <NavTab label="Performance" isActive={activeView === 'performance'} onClick={() => setActiveView('performance')} />
            <NavTab label="Env vs Sales" isActive={activeView === 'env_sales'} onClick={() => setActiveView('env_sales')} />
            <NavTab label="Time Insights" isActive={activeView === 'time_insights'} onClick={() => setActiveView('time_insights')} />
            <NavTab label="Export" isActive={activeView === 'export'} onClick={() => setActiveView('export')} />
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 p-4">
        <AnimatePresence mode="wait">
          {activeView === 'performance' && (
            <PerformanceView key="performance" data={data} loading={loading} />
          )}
          {activeView === 'env_sales' && (
            <EnvSalesView key="env_sales" />
          )}
          {activeView === 'time_insights' && (
            <TimeInsightsView key="time_insights" />
          )}
          {activeView === 'export' && (
            <ExportView key="export" />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============ SUB-VIEWS ============

// 1. PERFORMANCE SUMMARY
function PerformanceView({ data, loading }: { data: SensorData[], loading: boolean }) {
  if (loading) return <LoadingState />;
  
  // Calculate basic metrics from data
  // (In production, these come from backend pre-calculated)
  const avgScore = 78;
  const revenueTrend = 12; // +12%
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* A. Metric Tiles */}
      <div className="grid grid-cols-2 gap-3">
        <MetricTile 
          label="Avg Pulse Score" 
          value={avgScore.toString()} 
          subtext="/ 100" 
          color="text-green-400" 
          trend={0}
        />
        <MetricTile 
          label="Revenue / Hour" 
          value="$840" 
          subtext="Avg" 
          color="text-white" 
          trend={revenueTrend}
        />
        <MetricTile 
          label="Peak Window" 
          value="Fri 10PM" 
          subtext="Best Performance" 
          color="text-primary" 
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <MetricTile 
          label="Upside Opportunity" 
          value="+18%" 
          subtext="Est. Growth" 
          color="text-amber-400" 
          icon={<Zap className="w-4 h-4" />}
        />
      </div>

      {/* B. The Verdict */}
      <div className="py-2">
        <h2 className="text-xl font-medium text-warm-100 leading-relaxed">
          "Your venue performs best when Pulse Score is above <span className="text-green-400 font-bold">80</span>, but only maintains this during <span className="text-amber-400 font-bold">42%</span> of peak hours."
        </h2>
      </div>

      {/* C. Impact Cards */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-warm-500 uppercase tracking-wider">Impact Analysis</h3>
        
        <ImpactCard 
          icon={<Volume2 className="w-5 h-5 text-amber-400" />}
          condition="Sound > 85dB"
          outcome="Revenue/min ↓ 12%"
          type="negative"
        />
        <ImpactCard 
          icon={<Users className="w-5 h-5 text-green-400" />}
          condition="Crowd 80-90% Cap"
          outcome="Dwell Time ↑ 15m"
          type="positive"
        />
      </div>

      {/* D. Mini Timeline */}
      <div className="bg-warm-800 p-4 rounded-xl border border-warm-700">
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs font-medium text-warm-300">Score vs Revenue Trend</span>
        </div>
        <div className="h-32 w-full">
           <AreaChart 
             data={[
               { label: '8pm', value: 65 }, { label: '9pm', value: 72 }, 
               { label: '10pm', value: 85, isCurrent: true }, { label: '11pm', value: 82 },
               { label: '12am', value: 78 }
             ]} 
             height={128}
             color="#00F19F"
           />
        </div>
      </div>
    </motion.div>
  );
}

// 2. ENVIRONMENT VS SALES
function EnvSalesView() {
  const [variable, setVariable] = useState('sound');
  const mockData = generateMockEnvironmentSales();
  
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex gap-4 h-full"
    >
      {/* Left Rail */}
      <div className="w-12 flex flex-col gap-4 pt-2">
        <VariableButton icon={<Volume2 />} active={variable === 'sound'} onClick={() => setVariable('sound')} />
        <VariableButton icon={<Sun />} active={variable === 'light'} onClick={() => setVariable('light')} />
        <VariableButton icon={<Users />} active={variable === 'crowd'} onClick={() => setVariable('crowd')} />
        <VariableButton icon={<Thermometer />} active={variable === 'temp'} onClick={() => setVariable('temp')} />
      </div>
      
      {/* Main Chart Area */}
      <div className="flex-1 space-y-6">
        <div className="bg-warm-800 p-5 rounded-2xl border border-warm-700 min-h-[300px]">
          <h3 className="text-sm font-medium text-warm-300 mb-6">Revenue per Minute by Sound Level</h3>
          
          <div className="space-y-4">
            {mockData.map((bucket, i) => (
              <div key={i} className="relative">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-warm-200 font-medium">{bucket.range}</span>
                  <span className="text-warm-400">{bucket.samples} hrs data</span>
                </div>
                <div className="h-8 bg-warm-900 rounded-lg overflow-hidden flex items-center relative">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(bucket.revenue / 30) * 100}%` }}
                    className={`h-full ${bucket.isOptimal ? 'bg-primary' : 'bg-warm-600'}`}
                  />
                  <span className="absolute left-3 text-xs font-bold text-white mix-blend-difference">
                    ${bucket.revenue}/min
                  </span>
                </div>
                {bucket.isOptimal && (
                  <div className="absolute -right-2 top-1/2 -translate-y-1/2 translate-x-full pl-3">
                    <span className="text-xs font-bold text-primary">SWEET SPOT</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Sweet Spot Callout */}
        <div className="p-4 bg-primary/10 border border-primary/20 rounded-xl flex gap-3">
          <CheckCircle className="w-5 h-5 text-primary flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-primary">Optimal Range: 77–82 dB</p>
            <p className="text-xs text-warm-300 mt-1">
              Maintaining this volume correlates with a <span className="text-white font-bold">+14%</span> increase in revenue per minute.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// 3. TIME-BASED INSIGHTS
function TimeInsightsView() {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* A. Heatmap */}
      <div className="bg-warm-800 p-4 rounded-xl border border-warm-700 overflow-hidden">
        <div className="flex justify-between mb-4">
          <h3 className="text-sm font-medium text-warm-200">Weekly Performance Heatmap</h3>
          <div className="flex gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-sm"></span>
            <span className="w-3 h-3 bg-amber-500 rounded-sm"></span>
            <span className="w-3 h-3 bg-green-500 rounded-sm"></span>
          </div>
        </div>
        
        {/* Mock Heatmap Grid */}
        <div className="grid grid-cols-[auto_1fr] gap-2">
          {/* Y-Axis Labels */}
          <div className="flex flex-col justify-between text-[10px] text-warm-500 py-1">
            <span>Mon</span>
            <span>Wed</span>
            <span>Fri</span>
            <span>Sun</span>
          </div>
          
          {/* Grid */}
          <div className="grid grid-cols-24 gap-[1px] bg-warm-900 p-[1px]">
            {generateMockHeatmap().map((cell, i) => (
              <div 
                key={i}
                className={`w-full h-3 rounded-[1px] ${
                  cell.score > 80 ? 'bg-green-500' : 
                  cell.score > 60 ? 'bg-amber-500' : 'bg-red-900'
                }`}
                style={{ opacity: cell.score / 100 }}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-warm-500 pl-8 mt-1">
          <span>12am</span>
          <span>6am</span>
          <span>12pm</span>
          <span>6pm</span>
          <span>11pm</span>
        </div>
      </div>

      {/* B. Insights */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-warm-500 uppercase tracking-wider">Key Patterns</h3>
        
        <div className="p-4 bg-warm-800/50 border border-warm-700 rounded-xl">
          <div className="flex gap-3 mb-2">
            <TrendingDown className="w-5 h-5 text-red-400" />
            <span className="font-bold text-warm-100">Drop-off at 6-7 PM</span>
          </div>
          <p className="text-sm text-warm-300">
            Pulse Score drops consistently during shift change. Crowd density remains high, but environment quality degrades.
          </p>
        </div>

        <div className="p-4 bg-warm-800/50 border border-warm-700 rounded-xl">
          <div className="flex gap-3 mb-2">
            <Clock className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-warm-100">Early Peak Fridays</span>
          </div>
          <p className="text-sm text-warm-300">
            Friday peak begins 45m earlier than scheduled staffing ramp-up.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// 4. EXPORT
function ExportView() {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div className="grid grid-cols-2 gap-4">
        <ExportOption 
          icon={<FileText className="w-6 h-6 text-primary" />} 
          label="Weekly Summary" 
          sub="PDF Report"
        />
        <ExportOption 
          icon={<Calendar className="w-6 h-6 text-teal-400" />} 
          label="Monthly Perf." 
          sub="PDF Report"
        />
      </div>

      <div className="space-y-3 pt-4">
        <h3 className="text-xs font-bold text-warm-500 uppercase tracking-wider">Quick Actions</h3>
        <ActionButton icon={<Download />} label="Download CSV (Raw Data)" />
        <ActionButton icon={<Mail />} label="Email Report to Owner" />
        <ActionButton icon={<Share2 />} label="Share Link" />
      </div>

      <div className="pt-6">
        <h3 className="text-xs font-bold text-warm-500 uppercase tracking-wider mb-3">Archive</h3>
        <div className="space-y-2">
          {['Oct 1-7', 'Sep 24-30', 'Sep 17-23'].map((week, i) => (
            <div key={i} className="flex justify-between items-center p-3 bg-warm-800/30 rounded-lg border border-warm-800">
              <span className="text-sm text-warm-300">Weekly Report: {week}</span>
              <Download className="w-4 h-4 text-warm-500" />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ============ HELPER COMPONENTS ============

function NavTab({ label, isActive, onClick }: { label: string, isActive: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors relative ${
        isActive ? 'text-primary' : 'text-warm-400 hover:text-warm-200'
      }`}
    >
      {label}
      {isActive && (
        <motion.div 
          layoutId="activeTabReport"
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
        />
      )}
    </button>
  );
}

function MetricTile({ label, value, subtext, color, trend, icon }: any) {
  return (
    <div className="bg-warm-800 p-4 rounded-xl border border-warm-700 flex flex-col justify-between">
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] text-warm-400 uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        <div className="flex items-center gap-1 mt-1">
          <span className="text-xs text-warm-500">{subtext}</span>
          {trend !== undefined && trend !== 0 && (
            <span className={`text-xs font-bold ${trend > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {trend > 0 ? '+' : ''}{trend}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ImpactCard({ icon, condition, outcome, type }: any) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border ${
      type === 'positive' ? 'bg-green-900/10 border-green-900/30' : 'bg-red-900/10 border-red-900/30'
    }`}>
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm font-medium text-warm-200">{condition}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-warm-500">→</span>
        <span className={`text-sm font-bold ${type === 'positive' ? 'text-green-400' : 'text-red-400'}`}>
          {outcome}
        </span>
      </div>
    </div>
  );
}

function VariableButton({ icon, active, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
        active ? 'bg-primary text-black shadow-lg shadow-primary/20' : 'bg-warm-800 text-warm-400 hover:bg-warm-700'
      }`}
    >
      <div className="w-5 h-5">{icon}</div>
    </button>
  );
}

function ExportOption({ icon, label, sub }: any) {
  return (
    <button className="flex flex-col items-center justify-center p-6 bg-warm-800 rounded-xl border border-warm-700 hover:border-primary/50 transition-colors">
      <div className="mb-3">{icon}</div>
      <span className="text-sm font-bold text-warm-100">{label}</span>
      <span className="text-xs text-warm-500">{sub}</span>
    </button>
  );
}

function ActionButton({ icon, label }: any) {
  return (
    <button className="w-full flex items-center gap-3 p-3 bg-warm-800 rounded-lg hover:bg-warm-700 transition-colors">
      <div className="text-warm-400">{icon}</div>
      <span className="text-sm font-medium text-warm-200">{label}</span>
    </button>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function getTimeLabel(filter: TimeFilter): string {
  switch (filter) {
    case 'today': return 'Today';
    case 'yesterday': return 'Yesterday';
    case '7d': return 'Last 7 Days';
    case '30d': return 'Last 30 Days';
    default: return 'Custom';
  }
}

export default Reports;
