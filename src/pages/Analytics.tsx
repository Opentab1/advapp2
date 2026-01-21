/**
 * Analytics Page - WHOOP-style Insights
 * 
 * Design Philosophy:
 * - ONE hero metric (answers "How am I doing?")
 * - 3 actionable insights (what's working, what needs work, what to do)
 * - Progressive disclosure (tap for details)
 * - Mobile-first, desktop-friendly
 * 
 * Bar owners want ANSWERS, not data.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Download, MoreHorizontal, Calendar } from 'lucide-react';
import {
  InsightsHero,
  ActionableInsight,
  generateInsights,
  TimeRangePicker,
  DwellCorrelation,
  SummaryBreakdownModal,
  SweetSpotModal,
  TrendModal,
  RawDataView,
} from '../components/analytics';
import { YearOverYear } from '../components/analytics/YearOverYear';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { ErrorState } from '../components/common/LoadingState';
import { useInsightsData } from '../hooks/useInsightsData';
import { useDisplayName } from '../hooks/useDisplayName';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { haptic } from '../utils/haptics';
import type { InsightsTimeRange, MetricType } from '../types/insights';

type ModalType = 'summary' | 'sweetspot' | 'trend' | null;
type ViewMode = 'insights' | 'compare';

export function Analytics() {
  const user = authService.getStoredUser();
  const { displayName } = useDisplayName();
  const venueName = displayName || user?.venueName || 'Venue';
  
  const [viewMode, setViewMode] = useState<ViewMode>('insights');
  const [timeRange, setTimeRange] = useState<InsightsTimeRange>('7d');
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showRawData, setShowRawData] = useState(false);
  const [rawDataMetric, setRawDataMetric] = useState<MetricType>('score');
  const [showMenu, setShowMenu] = useState(false);
  
  const insights = useInsightsData(timeRange);
  
  // Generate actionable insights from data
  const actionableInsights = useMemo(() => {
    if (!insights.summary || !insights.trend) return [];
    
    return generateInsights({
      score: insights.summary.score,
      scoreDelta: insights.summary.scoreDelta,
      bestDay: insights.trend.bestDay,
      worstDay: insights.trend.worstDay,
      sweetSpot: insights.sweetSpot ? {
        range: insights.sweetSpot.optimalRange,
        hitPercentage: insights.sweetSpot.hitPercentage,
        scoreDiff: insights.sweetSpot.optimalScore - insights.sweetSpot.outsideScore,
      } : undefined,
      factorScores: insights.factorScores.map(f => ({
        factor: f.factor,
        score: f.score,
      })),
    });
  }, [insights.summary, insights.trend, insights.sweetSpot, insights.factorScores]);
  
  const handleRefresh = async () => {
    haptic('medium');
    await insights.refresh();
  };
  
  const handleOpenModal = (modal: ModalType) => {
    haptic('light');
    setActiveModal(modal);
  };
  
  const handleViewRawData = (metric?: MetricType) => {
    if (metric) setRawDataMetric(metric);
    setActiveModal(null);
    setShowRawData(true);
    setShowMenu(false);
  };
  
  const handleExportCSV = () => {
    haptic('medium');
    setShowMenu(false);
    if (insights.rawData.length > 0) {
      const exportData = insights.rawData.map(d => ({
        timestamp: d.timestamp.toISOString(),
        score: d.score,
        decibels: d.decibels,
        light: d.light,
        temperature: d.temperature,
        occupancy: d.occupancy,
      }));
      apiService.exportToCSV(exportData as any, true, venueName);
    }
  };
  
  if (insights.error && !insights.summary) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">Insights</h1>
          <TimeRangePicker value={timeRange} onChange={setTimeRange} loading={insights.loading} />
        </div>
        <ErrorState 
          title="Couldn't load insights" 
          message={insights.error} 
          onRetry={handleRefresh} 
        />
      </div>
    );
  }
  
  return (
    <>
      <PullToRefresh onRefresh={handleRefresh} disabled={insights.loading}>
        <div className="space-y-5 pb-24">
          
          {/* Header Row */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-white">Insights</h1>
            
            <div className="flex items-center gap-2">
              {/* Refresh button */}
              <motion.button
                onClick={handleRefresh}
                disabled={insights.loading}
                className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors"
                whileTap={{ scale: 0.95 }}
              >
                <RefreshCw className={`w-4 h-4 ${insights.loading ? 'animate-spin' : ''}`} />
              </motion.button>
              
              {/* More menu */}
              <div className="relative">
                <motion.button
                  onClick={() => { haptic('light'); setShowMenu(!showMenu); }}
                  className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors"
                  whileTap={{ scale: 0.95 }}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </motion.button>
                
                <AnimatePresence>
                  {showMenu && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute right-0 top-full mt-2 w-48 bg-warm-800 border border-warm-700 rounded-lg shadow-xl z-50"
                    >
                      <button
                        onClick={() => handleViewRawData('score')}
                        className="w-full px-4 py-3 text-left text-sm text-warm-300 hover:bg-warm-700 flex items-center gap-2"
                      >
                        <Calendar className="w-4 h-4" />
                        View Raw Data
                      </button>
                      <button
                        onClick={handleExportCSV}
                        disabled={insights.rawData.length === 0}
                        className="w-full px-4 py-3 text-left text-sm text-warm-300 hover:bg-warm-700 flex items-center gap-2 border-t border-warm-700"
                      >
                        <Download className="w-4 h-4" />
                        Export CSV
                      </button>
                      <button
                        onClick={() => { haptic('light'); setViewMode('compare'); setShowMenu(false); }}
                        className="w-full px-4 py-3 text-left text-sm text-warm-300 hover:bg-warm-700 flex items-center gap-2 border-t border-warm-700"
                      >
                        <Calendar className="w-4 h-4" />
                        Year-over-Year
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {viewMode === 'insights' ? (
            <>
              {/* Time Range Picker */}
              <TimeRangePicker 
                value={timeRange} 
                onChange={setTimeRange} 
                loading={insights.loading} 
              />
              
              {/* Hero Section - THE Answer */}
              <InsightsHero 
                data={insights.summary} 
                timeRange={timeRange} 
                loading={insights.loading} 
              />
              
              {/* Actionable Insights */}
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-warm-400 uppercase tracking-whoop">
                  Key Insights
                </h2>
                
                {insights.loading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="bg-warm-800 rounded-xl p-4 animate-pulse">
                        <div className="flex gap-3">
                          <div className="w-10 h-10 bg-warm-700 rounded-full" />
                          <div className="flex-1 space-y-2">
                            <div className="h-3 bg-warm-700 rounded w-20" />
                            <div className="h-5 bg-warm-700 rounded w-40" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {actionableInsights.map((insight, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                      >
                        <ActionableInsight
                          {...insight}
                          onTap={() => {
                            // Open relevant modal based on insight type
                            if (insight.title.includes('Sweet Spot')) {
                              handleOpenModal('sweetspot');
                            } else if (insight.title.includes('Best') || insight.title.includes('Attention')) {
                              handleOpenModal('trend');
                            } else {
                              handleOpenModal('summary');
                            }
                          }}
                        />
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Dwell Time Correlations - What keeps guests longer */}
              <DwellCorrelation 
                data={insights.dwellCorrelations} 
                loading={insights.loading} 
              />
              
              {/* Deep Dive Prompt */}
              {!insights.loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="text-center pt-4"
                >
                  <p className="text-sm text-warm-500">
                    Tap any card for details
                  </p>
                </motion.div>
              )}
            </>
          ) : (
            <>
              {/* Year-over-Year View */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => { haptic('light'); setViewMode('insights'); }}
                  className="text-sm text-primary flex items-center gap-1"
                >
                  ← Back to Insights
                </button>
              </div>
              <YearOverYear />
            </>
          )}
        </div>
      </PullToRefresh>
      
      {/* Click outside to close menu */}
      {showMenu && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setShowMenu(false)} 
        />
      )}
      
      {/* Drill-down Modals (Level 2) */}
      <AnimatePresence>
        {activeModal === 'summary' && (
          <SummaryBreakdownModal 
            isOpen 
            onClose={() => setActiveModal(null)} 
            summary={insights.summary} 
            hourlyData={insights.hourlyData} 
            factorScores={insights.factorScores} 
            comparison={insights.comparison} 
            onViewRawData={() => handleViewRawData('score')} 
          />
        )}
        {activeModal === 'sweetspot' && (
          <SweetSpotModal 
            isOpen 
            onClose={() => setActiveModal(null)} 
            data={insights.sweetSpot} 
            allVariables={insights.allSweetSpots} 
            onViewRawData={() => handleViewRawData('sound')} 
          />
        )}
        {activeModal === 'trend' && (
          <TrendModal 
            isOpen 
            onClose={() => setActiveModal(null)} 
            data={insights.trend} 
            timeRange={timeRange} 
            chartData={insights.trendChartData} 
            onViewRawData={() => handleViewRawData('score')} 
          />
        )}
      </AnimatePresence>
      
      {/* Raw Data View (Level 3 - Deep dive for power users) */}
      <AnimatePresence>
        {showRawData && (
          <RawDataView 
            isOpen 
            onClose={() => setShowRawData(false)} 
            data={insights.rawData} 
            timeRange={timeRange} 
            onTimeRangeChange={setTimeRange} 
            initialMetric={rawDataMetric} 
            onExport={handleExportCSV} 
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default Analytics;
