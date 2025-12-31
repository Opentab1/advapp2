/**
 * DataFreshness - Shows how fresh/stale sensor data is
 * 
 * Addresses the "Data Staleness" trust problem:
 * - Shows "Last updated: X ago" 
 * - Color codes: green (fresh), yellow (stale), red (disconnected)
 * - Shows sensor connection status
 * - Alerts when data might be unreliable
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Wifi, 
  WifiOff, 
  Clock, 
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  X,
  Radio
} from 'lucide-react';

// ============ TYPES ============

interface DataFreshnessIndicatorProps {
  lastUpdated: number | null;
  dataAgeSeconds: number;
  sensorStatus: 'connected' | 'delayed' | 'disconnected' | 'unknown';
  isStale: boolean;
  isDisconnected: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  compact?: boolean;
}

interface SensorHealthBannerProps {
  sensorStatus: 'connected' | 'delayed' | 'disconnected' | 'unknown';
  dataAgeSeconds: number;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onDismiss?: () => void;
}

// ============ HELPER FUNCTIONS ============

function formatTimeAgo(seconds: number): string {
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function formatDetailedTimeAgo(seconds: number): string {
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 120) return '1 minute ago';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 7200) return '1 hour ago';
  return `${Math.floor(seconds / 3600)} hours ago`;
}

// ============ MAIN INDICATOR COMPONENT ============

export function DataFreshnessIndicator({
  lastUpdated,
  dataAgeSeconds,
  sensorStatus,
  isStale,
  isDisconnected,
  onRefresh,
  isRefreshing = false,
  compact = false,
}: DataFreshnessIndicatorProps) {
  
  // Determine styling based on status
  const getStatusConfig = () => {
    if (isDisconnected) {
      return {
        bgColor: 'bg-red-100',
        borderColor: 'border-red-200',
        textColor: 'text-red-700',
        iconColor: 'text-red-500',
        icon: WifiOff,
        label: 'Disconnected',
        pulse: true,
      };
    }
    if (isStale) {
      return {
        bgColor: 'bg-amber-100',
        borderColor: 'border-amber-200',
        textColor: 'text-amber-700',
        iconColor: 'text-amber-500',
        icon: AlertTriangle,
        label: 'Delayed',
        pulse: true,
      };
    }
    return {
      bgColor: 'bg-green-100',
      borderColor: 'border-green-200',
      textColor: 'text-green-700',
      iconColor: 'text-green-500',
      icon: Radio,
      label: 'Live',
      pulse: false,
    };
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${config.bgColor} ${config.textColor} border ${config.borderColor}`}>
        <Icon className={`w-3 h-3 ${config.iconColor} ${config.pulse ? 'animate-pulse' : ''}`} />
        <span>{formatTimeAgo(dataAgeSeconds)}</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center justify-between px-3 py-2 rounded-xl ${config.bgColor} border ${config.borderColor}`}
    >
      <div className="flex items-center gap-2">
        <div className={`relative ${config.pulse ? '' : ''}`}>
          <Icon className={`w-4 h-4 ${config.iconColor}`} />
          {config.pulse && (
            <span className={`absolute inset-0 rounded-full ${config.bgColor} animate-ping opacity-75`} />
          )}
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-medium ${config.textColor}`}>
              {config.label}
            </span>
            <span className="text-xs text-warm-400">•</span>
            <span className={`text-xs ${isStale || isDisconnected ? config.textColor : 'text-warm-500'}`}>
              Updated {formatTimeAgo(dataAgeSeconds)}
            </span>
          </div>
        </div>
      </div>

      {onRefresh && (
        <motion.button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={`p-1.5 rounded-lg ${config.bgColor} hover:bg-white/50 transition-colors`}
          whileTap={{ scale: 0.9 }}
        >
          <RefreshCw className={`w-4 h-4 ${config.iconColor} ${isRefreshing ? 'animate-spin' : ''}`} />
        </motion.button>
      )}
    </motion.div>
  );
}

// ============ SENSOR HEALTH BANNER (for critical alerts) ============

export function SensorHealthBanner({
  sensorStatus,
  dataAgeSeconds,
  onRefresh,
  isRefreshing = false,
  onDismiss,
}: SensorHealthBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  // Only show for delayed or disconnected
  if (sensorStatus === 'connected' || sensorStatus === 'unknown' || isDismissed) {
    return null;
  }

  const isDisconnected = sensorStatus === 'disconnected';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`mb-4 p-4 rounded-xl border-2 ${
          isDisconnected 
            ? 'bg-red-50 border-red-200' 
            : 'bg-amber-50 border-amber-200'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${isDisconnected ? 'bg-red-100' : 'bg-amber-100'}`}>
            {isDisconnected ? (
              <WifiOff className="w-5 h-5 text-red-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            )}
          </div>
          
          <div className="flex-1">
            <h4 className={`font-semibold ${isDisconnected ? 'text-red-800' : 'text-amber-800'}`}>
              {isDisconnected ? 'Sensors Disconnected' : 'Data May Be Stale'}
            </h4>
            <p className={`text-sm mt-1 ${isDisconnected ? 'text-red-600' : 'text-amber-600'}`}>
              {isDisconnected 
                ? `No data received for ${formatDetailedTimeAgo(dataAgeSeconds)}. Check your sensor connection.`
                : `Last update was ${formatDetailedTimeAgo(dataAgeSeconds)}. Data may not reflect current conditions.`
              }
            </p>
            
            {onRefresh && (
              <motion.button
                onClick={onRefresh}
                disabled={isRefreshing}
                className={`mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
                  isDisconnected 
                    ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                    : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                } transition-colors`}
                whileTap={{ scale: 0.95 }}
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Reconnecting...' : 'Try Reconnecting'}
              </motion.button>
            )}
          </div>

          {onDismiss && (
            <button
              onClick={() => {
                setIsDismissed(true);
                onDismiss();
              }}
              className={`p-1 rounded-lg ${
                isDisconnected ? 'hover:bg-red-100' : 'hover:bg-amber-100'
              } transition-colors`}
            >
              <X className={`w-4 h-4 ${isDisconnected ? 'text-red-400' : 'text-amber-400'}`} />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============ LIVE INDICATOR DOT (minimal) ============

export function LiveIndicatorDot({ 
  isLive, 
  isStale, 
  isDisconnected 
}: { 
  isLive: boolean; 
  isStale: boolean; 
  isDisconnected: boolean;
}) {
  if (isDisconnected) {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
      </span>
    );
  }
  
  if (isStale) {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
      </span>
    );
  }

  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
    </span>
  );
}

export default DataFreshnessIndicator;
