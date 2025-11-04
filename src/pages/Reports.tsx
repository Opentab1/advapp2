import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Download, Sparkles, TrendingUp, Calendar } from 'lucide-react';
import { format, subDays } from 'date-fns';
import aiReportService from '../services/ai-report.service';
import authService from '../services/auth.service';
import type { WeeklyReport } from '../types';

export function Reports() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<WeeklyReport | null>(null);
  const [generating, setGenerating] = useState(false);

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
      const weekStart = subDays(weekEnd, 7);

      // Get user's venue name for personalized reports
      const user = authService.getStoredUser();
      const venueName = user?.venueName;

      // Mock metrics - in production, fetch from API
      const metrics = {
        avgComfort: 78.5,
        avgTemperature: 71.2,
        avgDecibels: 74.8,
        avgHumidity: 48.3,
        peakHours: ['7-8pm', '8-9pm', '9-10pm'],
        totalCustomers: 1247,
        totalRevenue: 48650.75,
        topSongs: [
          { song: 'Sweet Caroline', plays: 23 },
          { song: 'Don\'t Stop Believin\'', plays: 19 },
          { song: 'Born to Run', plays: 17 }
        ]
      };

      const report = await aiReportService.generateWeeklyReport(weekStart, weekEnd, metrics, venueName);
      await aiReportService.saveReport(report);
      await loadReports();
      setSelectedReport(report);
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold gradient-text">AI Weekly Reports</h2>
          <motion.button
            onClick={generateReport}
            disabled={generating}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
            whileHover={{ scale: generating ? 1 : 1.05 }}
            whileTap={{ scale: generating ? 1 : 0.95 }}
          >
            <Sparkles className="w-4 h-4" />
            {generating ? 'Generating...' : 'Generate New Report'}
          </motion.button>
        </div>

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
              {reports.map((report, index) => (
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
              ))}

              {reports.length === 0 && (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">No reports yet</p>
                </div>
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
                  <h3 className="text-2xl font-bold text-white">
                    Week of {format(new Date(selectedReport.weekStart), 'MMMM d, yyyy')}
                  </h3>
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
                  <div className="text-sm text-gray-400 mb-1">Comfort Score</div>
                  <div className="text-2xl font-bold text-cyan">{selectedReport.metrics.avgComfort.toFixed(1)}</div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Revenue</div>
                  <div className="text-2xl font-bold text-green-400">${selectedReport.metrics.totalRevenue.toLocaleString()}</div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Customers</div>
                  <div className="text-2xl font-bold text-yellow-400">{selectedReport.metrics.totalCustomers.toLocaleString()}</div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-sm text-gray-400 mb-1">Avg Temp</div>
                  <div className="text-2xl font-bold text-orange-400">{selectedReport.metrics.avgTemperature.toFixed(1)}°F</div>
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
