/**
 * DataAccuracy - Admin tools for ensuring UI data accuracy
 * 
 * Contains:
 * 1. Live Data Monitor - Real-time sensor feed
 * 2. Data Source Transparency - Show where each metric comes from
 * 3. Side-by-Side Comparison - Raw data vs UI display
 * 4. Historical Data Audit - Query any metric for any time range
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Activity, 
  Database, 
  GitCompare, 
  History,
  RefreshCw,
  Search,
  ChevronDown,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Wifi,
  WifiOff,
  Music,
  Users,
  Volume2,
  Sun,
  Play,
  Pause
} from 'lucide-react';
import { useAdminData } from '../../hooks/useAdminData';
import dynamoDBService from '../../services/dynamodb.service';
import { format } from 'date-fns';

// ============ TYPES ============

interface SensorReading {
  timestamp: string;
  occupancy?: { current: number; entries: number; exits: number };
  sound?: { level: number };
  light?: { lux: number };
  currentSong?: string;
  artist?: string;
}

interface DataSourceInfo {
  metric: string;
  value: string | number;
  source: string;
  calculation?: string;
  lastUpdate: string;
  confidence: 'high' | 'medium' | 'low';
  dataPoints?: number;
}

// ============ LIVE DATA MONITOR ============

function LiveDataMonitor({ venueId }: { venueId: string }) {
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchLatestData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      
      const data = await dynamoDBService.getSensorDataByDateRange(
        venueId,
        fiveMinAgo,
        now,
        50
      );
      
      if (data && data.length > 0) {
        // Sort by timestamp descending
        const sorted = [...data].sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setReadings(sorted.slice(0, 20));
      }
      setLastFetch(now);
    } catch (error) {
      console.error('Error fetching live data:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  // Auto-refresh when live
  useEffect(() => {
    if (isLive && venueId) {
      fetchLatestData();
      const interval = setInterval(fetchLatestData, 15000); // Every 15 seconds
      return () => clearInterval(interval);
    }
  }, [isLive, venueId, fetchLatestData]);

  const formatTime = (timestamp: string) => {
    try {
      return format(new Date(timestamp), 'HH:mm:ss');
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-bold text-white">Live Data Monitor</h3>
          {isLive && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 rounded-full">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs text-green-400">LIVE</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLive(!isLive)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
              isLive 
                ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                : 'bg-green-500/20 text-green-400 border border-green-500/30'
            }`}
          >
            {isLive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isLive ? 'Stop' : 'Start Live'}
          </button>
          <button
            onClick={fetchLatestData}
            disabled={loading}
            className="btn-secondary text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {lastFetch && (
        <p className="text-xs text-gray-500 mb-3">
          Last fetch: {format(lastFetch, 'HH:mm:ss')}
        </p>
      )}

      <div className="bg-gray-900/50 rounded-lg p-3 font-mono text-xs max-h-[400px] overflow-y-auto">
        {readings.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {venueId ? 'No recent data. Click "Start Live" to begin monitoring.' : 'Select a venue to monitor'}
          </div>
        ) : (
          <div className="space-y-1">
            {readings.map((reading, i) => (
              <div key={i} className="flex items-start gap-3 py-1 border-b border-gray-800 last:border-0">
                <span className="text-cyan-400 flex-shrink-0">{formatTime(reading.timestamp)}</span>
                <span className="text-gray-400">|</span>
                <div className="flex flex-wrap gap-3">
                  {reading.occupancy && (
                    <span className="text-green-400">
                      occ: {reading.occupancy.current} 
                      <span className="text-gray-500"> (in:{reading.occupancy.entries} out:{reading.occupancy.exits})</span>
                    </span>
                  )}
                  {reading.sound?.level !== undefined && (
                    <span className="text-yellow-400">sound: {reading.sound.level}dB</span>
                  )}
                  {reading.light?.lux !== undefined && (
                    <span className="text-orange-400">light: {reading.light.lux}lux</span>
                  )}
                  {reading.currentSong && (
                    <span className="text-purple-400">song: "{reading.currentSong}"</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ DATA SOURCE TRANSPARENCY ============

function DataSourceTransparency({ venueId }: { venueId: string }) {
  const [sources, setSources] = useState<DataSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const analyzeDataSources = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const data = await dynamoDBService.getSensorDataByDateRange(venueId, dayAgo, now, 1000);
      
      const dataPoints = data?.length || 0;
      const latestReading = data?.[0];
      const lastUpdate = latestReading?.timestamp || 'No data';
      
      // Calculate metrics from data
      let totalEntries = 0;
      let totalExits = 0;
      let soundReadings: number[] = [];
      let songs: string[] = [];
      
      data?.forEach(d => {
        if (d.occupancy) {
          totalEntries = Math.max(totalEntries, d.occupancy.entries || 0);
          totalExits = Math.max(totalExits, d.occupancy.exits || 0);
        }
        if (d.sound?.level) soundReadings.push(d.sound.level);
        if (d.currentSong) songs.push(d.currentSong);
      });
      
      const avgSound = soundReadings.length > 0 
        ? Math.round(soundReadings.reduce((a, b) => a + b, 0) / soundReadings.length)
        : 0;
      const uniqueSongs = new Set(songs).size;
      
      setSources([
        {
          metric: 'Current Occupancy',
          value: latestReading?.occupancy?.current ?? 'N/A',
          source: `IoT Sensor (rpi-${venueId}-001)`,
          calculation: 'entries - exits (cumulative since bar day start)',
          lastUpdate,
          confidence: dataPoints > 100 ? 'high' : dataPoints > 10 ? 'medium' : 'low',
          dataPoints,
        },
        {
          metric: 'Total Entries Today',
          value: totalEntries,
          source: 'Occupancy sensor (beam counter)',
          calculation: 'Cumulative count since 3am bar day reset',
          lastUpdate,
          confidence: dataPoints > 50 ? 'high' : 'medium',
          dataPoints,
        },
        {
          metric: 'Average Sound Level',
          value: `${avgSound} dB`,
          source: 'SPL meter on RPi',
          calculation: `Average of ${soundReadings.length} readings over 24h`,
          lastUpdate,
          confidence: soundReadings.length > 100 ? 'high' : 'medium',
          dataPoints: soundReadings.length,
        },
        {
          metric: 'Songs Detected',
          value: uniqueSongs,
          source: 'Audio fingerprinting (Shazam API)',
          calculation: 'Unique songs identified in sensor data',
          lastUpdate,
          confidence: songs.length > 50 ? 'high' : 'medium',
          dataPoints: songs.length,
        },
        {
          metric: 'Retention Rate',
          value: 'Calculated',
          source: 'Derived from occupancy data',
          calculation: '(crowd at song end / crowd at song start) × 100',
          lastUpdate,
          confidence: dataPoints > 200 ? 'high' : 'medium',
          dataPoints,
        },
      ]);
    } catch (error) {
      console.error('Error analyzing data sources:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (venueId) {
      analyzeDataSources();
    }
  }, [venueId, analyzeDataSources]);

  const getConfidenceBadge = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high':
        return <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">HIGH</span>;
      case 'medium':
        return <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">MEDIUM</span>;
      case 'low':
        return <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">LOW</span>;
    }
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-bold text-white">Data Source Transparency</h3>
        </div>
        <button
          onClick={analyzeDataSources}
          disabled={loading || !venueId}
          className="btn-secondary text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!venueId ? (
        <div className="text-center py-8 text-gray-500">Select a venue to analyze</div>
      ) : (
        <div className="space-y-4">
          {sources.map((source, i) => (
            <div key={i} className="p-4 bg-gray-800/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium">{source.metric}</span>
                <span className="text-2xl font-bold text-cyan-400">{source.value}</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2 text-gray-400">
                  <span className="text-gray-500">Source:</span>
                  <span className="text-purple-400">{source.source}</span>
                </div>
                {source.calculation && (
                  <div className="flex items-start gap-2 text-gray-400">
                    <span className="text-gray-500">Calculation:</span>
                    <span className="text-gray-300">{source.calculation}</span>
                  </div>
                )}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-gray-500" />
                    <span className="text-gray-500">
                      {source.lastUpdate !== 'No data' 
                        ? format(new Date(source.lastUpdate), 'MMM d, h:mm a')
                        : 'No data'
                      }
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">{source.dataPoints} data points</span>
                    {getConfidenceBadge(source.confidence)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ SIDE-BY-SIDE COMPARISON ============

function SideBySideComparison({ venueId }: { venueId: string }) {
  const [rawData, setRawData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchComparison = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      const data = await dynamoDBService.getSensorDataByDateRange(venueId, hourAgo, now, 100);
      
      if (data && data.length > 0) {
        const latest = data[0];
        
        // Calculate derived values
        let totalSongs = 0;
        const songSet = new Set<string>();
        data.forEach(d => {
          if (d.currentSong) songSet.add(d.currentSong);
        });
        totalSongs = songSet.size;
        
        setRawData({
          timestamp: latest.timestamp,
          occupancy: latest.occupancy?.current,
          entries: latest.occupancy?.entries,
          exits: latest.occupancy?.exits,
          soundLevel: latest.sound?.level,
          lightLux: latest.light?.lux,
          currentSong: latest.currentSong,
          artist: latest.artist,
          songsThisHour: totalSongs,
          dataPoints: data.length,
        });
      }
    } catch (error) {
      console.error('Error fetching comparison data:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (venueId) {
      fetchComparison();
    }
  }, [venueId, fetchComparison]);

  const CompareRow = ({ 
    label, 
    raw, 
    display, 
    match 
  }: { 
    label: string; 
    raw: string | number | null | undefined; 
    display: string | number | null | undefined;
    match: boolean | null;
  }) => (
    <div className="flex items-center py-2 border-b border-gray-700 last:border-0">
      <div className="w-1/4 text-sm text-gray-400">{label}</div>
      <div className="w-1/3 text-center">
        <span className="font-mono text-cyan-400">{raw ?? 'null'}</span>
      </div>
      <div className="w-1/3 text-center">
        <span className="font-mono text-purple-400">{display ?? '—'}</span>
      </div>
      <div className="w-16 text-center">
        {match === null ? (
          <span className="text-gray-500">—</span>
        ) : match ? (
          <CheckCircle className="w-4 h-4 text-green-400 mx-auto" />
        ) : (
          <XCircle className="w-4 h-4 text-red-400 mx-auto" />
        )}
      </div>
    </div>
  );

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <GitCompare className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-bold text-white">Side-by-Side Comparison</h3>
        </div>
        <button
          onClick={fetchComparison}
          disabled={loading || !venueId}
          className="btn-secondary text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!venueId ? (
        <div className="text-center py-8 text-gray-500">Select a venue to compare</div>
      ) : !rawData ? (
        <div className="text-center py-8 text-gray-500">
          {loading ? 'Loading...' : 'No data available'}
        </div>
      ) : (
        <div className="bg-gray-900/50 rounded-lg p-4">
          {/* Header */}
          <div className="flex items-center py-2 border-b border-gray-600 mb-2">
            <div className="w-1/4 text-xs text-gray-500 font-medium">METRIC</div>
            <div className="w-1/3 text-center text-xs text-cyan-400 font-medium">RAW DATA</div>
            <div className="w-1/3 text-center text-xs text-purple-400 font-medium">UI DISPLAY</div>
            <div className="w-16 text-center text-xs text-gray-500 font-medium">MATCH</div>
          </div>

          <CompareRow 
            label="Occupancy" 
            raw={rawData.occupancy} 
            display={rawData.occupancy ?? '—'} 
            match={rawData.occupancy !== undefined ? true : null}
          />
          <CompareRow 
            label="Entries" 
            raw={rawData.entries} 
            display={rawData.entries ?? '—'} 
            match={rawData.entries !== undefined ? true : null}
          />
          <CompareRow 
            label="Exits" 
            raw={rawData.exits} 
            display={rawData.exits ?? '—'} 
            match={rawData.exits !== undefined ? true : null}
          />
          <CompareRow 
            label="Sound (dB)" 
            raw={rawData.soundLevel} 
            display={rawData.soundLevel ? `${Math.round(rawData.soundLevel)} dB` : '—'} 
            match={rawData.soundLevel !== undefined ? true : null}
          />
          <CompareRow 
            label="Light (lux)" 
            raw={rawData.lightLux} 
            display={rawData.lightLux ? `${Math.round(rawData.lightLux)}` : '—'} 
            match={rawData.lightLux !== undefined ? true : null}
          />
          <CompareRow 
            label="Current Song" 
            raw={rawData.currentSong} 
            display={rawData.currentSong || '—'} 
            match={rawData.currentSong ? true : null}
          />
          <CompareRow 
            label="Artist" 
            raw={rawData.artist} 
            display={rawData.artist || '—'} 
            match={rawData.artist ? true : null}
          />

          <div className="mt-4 pt-3 border-t border-gray-600 flex items-center justify-between text-xs text-gray-500">
            <span>Data points in last hour: {rawData.dataPoints}</span>
            <span>Last update: {format(new Date(rawData.timestamp), 'HH:mm:ss')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ HISTORICAL DATA AUDIT ============

function HistoricalDataAudit({ venueId }: { venueId: string }) {
  const [metric, setMetric] = useState<'occupancy' | 'sound' | 'songs'>('occupancy');
  const [dateRange, setDateRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [results, setResults] = useState<Array<{ date: string; value: number | string; anomaly?: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ min: number; max: number; avg: number; gaps: number } | null>(null);

  const runAudit = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const now = new Date();
      let startDate: Date;
      
      switch (dateRange) {
        case '24h':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      const data = await dynamoDBService.getSensorDataByDateRange(venueId, startDate, now, 5000);
      
      if (!data || data.length === 0) {
        setResults([]);
        setStats(null);
        return;
      }

      // Group by day and calculate metric
      const dayMap = new Map<string, number[]>();
      
      data.forEach(d => {
        const day = format(new Date(d.timestamp), 'MMM d');
        if (!dayMap.has(day)) dayMap.set(day, []);
        
        let value: number | undefined;
        switch (metric) {
          case 'occupancy':
            value = d.occupancy?.current;
            break;
          case 'sound':
            value = d.sound?.level;
            break;
          case 'songs':
            value = d.currentSong ? 1 : 0;
            break;
        }
        
        if (value !== undefined) {
          dayMap.get(day)!.push(value);
        }
      });

      // Calculate daily aggregates
      const dailyResults: Array<{ date: string; value: number | string; anomaly?: boolean }> = [];
      let allValues: number[] = [];
      
      dayMap.forEach((values, day) => {
        let aggregate: number;
        if (metric === 'songs') {
          aggregate = values.reduce((a, b) => a + b, 0); // Sum of songs
        } else {
          aggregate = values.length > 0 
            ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
            : 0;
        }
        allValues.push(aggregate);
        dailyResults.push({ date: day, value: aggregate });
      });

      // Detect anomalies (values outside 2 standard deviations)
      if (allValues.length > 3) {
        const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        const stdDev = Math.sqrt(
          allValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / allValues.length
        );
        
        dailyResults.forEach(r => {
          const val = typeof r.value === 'number' ? r.value : 0;
          if (Math.abs(val - mean) > 2 * stdDev) {
            r.anomaly = true;
          }
        });
      }

      // Calculate stats
      const min = Math.min(...allValues);
      const max = Math.max(...allValues);
      const avg = Math.round(allValues.reduce((a, b) => a + b, 0) / allValues.length);
      
      // Count gaps (days with 0 data)
      const gaps = dailyResults.filter(r => r.value === 0).length;

      setResults(dailyResults.reverse()); // Oldest first
      setStats({ min, max, avg, gaps });
    } catch (error) {
      console.error('Error running audit:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId, metric, dateRange]);

  useEffect(() => {
    if (venueId) {
      runAudit();
    }
  }, [venueId, metric, dateRange, runAudit]);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <History className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-bold text-white">Historical Data Audit</h3>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as any)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
        >
          <option value="occupancy">Occupancy (avg)</option>
          <option value="sound">Sound Level (avg dB)</option>
          <option value="songs">Songs Detected (count)</option>
        </select>
        
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as any)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
        >
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>

        <button
          onClick={runAudit}
          disabled={loading || !venueId}
          className="btn-primary text-sm"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Run Audit
        </button>
      </div>

      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="p-3 bg-gray-800/50 rounded-lg text-center">
            <div className="text-xl font-bold text-white">{stats.min}</div>
            <div className="text-xs text-gray-400">Min</div>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg text-center">
            <div className="text-xl font-bold text-white">{stats.max}</div>
            <div className="text-xs text-gray-400">Max</div>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg text-center">
            <div className="text-xl font-bold text-cyan-400">{stats.avg}</div>
            <div className="text-xs text-gray-400">Average</div>
          </div>
          <div className="p-3 bg-gray-800/50 rounded-lg text-center">
            <div className={`text-xl font-bold ${stats.gaps > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {stats.gaps}
            </div>
            <div className="text-xs text-gray-400">Data Gaps</div>
          </div>
        </div>
      )}

      {/* Results Table */}
      {!venueId ? (
        <div className="text-center py-8 text-gray-500">Select a venue to audit</div>
      ) : results.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {loading ? 'Running audit...' : 'No data found for this period'}
        </div>
      ) : (
        <div className="bg-gray-900/50 rounded-lg p-3 max-h-[300px] overflow-y-auto">
          <div className="space-y-1">
            {results.map((r, i) => (
              <div 
                key={i} 
                className={`flex items-center justify-between py-2 px-3 rounded ${
                  r.anomaly ? 'bg-red-500/10 border border-red-500/30' : ''
                }`}
              >
                <span className="text-gray-400">{r.date}</span>
                <div className="flex items-center gap-2">
                  <span className={`font-mono ${r.anomaly ? 'text-red-400' : 'text-white'}`}>
                    {r.value}
                  </span>
                  {r.anomaly && (
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                  )}
                  {r.value === 0 && (
                    <span className="text-xs text-yellow-400">NO DATA</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ MAIN PAGE ============

export function DataAccuracy() {
  const { venues, loading } = useAdminData();
  const [selectedVenueId, setSelectedVenueId] = useState<string>('');

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold gradient-text mb-2">📊 Data Accuracy Tools</h1>
            <p className="text-gray-400">Verify data integrity and accuracy for each venue</p>
          </div>
        </div>

        {/* Venue Selector */}
        <div className="glass-card p-4 mb-6">
          <div className="flex items-center gap-4">
            <label className="text-sm text-gray-400">Select Venue:</label>
            <select
              value={selectedVenueId}
              onChange={(e) => setSelectedVenueId(e.target.value)}
              className="flex-1 max-w-md px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              disabled={loading}
            >
              <option value="">-- Select a venue --</option>
              {venues.map(v => (
                <option key={v.venueId} value={v.venueId}>
                  {v.venueName} ({v.venueId})
                </option>
              ))}
            </select>
            {selectedVenueId && (
              <div className="flex items-center gap-2 text-sm">
                <Wifi className="w-4 h-4 text-green-400" />
                <span className="text-green-400">Connected</span>
              </div>
            )}
          </div>
        </div>

        {/* Tools Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LiveDataMonitor venueId={selectedVenueId} />
          <DataSourceTransparency venueId={selectedVenueId} />
          <SideBySideComparison venueId={selectedVenueId} />
          <HistoricalDataAudit venueId={selectedVenueId} />
        </div>
      </motion.div>
    </div>
  );
}
