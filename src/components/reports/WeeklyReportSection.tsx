/**
 * WeeklyReportSection - Generate, preview, and download the weekly shift report
 *
 * Uses the existing emailReportService to pull real sensor data.
 * Allows scheduling preferences and one-click PDF download via browser print.
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Download, Mail, RefreshCw, TrendingUp, TrendingDown,
  Clock, Users, Music, ChevronDown, Check, Send
} from 'lucide-react';
import emailReportService from '../../services/email-report.service';
import authService from '../../services/auth.service';
import { haptic } from '../../utils/haptics';
import {
  loadVenueSetting, saveVenueSetting, peekVenueSetting,
} from '../../services/venueSettings.service';

type SendDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

interface ReportSchedule {
  enabled: boolean;
  day: SendDay;
  email: string;
}

function initialSchedule(): ReportSchedule {
  const user = authService.getStoredUser();
  const fallback: ReportSchedule = {
    enabled: false, day: 'monday', email: user?.email || '',
  };
  if (!user?.venueId) return fallback;
  // Synchronous cache peek for first render; server value arrives via useEffect.
  return peekVenueSetting<ReportSchedule>('reportSchedule', fallback, user.venueId);
}

const DAYS: SendDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function WeeklyReportSection() {
  const user = authService.getStoredUser();
  const venueName = user?.venueName || 'Venue';

  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [schedule, setSchedule] = useState<ReportSchedule>(initialSchedule);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  // Hydrate schedule from DynamoDB on mount so a fresh device sees the
  // latest value the owner last saved anywhere.
  useEffect(() => {
    if (!user?.venueId) return;
    loadVenueSetting<ReportSchedule>(
      'reportSchedule',
      schedule,
      user.venueId,
    ).then(s => setSchedule(s)).catch(() => { /* keep initialSchedule */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.venueId]);

  const fetchReport = useCallback(async () => {
    if (!user?.venueId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await emailReportService.generateWeeklyReport(user.venueId, venueName);
      setReportData(data);
    } catch (e: any) {
      setError('Could not generate report. Make sure you have sensor data from the past week.');
    } finally {
      setLoading(false);
    }
  }, [user?.venueId, venueName]);

  const handleOpen = () => {
    setExpanded(e => !e);
    if (!reportData && !loading) fetchReport();
  };

  const handleSaveSchedule = async () => {
    if (!user?.venueId) return;
    try {
      await saveVenueSetting('reportSchedule', schedule, user.venueId);
      haptic('success');
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 3000);
    } catch {
      // Write-through cache already holds the value so a later retry (or
      // reload on any device) will push it up.
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 3000);
    }
  };

  const handleDownload = () => {
    if (!reportData) return;
    haptic('medium');
    // Open print dialog — browser can save as PDF
    const html = emailReportService.generateEmailHTML(reportData, window.location.origin);
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      w.print();
    }
  };

  const handleSendNow = () => {
    if (!reportData) return;
    haptic('medium');
    const d = reportData;
    const subject = encodeURIComponent(`Weekly Report — ${venueName}`);
    const lines = [
      `Weekly Performance Report — ${venueName}`,
      '',
      `Avg Guest Stay: ${d.highlights?.avgStayMinutes != null ? `${d.highlights.avgStayMinutes} min` : '—'}`,
      `Total Guests: ${d.highlights?.totalGuests?.toLocaleString() ?? '—'}`,
      `Pulse Score: ${d.weeklyAvgScore ?? '—'}`,
      `Top Genre: ${d.music?.topGenre ?? '—'}`,
    ];
    if (d.insights?.length > 0) {
      lines.push('', 'Key Insights:');
      d.insights.slice(0, 3).forEach((i: string) => lines.push(`• ${i}`));
    }
    const body = encodeURIComponent(lines.join('\n'));
    const to = encodeURIComponent(schedule.email || user?.email || '');
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
  };

  const d = reportData;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden"
    >
      {/* Header toggle */}
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between p-5 hover:bg-whoop-panel-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-teal" />
          <div className="text-left">
            <h3 className="text-base font-semibold text-white">Weekly Report</h3>
            <p className="text-xs text-text-muted">Download or schedule your shift summary</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {d && (
            <span className="text-xs text-teal bg-teal/10 px-2 py-0.5 rounded-full border border-teal/20">
              Ready
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-whoop-divider space-y-4 pt-4">

              {loading && (
                <div className="flex items-center justify-center py-8 gap-3 text-text-muted">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Generating report…</span>
                </div>
              )}

              {error && !loading && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                  {error}
                </div>
              )}

              {d && !loading && (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        label: 'Avg Guest Stay',
                        value: d.highlights?.avgStayMinutes != null ? `${d.highlights.avgStayMinutes}m` : '—',
                        delta: d.highlights?.avgStayDelta,
                        icon: Clock,
                      },
                      {
                        label: 'Total Guests',
                        value: d.highlights?.totalGuests?.toLocaleString() ?? '—',
                        delta: d.highlights?.guestsDelta,
                        icon: Users,
                      },
                      {
                        label: 'Pulse Score',
                        value: d.weeklyAvgScore != null ? `${d.weeklyAvgScore}` : '—',
                        delta: d.weeklyScoreDelta,
                        icon: TrendingUp,
                      },
                      {
                        label: 'Top Genre',
                        value: d.music?.topGenre ?? '—',
                        delta: null,
                        icon: Music,
                      },
                    ].map(({ label, value, delta, icon: Icon }) => (
                      <div key={label} className="bg-whoop-panel-secondary rounded-xl p-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Icon className="w-3.5 h-3.5 text-text-muted" />
                          <span className="text-[10px] text-text-muted uppercase tracking-wider">{label}</span>
                        </div>
                        <div className="flex items-end gap-1.5">
                          <span className="text-lg font-bold text-white tabular-nums">{value}</span>
                          {delta != null && delta !== 0 && (
                            <span className={`text-xs font-medium mb-0.5 flex items-center gap-0.5 ${delta > 0 ? 'text-teal' : 'text-red-400'}`}>
                              {delta > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {delta > 0 ? '+' : ''}{delta}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Insights */}
                  {d.insights?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Key Insights</p>
                      {d.insights.slice(0, 3).map((insight: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                          <div className="w-1.5 h-1.5 rounded-full bg-teal mt-1.5 flex-shrink-0" />
                          {insight}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3 pt-1">
                    <motion.button
                      onClick={handleDownload}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal text-black text-sm font-semibold"
                      whileTap={{ scale: 0.97 }}
                    >
                      <Download className="w-4 h-4" />
                      Download PDF
                    </motion.button>
                    <motion.button
                      onClick={handleSendNow}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal/20 border border-teal/30 text-teal text-sm font-semibold hover:bg-teal/30 transition-colors"
                      whileTap={{ scale: 0.97 }}
                      title="Send via email client"
                    >
                      <Send className="w-4 h-4" />
                      Send Now
                    </motion.button>
                    <motion.button
                      onClick={() => { setShowSchedule(s => !s); haptic('selection'); }}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-whoop-panel-secondary border border-whoop-divider text-white text-sm"
                      whileTap={{ scale: 0.97 }}
                    >
                      <Mail className="w-4 h-4" />
                      Schedule
                    </motion.button>
                    <motion.button
                      onClick={() => { setReportData(null); fetchReport(); }}
                      className="w-10 flex items-center justify-center rounded-xl bg-whoop-panel-secondary border border-whoop-divider text-text-muted hover:text-white"
                      whileTap={{ scale: 0.97 }}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </motion.button>
                  </div>
                </>
              )}

              {!d && !loading && !error && (
                <div className="text-center py-4">
                  <motion.button
                    onClick={fetchReport}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal text-black text-sm font-semibold mx-auto"
                    whileTap={{ scale: 0.97 }}
                  >
                    <FileText className="w-4 h-4" />
                    Generate Report
                  </motion.button>
                </div>
              )}

              {/* Schedule panel */}
              <AnimatePresence>
                {showSchedule && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border border-whoop-divider rounded-xl p-4 space-y-4">
                      <h4 className="text-sm font-semibold text-white">Schedule Weekly Email</h4>

                      <label className="flex items-center justify-between">
                        <span className="text-sm text-text-secondary">Enable weekly report</span>
                        <button
                          onClick={() => setSchedule(s => ({ ...s, enabled: !s.enabled }))}
                          className={`w-10 h-5 rounded-full relative transition-colors ${schedule.enabled ? 'bg-teal' : 'bg-whoop-panel-secondary border border-whoop-divider'}`}
                        >
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${schedule.enabled ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </label>

                      {schedule.enabled && (
                        <>
                          <div>
                            <label className="text-xs text-text-muted mb-1.5 block">Send every</label>
                            <div className="flex flex-wrap gap-1.5">
                              {DAYS.map(day => (
                                <button
                                  key={day}
                                  onClick={() => setSchedule(s => ({ ...s, day }))}
                                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${
                                    schedule.day === day
                                      ? 'bg-teal/20 text-teal border border-teal/40'
                                      : 'bg-whoop-panel-secondary text-text-muted border border-whoop-divider'
                                  }`}
                                >
                                  {day.slice(0, 3)}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="text-xs text-text-muted mb-1.5 block">Send to</label>
                            <input
                              type="email"
                              value={schedule.email}
                              onChange={e => setSchedule(s => ({ ...s, email: e.target.value }))}
                              placeholder="you@example.com"
                              className="w-full bg-whoop-panel-secondary border border-whoop-divider rounded-lg px-3 py-2 text-sm text-white placeholder:text-text-muted focus:border-teal focus:outline-none"
                            />
                          </div>
                        </>
                      )}

                      <motion.button
                        onClick={handleSaveSchedule}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-whoop-panel-secondary border border-whoop-divider text-sm font-medium text-white hover:border-teal/40 transition-colors"
                        whileTap={{ scale: 0.97 }}
                      >
                        {scheduleSaved ? (
                          <><Check className="w-4 h-4 text-teal" /> Saved</>
                        ) : (
                          <><Send className="w-4 h-4" /> Save Schedule</>
                        )}
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default WeeklyReportSection;
