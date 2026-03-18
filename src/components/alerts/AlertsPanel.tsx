/**
 * AlertsPanel - Slide-in notification panel + bell trigger for Header
 *
 * Self-contained: manages its own open/close state.
 * Generates alerts from live store values passed in as props.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, AlertTriangle, AlertCircle, Info, ChevronRight, Settings } from 'lucide-react';
import alertsService, { Alert, AlertSeverity } from '../../services/alerts.service';
import { haptic } from '../../utils/haptics';

// ── Bell button (rendered in Header) ─────────────────────────────────────────

interface AlertsBellProps {
  alerts: Alert[];
  onClick: () => void;
}

export function AlertsBell({ alerts, onClick }: AlertsBellProps) {
  const unread = alerts.filter(a => !a.read).length;

  return (
    <motion.button
      onClick={() => { haptic('selection'); onClick(); }}
      className="relative flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:text-white hover:bg-whoop-panel-secondary transition-colors"
      whileTap={{ scale: 0.95 }}
      aria-label="Notifications"
    >
      <Bell className="w-4 h-4" />
      {unread > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
        >
          {unread > 9 ? '9+' : unread}
        </motion.span>
      )}
    </motion.button>
  );
}

// ── Severity helpers ──────────────────────────────────────────────────────────

function severityIcon(s: AlertSeverity) {
  if (s === 'critical') return <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
  if (s === 'warning')  return <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />;
  return <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />;
}

function severityBorder(s: AlertSeverity) {
  if (s === 'critical') return 'border-red-500/30 bg-red-500/5';
  if (s === 'warning')  return 'border-amber-500/30 bg-amber-500/5';
  return 'border-blue-500/30 bg-blue-500/5';
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface AlertsPanelProps {
  alerts: Alert[];
  isOpen: boolean;
  onClose: () => void;
  onTabChange?: (tab: string) => void;
  onOpenSettings?: () => void;
}

export function AlertsPanel({ alerts, isOpen, onClose, onTabChange, onOpenSettings }: AlertsPanelProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = alerts.filter(a => !dismissed.has(a.id));

  const handleDismiss = (id: string) => {
    alertsService.dismiss(id);
    setDismissed(prev => new Set([...prev, id]));
    haptic('light');
  };

  const handleAction = (alert: Alert) => {
    if (alert.actionTab && onTabChange) {
      onTabChange(alert.actionTab);
    }
    onClose();
    haptic('selection');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-whoop-panel border-l border-whoop-divider z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-whoop-divider">
              <div>
                <h2 className="text-base font-semibold text-white">Alerts</h2>
                <p className="text-xs text-text-muted">
                  {visible.length === 0 ? 'All clear' : `${visible.length} active alert${visible.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {onOpenSettings && (
                  <button
                    onClick={() => { onOpenSettings(); onClose(); haptic('selection'); }}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-white hover:bg-whoop-panel-secondary transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-white hover:bg-whoop-panel-secondary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Alert list */}
            <div className="flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-teal/10 border border-teal/20 flex items-center justify-center mb-4">
                    <Bell className="w-7 h-7 text-teal" />
                  </div>
                  <h3 className="text-white font-semibold mb-1">All clear</h3>
                  <p className="text-sm text-text-muted">No active alerts right now. We'll notify you when something needs attention.</p>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  <AnimatePresence>
                    {visible.map(alert => (
                      <motion.div
                        key={alert.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 40, scale: 0.95 }}
                        className={`rounded-xl border p-4 ${severityBorder(alert.severity)}`}
                      >
                        <div className="flex items-start gap-3">
                          {severityIcon(alert.severity)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white">{alert.title}</p>
                            <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{alert.body}</p>
                            {alert.actionLabel && (
                              <button
                                onClick={() => handleAction(alert)}
                                className="mt-2 flex items-center gap-1 text-xs text-teal font-medium hover:opacity-80"
                              >
                                {alert.actionLabel}
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <button
                            onClick={() => handleDismiss(alert.id)}
                            className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-text-muted hover:text-white rounded transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-whoop-divider">
              <p className="text-xs text-text-muted text-center">
                Configure alert thresholds in{' '}
                <button
                  onClick={() => { onOpenSettings?.(); onClose(); }}
                  className="text-teal underline"
                >
                  Settings → Alerts
                </button>
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default AlertsPanel;
