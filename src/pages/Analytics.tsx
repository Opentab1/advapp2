import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, Calendar } from 'lucide-react';
import {
  InsightsHeader,
  SummaryCard,
  SweetSpotCard,
  TrendCard,
  ExportButton,
  SummaryBreakdownModal,
  SweetSpotModal,
  TrendModal,
  RawDataView,
} from '../components/analytics';
import { YearOverYear } from '../components/analytics/YearOverYear';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { ErrorState } from '../components/common/LoadingState';
import { useInsightsData } from '../hooks/useInsightsData';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { haptic } from '../utils/haptics';
import type { InsightsTimeRange, MetricType } from '../types/insights';

type ModalType = 'summary' | 'sweetspot' | 'trend' | null;
type AnalyticsTab = 'overview' | 'yoy';

export function Analytics() {
  const user = authService.getStoredUser();
  const venueName = user?.venueName || 'Venue';
  
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [timeRange, setTimeRange] = useState<InsightsTimeRange>('7d');
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [showRawData, setShowRawData] = useState(false);
  const [rawDataMetric, setRawDataMetric] = useState<MetricType>('score');
  
  const insights = useInsightsData(timeRange);
  
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
  };
  
  const handleExportCSV = () => {
    haptic('medium');
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
        <InsightsHeader
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          loading={insights.loading}
          onRefresh={handleRefresh}
        />
        <ErrorState title="Couldn't load analytics" message={insights.error} onRetry={handleRefresh} />
      </div>
    );
  }
  
  return (
    <>
      <PullToRefresh onRefresh={handleRefresh} disabled={insights.loading}>
        <div className="space-y-5 pb-20">
          {/* Tab Navigation */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {[
                { id: 'overview' as const, label: 'Overview', icon: BarChart3 },
                { id: 'yoy' as const, label: 'Year-over-Year', icon: Calendar },
              ].map((tab) => (
                <motion.button
                  key={tab.id}
                  onClick={() => { haptic('selection'); setActiveTab(tab.id); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                    activeTab === tab.id
                      ? 'bg-primary/20 border border-primary/50 text-white'
                      : 'bg-warm-800 border border-warm-700 text-warm-400 hover:text-white'
                  }`}
                  whileTap={{ scale: 0.95 }}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </motion.button>
              ))}
            </div>
          </div>

          {activeTab === 'overview' ? (
            <>
              <InsightsHeader timeRange={timeRange} onTimeRangeChange={setTimeRange} loading={insights.loading} onRefresh={handleRefresh} />
              <motion.div className="space-y-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <SummaryCard data={insights.summary} timeRange={timeRange} loading={insights.loading} onTapDetails={() => handleOpenModal('summary')} />
                  <SweetSpotCard data={insights.sweetSpot} loading={insights.loading} onTapDetails={() => handleOpenModal('sweetspot')} />
                </div>
                <TrendCard data={insights.trend} timeRange={timeRange} loading={insights.loading} onTapDetails={() => handleOpenModal('trend')} />
                <ExportButton onDownloadCSV={handleExportCSV} onEmailSummary={() => alert('Coming soon')} onCopyLink={() => { navigator.clipboard.writeText(window.location.href); alert('Copied'); }} disabled={insights.loading || insights.rawData.length === 0} />
              </motion.div>
            </>
          ) : (
            <YearOverYear />
          )}
        </div>
      </PullToRefresh>
      <AnimatePresence>
        {activeModal === 'summary' && <SummaryBreakdownModal isOpen onClose={() => setActiveModal(null)} summary={insights.summary} hourlyData={insights.hourlyData} factorScores={insights.factorScores} comparison={insights.comparison} onViewRawData={() => handleViewRawData('score')} />}
        {activeModal === 'sweetspot' && <SweetSpotModal isOpen onClose={() => setActiveModal(null)} data={insights.sweetSpot} allVariables={insights.allSweetSpots} onViewRawData={() => handleViewRawData('sound')} />}
        {activeModal === 'trend' && <TrendModal isOpen onClose={() => setActiveModal(null)} data={insights.trend} timeRange={timeRange} chartData={insights.trendChartData} onViewRawData={() => handleViewRawData('score')} />}
      </AnimatePresence>
      <AnimatePresence>
        {showRawData && <RawDataView isOpen onClose={() => setShowRawData(false)} data={insights.rawData} timeRange={timeRange} onTimeRangeChange={setTimeRange} initialMetric={rawDataMetric} onExport={handleExportCSV} />}
      </AnimatePresence>
    </>
  );
}

export default Analytics;
