/**
 * ROIDashboard - Proves the value of using Pulse
 * 
 * Addresses the "Prove ROI" problem:
 * - Shows improvement since starting
 * - Compares periods with clear metrics
 * - Highlights wins and milestones
 * - Estimates revenue impact
 * - Exportable for stakeholders
 */

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Clock,
  Zap,
  Target,
  Trophy,
  Calendar,
  DollarSign,
  Download,
  Award,
  ArrowUpRight,
  ArrowDownRight,
  BarChart2,
  X,
} from 'lucide-react';
import type { ROIData, ROIComparison, ROIInsight, PeriodMetrics } from '../hooks/useROITracking';

// ============ TYPES ============

interface ROIDashboardProps {
  data: ROIData;
  onClose?: () => void;
  isModal?: boolean;
}

interface MetricCardProps {
  icon: typeof Zap;
  label: string;
  current: number | string;
  previous: number | string | null;
  change: number | null;
  changePercent: number | null;
  unit?: string;
  format?: 'number' | 'percent' | 'time' | 'currency';
  higherIsBetter?: boolean;
}

// ============ MAIN COMPONENT ============

export function ROIDashboard({ data, onClose, isModal = false }: ROIDashboardProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'weekly' | 'monthly'>('overview');
  const exportRef = useRef<HTMLDivElement>(null);

  const {
    daysSinceStart,
    firstRecordedDate,
    currentWeek,
    currentMonth,
    previousWeek,
    previousMonth,
    weekOverWeek,
    monthOverMonth,
    insights,
    estimatedRevenueImpact,
    loading,
    error,
  } = data;

  // Handle loading state
  if (loading) {
    const containerClass = isModal 
      ? 'fixed inset-0 z-50 bg-white overflow-auto' 
      : 'max-w-2xl mx-auto';
    
    return (
      <div className={containerClass}>
        <div className="sticky top-0 bg-white border-b border-warm-200 px-4 py-4 z-10">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-warm-800 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-primary" />
                Your ROI
              </h1>
              <p className="text-sm text-warm-500">Loading data...</p>
            </div>
            {onClose && (
              <button onClick={onClose} className="p-2 hover:bg-warm-100 rounded-lg">
                <X className="w-5 h-5 text-warm-400" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-center p-12">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <BarChart2 className="w-6 h-6 text-primary animate-pulse" />
            </div>
            <p className="text-warm-600 font-medium">Calculating your ROI...</p>
            <p className="text-warm-400 text-sm mt-1">Analyzing your historical data</p>
          </div>
        </div>
      </div>
    );
  }

  // Handle error state
  if (error) {
    const containerClass = isModal 
      ? 'fixed inset-0 z-50 bg-white overflow-auto' 
      : 'max-w-2xl mx-auto';
    
    return (
      <div className={containerClass}>
        <div className="sticky top-0 bg-white border-b border-warm-200 px-4 py-4 z-10">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-warm-800 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-primary" />
                Your ROI
              </h1>
            </div>
            {onClose && (
              <button onClick={onClose} className="p-2 hover:bg-warm-100 rounded-lg">
                <X className="w-5 h-5 text-warm-400" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-center p-12">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <X className="w-6 h-6 text-red-500" />
            </div>
            <p className="text-warm-800 font-medium">Unable to load data</p>
            <p className="text-warm-500 text-sm mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Handle no data state
  if (!currentWeek && !currentMonth && daysSinceStart < 7) {
    const containerClass = isModal 
      ? 'fixed inset-0 z-50 bg-white overflow-auto' 
      : 'max-w-2xl mx-auto';
    
    return (
      <div className={containerClass}>
        <div className="sticky top-0 bg-white border-b border-warm-200 px-4 py-4 z-10">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-warm-800 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-primary" />
                Your ROI
              </h1>
            </div>
            {onClose && (
              <button onClick={onClose} className="p-2 hover:bg-warm-100 rounded-lg">
                <X className="w-5 h-5 text-warm-400" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-center p-12">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <Trophy className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-bold text-warm-800">Just Getting Started</h2>
            <p className="text-warm-500 text-sm mt-2">
              Keep using Pulse! After a week of data collection, we'll show you trends, 
              comparisons, and estimated revenue impact.
            </p>
            <div className="mt-6 p-3 rounded-lg bg-warm-50 border border-warm-100">
              <p className="text-sm text-warm-600">
                📊 Data collecting since {firstRecordedDate?.toLocaleDateString([], { month: 'short', day: 'numeric' }) || 'today'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Handle export
  const handleExport = () => {
    // Create a simple text summary for now
    const summary = generateExportSummary(data);
    const blob = new Blob([summary], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-roi-report-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const containerClass = isModal 
    ? 'fixed inset-0 z-50 bg-white overflow-auto' 
    : 'max-w-2xl mx-auto';

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-warm-200 px-4 py-4 z-10">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div>
            <h1 className="text-xl font-bold text-warm-800 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-primary" />
              Your ROI
            </h1>
            <p className="text-sm text-warm-500">
              {daysSinceStart} days with Pulse
              {firstRecordedDate && (
                <span className="text-warm-400"> · Since {firstRecordedDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-warm-100 text-warm-600 text-sm font-medium hover:bg-warm-200 transition-colors"
              whileTap={{ scale: 0.95 }}
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </motion.button>
            {onClose && (
              <button onClick={onClose} className="p-2 hover:bg-warm-100 rounded-lg">
                <X className="w-5 h-5 text-warm-400" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 max-w-2xl mx-auto">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'weekly', label: 'Weekly' },
            { id: 'monthly', label: 'Monthly' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-white'
                  : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-w-2xl mx-auto pb-8" ref={exportRef}>
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <OverviewTab 
                data={data}
                comparison={monthOverMonth}
                insights={insights}
                revenueImpact={estimatedRevenueImpact}
              />
            </motion.div>
          )}
          {activeTab === 'weekly' && (
            <motion.div
              key="weekly"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <PeriodTab
                currentPeriod={currentWeek}
                previousPeriod={previousWeek}
                comparison={weekOverWeek}
                periodLabel="Week"
              />
            </motion.div>
          )}
          {activeTab === 'monthly' && (
            <motion.div
              key="monthly"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <PeriodTab
                currentPeriod={currentMonth}
                previousPeriod={previousMonth}
                comparison={monthOverMonth}
                periodLabel="Month"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============ OVERVIEW TAB ============

function OverviewTab({ 
  data,
  comparison,
  insights,
  revenueImpact,
}: { 
  data: ROIData;
  comparison: ROIComparison | null;
  insights: ROIInsight[];
  revenueImpact: ROIData['estimatedRevenueImpact'];
}) {
  const { allTime, currentMonth, daysSinceStart } = data;

  return (
    <div className="space-y-6">
      {/* Hero Stat */}
      {comparison && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`p-6 rounded-2xl text-center ${
            comparison.trend === 'improving' 
              ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200' 
              : comparison.trend === 'declining'
              ? 'bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200'
              : 'bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200'
          }`}
        >
          <div className="flex items-center justify-center gap-2 mb-2">
            {comparison.trend === 'improving' ? (
              <TrendingUp className="w-6 h-6 text-green-600" />
            ) : comparison.trend === 'declining' ? (
              <TrendingDown className="w-6 h-6 text-amber-600" />
            ) : (
              <Minus className="w-6 h-6 text-blue-600" />
            )}
            <span className={`text-lg font-semibold ${
              comparison.trend === 'improving' ? 'text-green-700' :
              comparison.trend === 'declining' ? 'text-amber-700' : 'text-blue-700'
            }`}>
              {comparison.trend === 'improving' ? 'Improving' :
               comparison.trend === 'declining' ? 'Needs Attention' : 'Steady'}
            </span>
          </div>
          <p className={`text-sm ${
            comparison.trend === 'improving' ? 'text-green-600' :
            comparison.trend === 'declining' ? 'text-amber-600' : 'text-blue-600'
          }`}>
            {comparison.summary}
          </p>
        </motion.div>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={Zap}
          label="Avg Pulse"
          current={currentMonth?.avgPulseScore ?? '--'}
          previous={data.previousMonth?.avgPulseScore ?? null}
          change={comparison?.pulseScoreChange ?? null}
          changePercent={comparison?.pulseScoreChangePercent ?? null}
          higherIsBetter={true}
        />
        <MetricCard
          icon={Clock}
          label="Avg Dwell"
          current={currentMonth?.avgDwellTime ?? '--'}
          previous={data.previousMonth?.avgDwellTime ?? null}
          change={comparison?.dwellTimeChange ?? null}
          changePercent={comparison?.dwellTimeChangePercent ?? null}
          unit="min"
          higherIsBetter={true}
        />
        <MetricCard
          icon={Users}
          label="Visitors"
          current={currentMonth?.totalVisitors.toLocaleString() ?? '--'}
          previous={data.previousMonth?.totalVisitors ?? null}
          change={comparison?.visitorChange ?? null}
          changePercent={comparison?.visitorChangePercent ?? null}
          higherIsBetter={true}
        />
        <MetricCard
          icon={Target}
          label="Optimal Time"
          current={`${currentMonth?.optimalTimePercent ?? '--'}%`}
          previous={data.previousMonth?.optimalTimePercent ?? null}
          change={comparison?.optimalTimeChange ?? null}
          changePercent={null}
          format="percent"
          higherIsBetter={true}
        />
      </div>

      {/* Revenue Impact */}
      {revenueImpact && revenueImpact.total > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-5 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 text-white"
        >
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-5 h-5" />
            <span className="font-semibold">Estimated Revenue Impact</span>
          </div>
          <p className="text-3xl font-bold mb-1">
            +${revenueImpact.total.toLocaleString()}
          </p>
          <p className="text-sm text-white/80">
            This month vs last month
          </p>
          <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-white/70">From longer stays</p>
              <p className="font-semibold">${revenueImpact.dwellTimeRevenue.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-white/70">From more visitors</p>
              <p className="font-semibold">${revenueImpact.visitorRevenue.toLocaleString()}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-white/60">{revenueImpact.assumptions}</p>
        </motion.div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-warm-800 mb-3 flex items-center gap-2">
            <Award className="w-5 h-5 text-primary" />
            Wins & Insights
          </h3>
          <div className="space-y-2">
            {insights.map((insight, index) => (
              <InsightCard key={insight.id} insight={insight} index={index} />
            ))}
          </div>
        </div>
      )}

      {/* All-time Stats */}
      {allTime && (
        <div>
          <h3 className="text-lg font-semibold text-warm-800 mb-3 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            All-Time ({daysSinceStart} days)
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-warm-50">
              <p className="text-sm text-warm-500 mb-1">Total Visitors</p>
              <p className="text-2xl font-bold text-warm-800">{allTime.totalVisitors.toLocaleString()}</p>
            </div>
            <div className="p-4 rounded-xl bg-warm-50">
              <p className="text-sm text-warm-500 mb-1">Total Shifts</p>
              <p className="text-2xl font-bold text-warm-800">{allTime.totalShifts}</p>
            </div>
            {allTime.bestNight && (
              <div className="p-4 rounded-xl bg-green-50 border border-green-200 col-span-2">
                <div className="flex items-center gap-2 mb-1">
                  <Trophy className="w-4 h-4 text-green-600" />
                  <p className="text-sm font-medium text-green-700">Best Night</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-warm-700">
                    {allTime.bestNight.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  <p className="text-lg font-bold text-green-700">Pulse {allTime.bestNight.pulseScore}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ PERIOD TAB ============

function PeriodTab({
  currentPeriod,
  previousPeriod,
  comparison,
  periodLabel,
}: {
  currentPeriod: PeriodMetrics | null;
  previousPeriod: PeriodMetrics | null;
  comparison: ROIComparison | null;
  periodLabel: 'Week' | 'Month';
}) {
  if (!currentPeriod) {
    return (
      <div className="py-12 text-center text-warm-500">
        <Calendar className="w-12 h-12 mx-auto mb-4 text-warm-300" />
        <p>No data for this {periodLabel.toLowerCase()} yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-warm-500">This {periodLabel}</p>
          <p className="text-warm-700">
            {currentPeriod.startDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} - {currentPeriod.endDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </p>
        </div>
        {comparison && (
          <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
            comparison.trend === 'improving' 
              ? 'bg-green-100 text-green-700' 
              : comparison.trend === 'declining'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-blue-100 text-blue-700'
          }`}>
            {comparison.trend === 'improving' ? <TrendingUp className="w-4 h-4" /> : 
             comparison.trend === 'declining' ? <TrendingDown className="w-4 h-4" /> : 
             <Minus className="w-4 h-4" />}
            vs last {periodLabel.toLowerCase()}
          </div>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={Zap}
          label="Avg Pulse Score"
          current={currentPeriod.avgPulseScore}
          previous={previousPeriod?.avgPulseScore ?? null}
          change={comparison?.pulseScoreChange ?? null}
          changePercent={comparison?.pulseScoreChangePercent ?? null}
          higherIsBetter={true}
        />
        <MetricCard
          icon={Clock}
          label="Avg Dwell Time"
          current={currentPeriod.avgDwellTime}
          previous={previousPeriod?.avgDwellTime ?? null}
          change={comparison?.dwellTimeChange ?? null}
          changePercent={comparison?.dwellTimeChangePercent ?? null}
          unit="min"
          higherIsBetter={true}
        />
        <MetricCard
          icon={Users}
          label="Total Visitors"
          current={currentPeriod.totalVisitors.toLocaleString()}
          previous={previousPeriod?.totalVisitors ?? null}
          change={comparison?.visitorChange ?? null}
          changePercent={comparison?.visitorChangePercent ?? null}
          higherIsBetter={true}
        />
        <MetricCard
          icon={Target}
          label="Time at Optimal"
          current={`${currentPeriod.optimalTimePercent}%`}
          previous={previousPeriod?.optimalTimePercent ?? null}
          change={comparison?.optimalTimeChange ?? null}
          changePercent={null}
          format="percent"
          higherIsBetter={true}
        />
      </div>

      {/* Peak Night */}
      {currentPeriod.peakNight && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-5 h-5 text-green-600" />
            <span className="font-semibold text-green-800">Best Night This {periodLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-warm-700">
                {currentPeriod.peakNight.date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
              <p className="text-sm text-warm-500">{currentPeriod.peakNight.visitors} visitors</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-green-700">{currentPeriod.peakNight.pulseScore}</p>
              <p className="text-xs text-green-600">Pulse Score</p>
            </div>
          </div>
        </div>
      )}

      {/* Comparison Summary */}
      {comparison && (
        <div className="p-4 rounded-xl bg-warm-50 border border-warm-200">
          <p className="text-sm font-medium text-warm-700 mb-2">Summary</p>
          <p className="text-warm-600">{comparison.summary}</p>
        </div>
      )}
    </div>
  );
}

// ============ METRIC CARD ============

function MetricCard({
  icon: Icon,
  label,
  current,
  previous,
  change,
  changePercent,
  unit = '',
  higherIsBetter = true,
}: MetricCardProps) {
  const isPositive = change !== null && (higherIsBetter ? change > 0 : change < 0);
  const isNeutral = change === null || change === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-white border border-warm-200"
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-warm-400" />
        <span className="text-sm text-warm-500">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-bold text-warm-800">
          {current}{unit && <span className="text-lg text-warm-400 ml-0.5">{unit}</span>}
        </p>
        {change !== null && !isNeutral && (
          <div className={`flex items-center gap-0.5 text-sm font-medium ${
            isPositive ? 'text-green-600' : 'text-red-500'
          }`}>
            {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            {changePercent !== null ? `${changePercent > 0 ? '+' : ''}${changePercent}%` : 
              `${change > 0 ? '+' : ''}${change}${unit}`}
          </div>
        )}
      </div>
      {previous !== null && (
        <p className="text-xs text-warm-400 mt-1">
          Last period: {typeof previous === 'number' ? previous.toLocaleString() : previous}{unit}
        </p>
      )}
    </motion.div>
  );
}

// ============ INSIGHT CARD ============

function InsightCard({ insight, index }: { insight: ROIInsight; index: number }) {
  const getIconColor = () => {
    switch (insight.type) {
      case 'win': return 'bg-green-100 text-green-600';
      case 'opportunity': return 'bg-amber-100 text-amber-600';
      case 'milestone': return 'bg-purple-100 text-purple-600';
      default: return 'bg-warm-100 text-warm-600';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="p-4 rounded-xl bg-white border border-warm-200 flex items-start gap-3"
    >
      <div className={`w-10 h-10 rounded-lg ${getIconColor()} flex items-center justify-center flex-shrink-0`}>
        <span className="text-lg">{insight.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-warm-800">{insight.title}</p>
        <p className="text-sm text-warm-500">{insight.description}</p>
        {insight.metric && (
          <p className="text-sm font-bold text-primary mt-1">{insight.metric}</p>
        )}
      </div>
    </motion.div>
  );
}

// ============ EXPORT HELPER ============

function generateExportSummary(data: ROIData): string {
  const lines: string[] = [];
  
  lines.push('='.repeat(50));
  lines.push('PULSE ROI REPORT');
  lines.push(`Generated: ${new Date().toLocaleDateString()}`);
  lines.push('='.repeat(50));
  lines.push('');
  
  if (data.firstRecordedDate) {
    lines.push(`Days using Pulse: ${data.daysSinceStart}`);
    lines.push(`Started: ${data.firstRecordedDate.toLocaleDateString()}`);
    lines.push('');
  }
  
  lines.push('--- THIS MONTH ---');
  if (data.currentMonth) {
    lines.push(`Average Pulse Score: ${data.currentMonth.avgPulseScore}`);
    lines.push(`Average Dwell Time: ${data.currentMonth.avgDwellTime} minutes`);
    lines.push(`Total Visitors: ${data.currentMonth.totalVisitors.toLocaleString()}`);
    lines.push(`Time at Optimal: ${data.currentMonth.optimalTimePercent}%`);
  }
  lines.push('');
  
  if (data.monthOverMonth) {
    lines.push('--- vs LAST MONTH ---');
    lines.push(`Pulse Score: ${data.monthOverMonth.pulseScoreChange > 0 ? '+' : ''}${data.monthOverMonth.pulseScoreChange}`);
    lines.push(`Dwell Time: ${data.monthOverMonth.dwellTimeChange > 0 ? '+' : ''}${data.monthOverMonth.dwellTimeChange} min`);
    lines.push(`Visitors: ${data.monthOverMonth.visitorChangePercent > 0 ? '+' : ''}${data.monthOverMonth.visitorChangePercent}%`);
    lines.push(`Trend: ${data.monthOverMonth.trend.toUpperCase()}`);
    lines.push('');
  }
  
  if (data.estimatedRevenueImpact && data.estimatedRevenueImpact.total > 0) {
    lines.push('--- ESTIMATED REVENUE IMPACT ---');
    lines.push(`Total: +$${data.estimatedRevenueImpact.total.toLocaleString()}`);
    lines.push(`From longer stays: $${data.estimatedRevenueImpact.dwellTimeRevenue.toLocaleString()}`);
    lines.push(`From more visitors: $${data.estimatedRevenueImpact.visitorRevenue.toLocaleString()}`);
    lines.push(`(${data.estimatedRevenueImpact.assumptions})`);
    lines.push('');
  }
  
  if (data.insights.length > 0) {
    lines.push('--- HIGHLIGHTS ---');
    data.insights.forEach(insight => {
      lines.push(`${insight.icon} ${insight.title}: ${insight.description}`);
    });
    lines.push('');
  }
  
  if (data.allTime) {
    lines.push('--- ALL-TIME STATS ---');
    lines.push(`Total Visitors: ${data.allTime.totalVisitors.toLocaleString()}`);
    lines.push(`Total Shifts: ${data.allTime.totalShifts}`);
    lines.push(`Average Pulse Score: ${data.allTime.avgPulseScore}`);
    if (data.allTime.bestNight) {
      lines.push(`Best Night: ${data.allTime.bestNight.date.toLocaleDateString()} (Pulse ${data.allTime.bestNight.pulseScore})`);
    }
  }
  
  lines.push('');
  lines.push('='.repeat(50));
  lines.push('Report generated by Pulse');
  
  return lines.join('\n');
}

export default ROIDashboard;
