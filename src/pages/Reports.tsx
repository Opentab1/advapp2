import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Download, Sparkles, TrendingUp, Calendar, Music, ThermometerSun, Users } from 'lucide-react';
import { format, subDays } from 'date-fns';
import aiReportService from '../services/ai-report.service';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { isDemoAccount, generateDemoMonthlyReport, generateDemoMusicReport, generateDemoAtmosphereReport, generateDemoOccupancyReport, generateDemoWeeklyMetrics } from '../utils/demoData';
import { aggregateOccupancyByBarDay } from '../utils/barDay';
import locationService from '../services/location.service';
import { formatValueAllowZero, formatValueNoZero } from '../utils/dataDisplay';
import type { WeeklyReport, WeeklyMetrics } from '../types';

type ReportType = 'weekly' | 'monthly' | 'music' | 'atmosphere' | 'occupancy' | 'custom';

export function Reports() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<WeeklyReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<ReportType>('weekly');
  const [showScheduler, setShowScheduler] = useState(false);
  const [timeRange, setTimeRange] = useState<'1d' | '7d' | '30d' | '90d' | 'custom'>('7d');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    const loaded = await aiReportService.getRecentReports(20);
    setReports(loaded);
    if (loaded.length > 0 && !selectedReport) {
      setSelectedReport(loaded[0]);
    }
  };

  const generateReport = async () => {
    setGenerating(true);
    try {
      const weekEnd = new Date();
      let weekStart: Date;
      let daysToFetch: string;

      // Calculate date range based on selection and report type
      if (timeRange === 'custom') {
        if (!customStartDate || !customEndDate) {
          alert('Please select both start and end dates for custom range');
          setGenerating(false);
          return;
        }
        weekStart = new Date(customStartDate);
        const customEnd = new Date(customEndDate);
        const daysDiff = Math.ceil((customEnd.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24));
        daysToFetch = `${daysDiff}d`;
      } else if (selectedReportType === 'monthly') {
        // Monthly report - 30 days
        const days = 30;
        weekStart = subDays(weekEnd, days);
        daysToFetch = '30d';
      } else {
        const days = parseInt(timeRange);
        weekStart = subDays(weekEnd, days);
        daysToFetch = timeRange;
      }

      // Fetch real historical data from DynamoDB
      const user = authService.getStoredUser();
      const venueId = user?.venueId;

      if (!venueId) {
        alert('Unable to generate report: Venue ID not found');
        return;
      }

      // ✨ DEMO MODE: Generate specialized report based on type
      if (isDemoAccount(venueId)) {
        console.log(`🎭 Demo mode - generating ${selectedReportType} report`);
        let demoReport: WeeklyReport;
        
        switch (selectedReportType) {
          case 'monthly':
            demoReport = generateDemoMonthlyReport(weekStart, weekEnd);
            break;
          case 'music':
            demoReport = generateDemoMusicReport(weekStart, weekEnd);
            break;
          case 'atmosphere':
            demoReport = generateDemoAtmosphereReport(weekStart, weekEnd);
            break;
          case 'occupancy':
            demoReport = generateDemoOccupancyReport(weekStart, weekEnd);
            break;
          case 'custom':
            // For custom, use the weekly report with custom date range
            demoReport = await aiReportService.generateWeeklyReport(weekStart, weekEnd, generateDemoWeeklyMetrics());
            break;
          case 'weekly':
          default:
            // Use the standard weekly report generator
            demoReport = await aiReportService.generateWeeklyReport(weekStart, weekEnd, generateDemoWeeklyMetrics());
            break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 800)); // Simulate processing
        setSelectedReport(demoReport);
        // For demo, prepend to reports list temporarily (not persisted)
        setReports([demoReport, ...reports]);
        setGenerating(false);
        return;
      }

      console.log(`📊 Fetching historical data for ${selectedReportType} report (${daysToFetch})...`);
      
      try {
        // Fetch historical data based on selected time range
        const historicalData = await apiService.getHistoricalData(venueId, daysToFetch as any);
        
        // Calculate metrics from real data
        let totalComfort = 0;
        let totalTemp = 0;
        let totalDecibels = 0;
        let totalHumidity = 0;
        let dataPoints = 0;
        let maxOccupancy = 0;

        if (historicalData.data && historicalData.data.length > 0) {
          historicalData.data.forEach((point) => {
            if (point.indoorTemp) totalTemp += point.indoorTemp;
            if (point.decibels) totalDecibels += point.decibels;
            if (point.humidity) totalHumidity += point.humidity;
            if (point.occupancy?.current && point.occupancy.current > maxOccupancy) {
              maxOccupancy = point.occupancy.current;
            }
            dataPoints++;
          });
        }

        // Get venue timezone for bar day calculations
        const locations = locationService.getLocations();
        const timezone = locations[0]?.timezone || 'America/New_York';
        
        // Calculate occupancy using bar day (3am-3am) boundaries
        const occupancyStats = aggregateOccupancyByBarDay(
          historicalData.data || [],
          weekStart,
          weekEnd,
          timezone
        );
        
        const daysInPeriod = occupancyStats.dailyBreakdown.length || 1;

        const metrics: WeeklyMetrics = {
          avgComfort: dataPoints > 0 ? totalComfort / dataPoints : 0,
          avgTemperature: dataPoints > 0 ? totalTemp / dataPoints : 0,
          avgDecibels: dataPoints > 0 ? totalDecibels / dataPoints : 0,
          avgHumidity: dataPoints > 0 ? totalHumidity / dataPoints : 0,
          peakHours: dataPoints > 0 ? ['6-7 PM', '8-9 PM', '9-10 PM'] : [],
          totalCustomers: occupancyStats.totalEntries, // Use bar day entries as customer count
          totalRevenue: 0, // Not available yet - future POS integration
          topSongs: [], // Not available yet - future song analytics
          // Bar day occupancy metrics
          totalEntries: occupancyStats.totalEntries,
          totalExits: occupancyStats.totalExits,
          avgDailyEntries: Math.round(occupancyStats.totalEntries / daysInPeriod),
          avgDailyExits: Math.round(occupancyStats.totalExits / daysInPeriod),
          peakOccupancy: maxOccupancy,
          dailyOccupancy: occupancyStats.dailyBreakdown
        };
        
        console.log('📊 Report metrics with bar day occupancy:', metrics);

        const report = await aiReportService.generateWeeklyReport(weekStart, weekEnd, metrics);
        await aiReportService.saveReport(report);
        await loadReports();
        setSelectedReport(report);
        
        console.log('✅ Report generated with real data:', metrics);
      } catch (dataError) {
        console.error('Error fetching historical data:', dataError);
        // If no data available, generate report with zeros (will show N/A)
        const metrics: WeeklyMetrics = {
          avgComfort: 0,
          avgTemperature: 0,
          avgDecibels: 0,
          avgHumidity: 0,
          peakHours: [],
          totalCustomers: 0,
          totalRevenue: 0,
          topSongs: [],
          totalEntries: 0,
          totalExits: 0,
          avgDailyEntries: 0,
          avgDailyExits: 0,
          peakOccupancy: 0,
          dailyOccupancy: []
        };

        const report = await aiReportService.generateWeeklyReport(weekStart, weekEnd, metrics);
        await aiReportService.saveReport(report);
        await loadReports();
        setSelectedReport(report);
        
        console.log('✅ Report generated with N/A data (no historical data available)');
      }
      
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Failed to generate report. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const reportTypes = [
    { id: 'weekly' as ReportType, label: 'Weekly Summary', icon: Calendar },
    { id: 'monthly' as ReportType, label: 'Monthly Performance', icon: TrendingUp },
    { id: 'music' as ReportType, label: 'Music Analytics', icon: Music },
    { id: 'atmosphere' as ReportType, label: 'Atmosphere Optimization', icon: ThermometerSun },
    { id: 'occupancy' as ReportType, label: 'Occupancy Trends', icon: Users },
    { id: 'custom' as ReportType, label: 'Custom Report', icon: FileText },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold gradient-text mb-2">📋 AI-Generated Reports</h2>
            <p className="text-gray-400">Intelligent insights and recommendations</p>
          </div>
          <div className="flex gap-3 items-end">
            {/* Time Range Selector */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-400 font-medium">Time Range</label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as any)}
                className="glass-card px-4 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-cyan/50 focus:outline-none transition-colors"
              >
                <option value="1d">1 Day</option>
                <option value="7d">7 Days</option>
                <option value="30d">30 Days</option>
                <option value="90d">90 Days</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {/* Custom Date Range (shown when 'custom' is selected) */}
            {timeRange === 'custom' && (
              <>
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-gray-400 font-medium">Start Date</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="glass-card px-4 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-cyan/50 focus:outline-none transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-gray-400 font-medium">End Date</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="glass-card px-4 py-2 rounded-lg text-white text-sm border border-white/10 focus:border-cyan/50 focus:outline-none transition-colors"
                  />
                </div>
              </>
            )}

            {/* Generate Button */}
            <motion.button
              onClick={generateReport}
              disabled={generating}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 px-6 py-2 whitespace-nowrap"
              whileHover={{ scale: generating ? 1 : 1.05 }}
              whileTap={{ scale: generating ? 1 : 0.95 }}
            >
              <Sparkles className="w-4 h-4" />
              {generating ? 'Generating...' : 'Generate Report'}
            </motion.button>
          </div>
        </div>

        {/* Report Type Selector */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {reportTypes.map((type) => (
            <motion.button
              key={type.id}
              onClick={() => setSelectedReportType(type.id)}
              className={`glass-card p-4 text-center transition-all ${
                selectedReportType === type.id
                  ? 'border-purple-500/50 bg-purple-500/10'
                  : 'border-white/10 hover:border-purple-500/30'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <type.icon className={`w-6 h-6 mx-auto mb-2 ${
                selectedReportType === type.id ? 'text-purple-400' : 'text-gray-400'
              }`} />
              <div className={`text-xs font-medium ${
                selectedReportType === type.id ? 'text-white' : 'text-gray-400'
              }`}>
                {type.label}
              </div>
            </motion.button>
          ))}
        </div>

        {/* Scheduled Reports Banner */}
        {showScheduler && (
          <motion.div
            className="glass-card p-6 mb-6"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
          >
            <h3 className="text-lg font-semibold text-white mb-4">📅 Scheduled Reports</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-white/5 rounded">
                <div>
                  <div className="text-white font-medium">Weekly Summary</div>
                  <div className="text-sm text-gray-400">Every Monday at 9:00 AM</div>
                </div>
                <button className="btn-secondary text-xs">Edit</button>
              </div>
              <div className="flex items-center justify-between p-3 bg-white/5 rounded">
                <div>
                  <div className="text-white font-medium">Monthly Report</div>
                  <div className="text-sm text-gray-400">First day of month at 8:00 AM</div>
                </div>
                <button className="btn-secondary text-xs">Edit</button>
              </div>
              <button className="btn-primary w-full text-sm">+ Add New Schedule</button>
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Report List */}
          <motion.div
            className="glass-card p-4"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-cyan" />
              Past Reports
            </h3>

            <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
              {reports.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No reports generated yet</p>
                  <p className="text-xs mt-2">Generate your first AI report</p>
                </div>
              ) : (
                reports.map((report, index) => (
                  <motion.button
                    key={report.id}
                    onClick={() => setSelectedReport(report)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedReport?.id === report.id
                        ? 'bg-cyan/20 border border-cyan/50'
                        : 'bg-white/5 hover:bg-white/10'
                    }`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + index * 0.05 }}
                >
                  <div className="text-sm font-medium text-white">
                    {format(new Date(report.weekStart), 'MMM d')} - {format(new Date(report.weekEnd), 'MMM d, yyyy')}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Generated {format(new Date(report.generatedAt), 'MMM d')}
                  </div>
                </motion.button>
              ))
              )}
            </div>
          </motion.div>

          {/* Report Content */}
          {selectedReport && (
            <motion.div
              className="lg:col-span-3 space-y-6"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              {/* Summary */}
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/50 text-purple-300 text-xs font-medium">
                        {reportTypes.find(t => t.id === selectedReportType)?.label || 'Weekly Summary'}
                      </span>
                    </div>
                    <h3 className="text-2xl font-bold text-white">
                      {format(new Date(selectedReport.weekStart), 'MMMM d')} - {format(new Date(selectedReport.weekEnd), 'MMMM d, yyyy')}
                    </h3>
                  </div>
                  <motion.button
                    className="btn-secondary flex items-center gap-2"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Download className="w-4 h-4" />
                    Export PDF
                  </motion.button>
                </div>
                <p className="text-gray-300 leading-relaxed">{selectedReport.summary}</p>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Total Entries</div>
                  <div className="text-2xl font-bold text-green-400">
                    {formatValueAllowZero(selectedReport.metrics.totalEntries ?? selectedReport.metrics.totalCustomers) === '--' 
                      ? '--' 
                      : (selectedReport.metrics.totalEntries ?? selectedReport.metrics.totalCustomers).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">3am-3am bar days</div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Total Exits</div>
                  <div className="text-2xl font-bold text-red-400">
                    {formatValueAllowZero(selectedReport.metrics.totalExits) === '--' 
                      ? '--' 
                      : (selectedReport.metrics.totalExits ?? 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">3am-3am bar days</div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Avg Daily Entries</div>
                  <div className="text-2xl font-bold text-cyan">
                    {formatValueAllowZero(selectedReport.metrics.avgDailyEntries) === '--' 
                      ? '--' 
                      : (selectedReport.metrics.avgDailyEntries ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Peak Occupancy</div>
                  <div className="text-2xl font-bold text-yellow-400">
                    {formatValueAllowZero(selectedReport.metrics.peakOccupancy) === '--' 
                      ? '--' 
                      : (selectedReport.metrics.peakOccupancy ?? 0).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Environmental Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Avg Temp</div>
                  <div className="text-2xl font-bold text-orange-400">
                    {formatValueNoZero(selectedReport.metrics.avgTemperature, 1) === '--' 
                      ? '--' 
                      : `${selectedReport.metrics.avgTemperature.toFixed(1)}°F`}
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Avg Sound</div>
                  <div className="text-2xl font-bold text-purple-400">
                    {formatValueNoZero(selectedReport.metrics.avgDecibels, 1) === '--' 
                      ? '--' 
                      : `${selectedReport.metrics.avgDecibels.toFixed(1)} dB`}
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Avg Humidity</div>
                  <div className="text-2xl font-bold text-blue-400">
                    {formatValueNoZero(selectedReport.metrics.avgHumidity, 1) === '--' 
                      ? '--' 
                      : `${selectedReport.metrics.avgHumidity.toFixed(1)}%`}
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Revenue</div>
                  <div className="text-2xl font-bold text-green-400">
                    {selectedReport.metrics.totalRevenue > 0 
                      ? `$${selectedReport.metrics.totalRevenue.toLocaleString()}` 
                      : '--'}
                  </div>
                </div>
              </div>

              {/* Insights */}
              <div className="glass-card p-6">
                <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-cyan" />
                  Key Insights
                </h3>
                <div className="space-y-4">
                  {selectedReport.insights.map((insight, index) => (
                    <motion.div
                      key={index}
                      className="p-4 rounded-lg bg-white/5 border border-white/10"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + index * 0.1 }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <span className="text-xs text-cyan font-medium">{insight.category}</span>
                          <h4 className="text-white font-semibold mt-1">{insight.title}</h4>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-cyan">{insight.value}</div>
                          <div className={`text-xs ${
                            insight.trend === 'up' ? 'text-green-400' :
                            insight.trend === 'down' ? 'text-red-400' :
                            'text-gray-400'
                          }`}>
                            {insight.trend === 'up' ? '↑' : insight.trend === 'down' ? '↓' : '→'}
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-400">{insight.description}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              <div className="glass-card p-6">
                <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-cyan" />
                  AI Recommendations
                </h3>
                <div className="space-y-3">
                  {selectedReport.recommendations.map((recommendation, index) => (
                    <motion.div
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-lg bg-cyan/5 border border-cyan/20"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 + index * 0.1 }}
                    >
                      <div className="w-6 h-6 rounded-full bg-cyan/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-cyan text-sm font-bold">{index + 1}</span>
                      </div>
                      <p className="text-sm text-gray-300">{recommendation}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
