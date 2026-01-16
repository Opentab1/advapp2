/**
 * DataAccuracy - Admin Command Center for Data Health
 * 
 * Features:
 * 1. All-Venues Health Dashboard - See all venues at a glance
 * 2. Active Issues Panel - Auto-detected problems with recommendations
 * 3. Sensor Status Grid - Visual overview of all sensors
 * 4. Data Quality Score - Per-venue scoring
 * 5. Drill-down tools for detailed analysis
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Wifi,
  WifiOff,
  Music,
  Users,
  Volume2,
  Sun,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Zap,
  AlertCircle,
  Shield,
  Eye,
  BarChart3
} from 'lucide-react';
import { useAdminData } from '../../hooks/useAdminData';
import dynamoDBService from '../../services/dynamodb.service';
import { format, formatDistanceToNow } from 'date-fns';

// ============ TYPES ============

interface VenueHealth {
  venueId: string;
  venueName: string;
  status: 'healthy' | 'warning' | 'critical' | 'offline' | 'demo';
  lastDataTime: Date | null;
  lastDataAgo: string;
  dataQualityScore: number;
  issues: Issue[];
  sensors: {
    occupancy: SensorStatus;
    sound: SensorStatus;
    light: SensorStatus;
    song: SensorStatus;
  };
  latestData: {
    occupancy?: number;
    entries?: number;
    exits?: number;
    capacity?: number;
    soundLevel?: number;
    lightLevel?: number;
    currentSong?: string;
  };
}

interface SensorStatus {
  status: 'ok' | 'warning' | 'error' | 'offline' | 'unknown';
  lastValue?: number | string;
  issue?: string;
}

interface Issue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  venueId: string;
  venueName: string;
  title: string;
  description: string;
  recommendation: string;
  timestamp: Date;
}

// ============ HEALTH ANALYSIS ============

async function analyzeVenueHealth(venue: any): Promise<VenueHealth> {
  const venueId = venue.venueId;
  const venueName = venue.venueName || venueId;
  
  // Demo account detection
  if (venueId === 'theshowcaselounge') {
    return {
      venueId,
      venueName,
      status: 'demo',
      lastDataTime: null,
      lastDataAgo: 'Demo Account',
      dataQualityScore: 100,
      issues: [],
      sensors: {
        occupancy: { status: 'ok', lastValue: 'Demo' },
        sound: { status: 'ok', lastValue: 'Demo' },
        light: { status: 'ok', lastValue: 'Demo' },
        song: { status: 'ok', lastValue: 'Demo' },
      },
      latestData: {},
    };
  }

  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const data = await dynamoDBService.getSensorDataByDateRange(venueId, dayAgo, now, 100);
    
    const issues: Issue[] = [];
    let status: VenueHealth['status'] = 'healthy';
    let dataQualityScore = 100;
    
    // No data at all
    if (!data || data.length === 0) {
      return {
        venueId,
        venueName,
        status: 'offline',
        lastDataTime: null,
        lastDataAgo: 'No data',
        dataQualityScore: 0,
        issues: [{
          id: `${venueId}-no-data`,
          severity: 'critical',
          venueId,
          venueName,
          title: 'No data received',
          description: 'This venue has not sent any data in the last 24 hours',
          recommendation: 'Check if the Raspberry Pi is powered on and connected to WiFi',
          timestamp: now,
        }],
        sensors: {
          occupancy: { status: 'offline' },
          sound: { status: 'offline' },
          light: { status: 'offline' },
          song: { status: 'offline' },
        },
        latestData: {},
      };
    }

    // Sort by timestamp descending
    const sorted = [...data].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const latest = sorted[0];
    const lastDataTime = new Date(latest.timestamp);
    const minutesAgo = (now.getTime() - lastDataTime.getTime()) / 60000;

    // Check data freshness
    if (minutesAgo > 60) {
      status = 'critical';
      dataQualityScore -= 40;
      issues.push({
        id: `${venueId}-stale`,
        severity: 'critical',
        venueId,
        venueName,
        title: `No data for ${Math.round(minutesAgo / 60)} hours`,
        description: `Last data received ${formatDistanceToNow(lastDataTime)} ago`,
        recommendation: 'Check device connectivity and power',
        timestamp: now,
      });
    } else if (minutesAgo > 15) {
      if (status === 'healthy') status = 'warning';
      dataQualityScore -= 15;
      issues.push({
        id: `${venueId}-delayed`,
        severity: 'warning',
        venueId,
        venueName,
        title: 'Data delayed',
        description: `Last data received ${Math.round(minutesAgo)} minutes ago`,
        recommendation: 'Monitor - may be temporary network issue',
        timestamp: now,
      });
    }

    // Analyze sensors
    const sensors: VenueHealth['sensors'] = {
      occupancy: { status: 'unknown' },
      sound: { status: 'unknown' },
      light: { status: 'unknown' },
      song: { status: 'unknown' },
    };

    // Occupancy analysis
    const occ = latest.occupancy;
    if (occ) {
      const current = occ.current ?? 0;
      const capacity = occ.capacity ?? 200;
      sensors.occupancy = { status: 'ok', lastValue: current };

      // Check for impossible values
      if (current < 0) {
        sensors.occupancy = { status: 'error', lastValue: current, issue: 'Negative value' };
        dataQualityScore -= 20;
        issues.push({
          id: `${venueId}-occ-negative`,
          severity: 'warning',
          venueId,
          venueName,
          title: 'Negative occupancy detected',
          description: `Current occupancy is ${current}`,
          recommendation: 'Sensor may need recalibration - exits counted without matching entries',
          timestamp: now,
        });
      } else if (current > capacity * 2) {
        sensors.occupancy = { status: 'warning', lastValue: current, issue: 'Over capacity' };
        dataQualityScore -= 10;
        issues.push({
          id: `${venueId}-occ-over`,
          severity: 'warning',
          venueId,
          venueName,
          title: `Occupancy ${Math.round((current / capacity) * 100)}% of capacity`,
          description: `Current: ${current}, Capacity: ${capacity}`,
          recommendation: 'Verify capacity setting or recalibrate sensor',
          timestamp: now,
        });
      }
    } else {
      sensors.occupancy = { status: 'offline' };
    }

    // Sound analysis
    const soundLevel = latest.sound?.level ?? latest.sensors?.sound_level;
    if (soundLevel !== undefined) {
      sensors.sound = { status: 'ok', lastValue: Math.round(soundLevel) };
      
      if (soundLevel < 0) {
        sensors.sound = { status: 'error', lastValue: soundLevel, issue: 'Invalid reading' };
        dataQualityScore -= 15;
        issues.push({
          id: `${venueId}-sound-invalid`,
          severity: 'warning',
          venueId,
          venueName,
          title: 'Invalid sound level',
          description: `Reading: ${soundLevel} dB (should be 0-120)`,
          recommendation: 'Check microphone connection',
          timestamp: now,
        });
      }

      // Check for stuck sensor
      const soundReadings = sorted.slice(0, 20).map(d => d.sound?.level ?? d.sensors?.sound_level).filter(v => v !== undefined);
      const allSame = soundReadings.length > 5 && soundReadings.every(v => v === soundReadings[0]);
      if (allSame) {
        sensors.sound = { status: 'warning', lastValue: soundLevel, issue: 'Stuck value' };
        dataQualityScore -= 10;
        issues.push({
          id: `${venueId}-sound-stuck`,
          severity: 'warning',
          venueId,
          venueName,
          title: 'Sound sensor may be stuck',
          description: `Same value (${soundLevel} dB) for last ${soundReadings.length} readings`,
          recommendation: 'Sensor may need restart or replacement',
          timestamp: now,
        });
      }
    } else {
      sensors.sound = { status: 'offline' };
    }

    // Light analysis
    const lightLevel = latest.light?.lux ?? latest.sensors?.light_level;
    if (lightLevel !== undefined) {
      sensors.light = { status: 'ok', lastValue: Math.round(lightLevel) };
    } else {
      sensors.light = { status: 'offline' };
    }

    // Song detection analysis
    if (latest.currentSong) {
      sensors.song = { status: 'ok', lastValue: latest.currentSong };
    } else {
      // Check if any songs in last 24h
      const songsDetected = sorted.filter(d => d.currentSong).length;
      if (songsDetected > 0) {
        sensors.song = { status: 'ok', lastValue: `${songsDetected} songs today` };
      } else {
        sensors.song = { status: 'warning', issue: 'No songs detected' };
      }
    }

    // Determine overall status
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const warningIssues = issues.filter(i => i.severity === 'warning').length;
    
    if (criticalIssues > 0) status = 'critical';
    else if (warningIssues > 0) status = 'warning';
    else status = 'healthy';

    return {
      venueId,
      venueName,
      status,
      lastDataTime,
      lastDataAgo: formatDistanceToNow(lastDataTime, { addSuffix: true }),
      dataQualityScore: Math.max(0, Math.min(100, dataQualityScore)),
      issues,
      sensors,
      latestData: {
        occupancy: occ?.current,
        entries: occ?.entries,
        exits: occ?.exits,
        capacity: occ?.capacity,
        soundLevel: soundLevel,
        lightLevel: lightLevel,
        currentSong: latest.currentSong,
      },
    };
  } catch (error) {
    console.error(`Error analyzing ${venueId}:`, error);
    return {
      venueId,
      venueName,
      status: 'offline',
      lastDataTime: null,
      lastDataAgo: 'Error',
      dataQualityScore: 0,
      issues: [{
        id: `${venueId}-error`,
        severity: 'critical',
        venueId,
        venueName,
        title: 'Error fetching data',
        description: 'Could not retrieve data for this venue',
        recommendation: 'Check API connectivity',
        timestamp: new Date(),
      }],
      sensors: {
        occupancy: { status: 'unknown' },
        sound: { status: 'unknown' },
        light: { status: 'unknown' },
        song: { status: 'unknown' },
      },
      latestData: {},
    };
  }
}

// ============ COMPONENTS ============

function StatusBadge({ status }: { status: VenueHealth['status'] }) {
  const config = {
    healthy: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Healthy' },
    warning: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Warning' },
    critical: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Critical' },
    offline: { icon: WifiOff, color: 'text-gray-400', bg: 'bg-gray-500/20', label: 'Offline' },
    demo: { icon: Zap, color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Demo' },
  };
  const { icon: Icon, color, bg, label } = config[status];
  
  return (
    <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${bg} ${color}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function SensorIndicator({ status, value }: { status: SensorStatus['status']; value?: string | number }) {
  const colors = {
    ok: 'bg-green-400',
    warning: 'bg-yellow-400',
    error: 'bg-red-400',
    offline: 'bg-gray-600',
    unknown: 'bg-gray-700',
  };
  
  return (
    <div className="flex items-center gap-1">
      <span className={`w-2.5 h-2.5 rounded-full ${colors[status]}`} />
      {value !== undefined && (
        <span className="text-xs text-gray-400 truncate max-w-[60px]">{value}</span>
      )}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
  const strokeColor = score >= 80 ? 'stroke-green-400' : score >= 50 ? 'stroke-yellow-400' : 'stroke-red-400';
  
  return (
    <div className="relative w-12 h-12">
      <svg className="w-full h-full -rotate-90">
        <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-700" />
        <circle 
          cx="24" cy="24" r="20" fill="none" strokeWidth="4" 
          className={strokeColor}
          strokeDasharray={`${score * 1.26} 126`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${color}`}>
        {score}
      </span>
    </div>
  );
}

function VenueHealthRow({ health, onClick }: { health: VenueHealth; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-4 bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-all text-left"
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <ScoreRing score={health.dataQualityScore} />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-white truncate">{health.venueName}</span>
          <StatusBadge status={health.status} />
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {health.lastDataAgo}
          </span>
          {health.issues.length > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
              <AlertTriangle className="w-3 h-3" />
              {health.issues.length} issue{health.issues.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="hidden md:flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <SensorIndicator status={health.sensors.occupancy.status} value={health.latestData.occupancy} />
            <span className="text-[10px] text-gray-500">Occ</span>
          </div>
          <div className="text-center">
            <SensorIndicator status={health.sensors.sound.status} value={health.latestData.soundLevel ? `${health.latestData.soundLevel}dB` : undefined} />
            <span className="text-[10px] text-gray-500">Sound</span>
          </div>
          <div className="text-center">
            <SensorIndicator status={health.sensors.light.status} />
            <span className="text-[10px] text-gray-500">Light</span>
          </div>
          <div className="text-center">
            <SensorIndicator status={health.sensors.song.status} />
            <span className="text-[10px] text-gray-500">Song</span>
          </div>
        </div>
      </div>

      <ChevronRight className="w-5 h-5 text-gray-500" />
    </motion.button>
  );
}

function IssueCard({ issue }: { issue: Issue }) {
  const severityConfig = {
    critical: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
    warning: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
    info: { icon: AlertCircle, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  };
  const config = severityConfig[issue.severity];
  const Icon = config.icon;

  return (
    <div className={`p-4 rounded-lg ${config.bg} border ${config.border}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.color} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`font-medium ${config.color}`}>{issue.title}</span>
            <span className="text-xs text-gray-500">— {issue.venueName}</span>
          </div>
          <p className="text-sm text-gray-400 mb-2">{issue.description}</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">→</span>
            <span className="text-gray-300">{issue.recommendation}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SensorGrid({ healthData }: { healthData: VenueHealth[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-700">
            <th className="pb-3 font-medium">Venue</th>
            <th className="pb-3 font-medium text-center">Occupancy</th>
            <th className="pb-3 font-medium text-center">Sound</th>
            <th className="pb-3 font-medium text-center">Light</th>
            <th className="pb-3 font-medium text-center">Song</th>
            <th className="pb-3 font-medium text-right">Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {healthData.map((health) => (
            <tr key={health.venueId} className="border-b border-gray-800 hover:bg-gray-800/50">
              <td className="py-3">
                <span className="text-white">{health.venueName}</span>
              </td>
              <td className="py-3 text-center">
                <SensorIndicator 
                  status={health.sensors.occupancy.status} 
                  value={health.latestData.occupancy}
                />
              </td>
              <td className="py-3 text-center">
                <SensorIndicator 
                  status={health.sensors.sound.status}
                  value={health.latestData.soundLevel ? `${Math.round(health.latestData.soundLevel)}dB` : undefined}
                />
              </td>
              <td className="py-3 text-center">
                <SensorIndicator 
                  status={health.sensors.light.status}
                  value={health.latestData.lightLevel ? `${Math.round(health.latestData.lightLevel)}` : undefined}
                />
              </td>
              <td className="py-3 text-center">
                <SensorIndicator 
                  status={health.sensors.song.status}
                />
              </td>
              <td className="py-3 text-right text-gray-400 text-xs">
                {health.lastDataAgo}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============ MAIN PAGE ============

export function DataAccuracy() {
  const { venues, loading: venuesLoading } = useAdminData();
  const [healthData, setHealthData] = useState<VenueHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'issues' | 'sensors'>('overview');

  // Analyze all venues
  const analyzeAllVenues = useCallback(async () => {
    if (venues.length === 0) return;
    
    setLoading(true);
    try {
      const results = await Promise.all(
        venues.map(v => analyzeVenueHealth(v))
      );
      
      // Sort: critical first, then warning, then healthy, then demo
      results.sort((a, b) => {
        const order = { critical: 0, warning: 1, offline: 2, healthy: 3, demo: 4 };
        return order[a.status] - order[b.status];
      });
      
      setHealthData(results);
    } catch (error) {
      console.error('Error analyzing venues:', error);
    } finally {
      setLoading(false);
    }
  }, [venues]);

  useEffect(() => {
    if (!venuesLoading && venues.length > 0) {
      analyzeAllVenues();
    }
  }, [venues, venuesLoading, analyzeAllVenues]);

  // Aggregate stats
  const stats = useMemo(() => {
    const healthy = healthData.filter(h => h.status === 'healthy').length;
    const warning = healthData.filter(h => h.status === 'warning').length;
    const critical = healthData.filter(h => h.status === 'critical').length;
    const offline = healthData.filter(h => h.status === 'offline').length;
    const totalIssues = healthData.reduce((sum, h) => sum + h.issues.length, 0);
    const avgScore = healthData.length > 0 
      ? Math.round(healthData.reduce((sum, h) => sum + h.dataQualityScore, 0) / healthData.length)
      : 0;
    
    return { healthy, warning, critical, offline, totalIssues, avgScore };
  }, [healthData]);

  // All issues across venues
  const allIssues = useMemo(() => {
    return healthData
      .flatMap(h => h.issues)
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      });
  }, [healthData]);

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">📊 Data Command Center</h1>
            <p className="text-gray-400">Real-time health monitoring for all venues</p>
          </div>
          <button
            onClick={analyzeAllVenues}
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh All
          </button>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div className="glass-card p-4 text-center">
            <div className="text-3xl font-bold text-green-400">{stats.healthy}</div>
            <div className="text-xs text-gray-400">Healthy</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-3xl font-bold text-yellow-400">{stats.warning}</div>
            <div className="text-xs text-gray-400">Warning</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-3xl font-bold text-red-400">{stats.critical}</div>
            <div className="text-xs text-gray-400">Critical</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-3xl font-bold text-gray-400">{stats.offline}</div>
            <div className="text-xs text-gray-400">Offline</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-3xl font-bold text-orange-400">{stats.totalIssues}</div>
            <div className="text-xs text-gray-400">Issues</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className={`text-3xl font-bold ${stats.avgScore >= 80 ? 'text-green-400' : stats.avgScore >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {stats.avgScore}%
            </div>
            <div className="text-xs text-gray-400">Avg Score</div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          {[
            { id: 'overview', label: 'All Venues', icon: BarChart3 },
            { id: 'issues', label: `Issues (${stats.totalIssues})`, icon: AlertTriangle },
            { id: 'sensors', label: 'Sensor Grid', icon: Activity },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              {loading ? (
                <div className="glass-card p-12 text-center">
                  <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-4" />
                  <p className="text-gray-400">Analyzing {venues.length} venues...</p>
                </div>
              ) : healthData.length === 0 ? (
                <div className="glass-card p-12 text-center">
                  <Shield className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400">No venues found</p>
                </div>
              ) : (
                healthData.map(health => (
                  <VenueHealthRow 
                    key={health.venueId} 
                    health={health}
                    onClick={() => setSelectedVenue(health.venueId)}
                  />
                ))
              )}
            </motion.div>
          )}

          {activeTab === 'issues' && (
            <motion.div
              key="issues"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              {allIssues.length === 0 ? (
                <div className="glass-card p-12 text-center">
                  <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
                  <p className="text-green-400 font-medium">All Systems Operational</p>
                  <p className="text-gray-500 text-sm mt-1">No issues detected across all venues</p>
                </div>
              ) : (
                allIssues.map(issue => (
                  <IssueCard key={issue.id} issue={issue} />
                ))
              )}
            </motion.div>
          )}

          {activeTab === 'sensors' && (
            <motion.div
              key="sensors"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="glass-card p-6"
            >
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-cyan-400" />
                Sensor Status Grid
              </h3>
              {loading ? (
                <div className="text-center py-8">
                  <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
                </div>
              ) : (
                <SensorGrid healthData={healthData} />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selected Venue Detail Modal */}
        <AnimatePresence>
          {selectedVenue && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setSelectedVenue(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-gray-900 rounded-2xl border border-gray-700 p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
              >
                {(() => {
                  const venue = healthData.find(h => h.venueId === selectedVenue);
                  if (!venue) return null;
                  
                  return (
                    <>
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h2 className="text-2xl font-bold text-white">{venue.venueName}</h2>
                          <p className="text-sm text-gray-400">{venue.venueId}</p>
                        </div>
                        <StatusBadge status={venue.status} />
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="p-4 bg-gray-800 rounded-lg">
                          <div className="text-sm text-gray-400 mb-1">Data Quality Score</div>
                          <div className={`text-3xl font-bold ${venue.dataQualityScore >= 80 ? 'text-green-400' : venue.dataQualityScore >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {venue.dataQualityScore}%
                          </div>
                        </div>
                        <div className="p-4 bg-gray-800 rounded-lg">
                          <div className="text-sm text-gray-400 mb-1">Last Data</div>
                          <div className="text-lg font-medium text-white">{venue.lastDataAgo}</div>
                        </div>
                      </div>

                      <div className="mb-6">
                        <h3 className="text-sm font-medium text-gray-400 mb-3">SENSOR STATUS</h3>
                        <div className="grid grid-cols-4 gap-3">
                          {Object.entries(venue.sensors).map(([key, sensor]) => (
                            <div key={key} className="p-3 bg-gray-800 rounded-lg text-center">
                              <SensorIndicator status={sensor.status} />
                              <div className="text-xs text-gray-400 mt-1 capitalize">{key}</div>
                              {sensor.lastValue && (
                                <div className="text-xs text-gray-500 mt-1 truncate">{sensor.lastValue}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {venue.issues.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-sm font-medium text-gray-400 mb-3">ISSUES ({venue.issues.length})</h3>
                          <div className="space-y-2">
                            {venue.issues.map(issue => (
                              <IssueCard key={issue.id} issue={issue} />
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <h3 className="text-sm font-medium text-gray-400 mb-3">LATEST VALUES</h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="flex justify-between p-2 bg-gray-800 rounded">
                            <span className="text-gray-400">Occupancy</span>
                            <span className="text-white">{venue.latestData.occupancy ?? '—'}</span>
                          </div>
                          <div className="flex justify-between p-2 bg-gray-800 rounded">
                            <span className="text-gray-400">Capacity</span>
                            <span className="text-white">{venue.latestData.capacity ?? '—'}</span>
                          </div>
                          <div className="flex justify-between p-2 bg-gray-800 rounded">
                            <span className="text-gray-400">Entries</span>
                            <span className="text-white">{venue.latestData.entries ?? '—'}</span>
                          </div>
                          <div className="flex justify-between p-2 bg-gray-800 rounded">
                            <span className="text-gray-400">Exits</span>
                            <span className="text-white">{venue.latestData.exits ?? '—'}</span>
                          </div>
                          <div className="flex justify-between p-2 bg-gray-800 rounded">
                            <span className="text-gray-400">Sound</span>
                            <span className="text-white">{venue.latestData.soundLevel ? `${Math.round(venue.latestData.soundLevel)} dB` : '—'}</span>
                          </div>
                          <div className="flex justify-between p-2 bg-gray-800 rounded">
                            <span className="text-gray-400">Light</span>
                            <span className="text-white">{venue.latestData.lightLevel ? `${Math.round(venue.latestData.lightLevel)} lux` : '—'}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => setSelectedVenue(null)}
                        className="w-full mt-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-medium transition-colors"
                      >
                        Close
                      </button>
                    </>
                  );
                })()}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
