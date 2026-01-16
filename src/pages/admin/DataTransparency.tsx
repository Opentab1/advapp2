/**
 * DataTransparency - See every number at every step, verify it yourself
 * 
 * Shows:
 * 1. Last 10 raw DynamoDB records (so you can see data is flowing)
 * 2. Last 3 readings for each metric (so you can see it's live)
 * 3. Full calculation breakdown for each reading
 */

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  Database,
  ArrowDown,
  Calculator,
  Monitor,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Clock
} from 'lucide-react';
import { useAdminData } from '../../hooks/useAdminData';
import dynamoDBService from '../../services/dynamodb.service';
import { format } from 'date-fns';

interface MetricReading {
  timestamp: string;
  timeAgo: string;
  rawData: any;
  extractions: { field: string; path: string; value: any }[];
  inputs: { name: string; value: number | string; source: string }[];
  calculation: string;
  result: number | string;
  displayedAs: string;
}

interface MetricTrace {
  name: string;
  description: string;
  formula: string;
  readings: MetricReading[];
}

function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  return format(then, 'h:mm a');
}

export function DataTransparency() {
  const { venues, loading: venuesLoading } = useAdminData();
  const [selectedVenue, setSelectedVenue] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [rawRecords, setRawRecords] = useState<any[]>([]);
  const [traces, setTraces] = useState<MetricTrace[]>([]);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const refreshInterval = useRef<NodeJS.Timeout | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const loadData = async () => {
    if (!selectedVenue) return;
    
    setLoading(true);
    try {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      // Get raw data from DynamoDB - fetch more to have context
      const data = await dynamoDBService.getSensorDataByDateRange(
        selectedVenue, 
        hourAgo, 
        now, 
        100
      );
      
      if (!data || data.length === 0) {
        setRawRecords([]);
        setTraces([]);
        setLastRefresh(new Date());
        return;
      }

      // Sort by timestamp descending (newest first)
      const sorted = [...data].sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      // Store last 10 raw records for display
      setRawRecords(sorted.slice(0, 10));
      
      // Get last 3 for metric calculations
      const last3 = sorted.slice(0, 3);
      
      // Build metric traces with last 3 readings each
      const metricTraces: MetricTrace[] = [];

      // ========== 1. CURRENT OCCUPANCY ==========
      metricTraces.push({
        name: 'Current Occupancy',
        description: 'How many people are in the venue right now',
        formula: 'current = entries - exits',
        readings: last3.map(record => {
          const entries = record.occupancy?.entries;
          const exits = record.occupancy?.exits;
          const current = record.occupancy?.current;
          const calculated = (entries ?? 0) - (exits ?? 0);
          
          return {
            timestamp: record.timestamp,
            timeAgo: formatTimeAgo(record.timestamp),
            rawData: record.occupancy,
            extractions: [
              { field: 'entries', path: 'occupancy.entries', value: entries },
              { field: 'exits', path: 'occupancy.exits', value: exits },
              { field: 'current', path: 'occupancy.current', value: current },
            ],
            inputs: [
              { name: 'entries', value: entries ?? 'null', source: 'occupancy.entries' },
              { name: 'exits', value: exits ?? 'null', source: 'occupancy.exits' },
            ],
            calculation: `${entries ?? '?'} - ${exits ?? '?'} = ${calculated}`,
            result: calculated,
            displayedAs: current !== undefined ? `${current}` : '—',
          };
        }),
      });

      // ========== 2. OCCUPANCY PERCENTAGE ==========
      metricTraces.push({
        name: 'Occupancy %',
        description: 'Current occupancy as percentage of capacity',
        formula: 'percentage = (current / capacity) × 100',
        readings: last3.map(record => {
          const current = record.occupancy?.current ?? 0;
          const capacity = record.occupancy?.capacity ?? 200;
          const percent = capacity > 0 ? Math.round((current / capacity) * 100) : 0;
          
          return {
            timestamp: record.timestamp,
            timeAgo: formatTimeAgo(record.timestamp),
            rawData: { current, capacity },
            extractions: [
              { field: 'current', path: 'occupancy.current', value: current },
              { field: 'capacity', path: 'occupancy.capacity', value: capacity },
            ],
            inputs: [
              { name: 'current', value: current, source: 'occupancy.current' },
              { name: 'capacity', value: capacity, source: 'occupancy.capacity' },
            ],
            calculation: `(${current} / ${capacity}) × 100 = ${percent}`,
            result: percent,
            displayedAs: `${percent}%`,
          };
        }),
      });

      // ========== 3. SOUND LEVEL ==========
      metricTraces.push({
        name: 'Sound Level',
        description: 'Decibel reading from microphone',
        formula: 'First non-null: sound.level → sensors.sound_level → decibels',
        readings: last3.map(record => {
          const v1 = record.sound?.level;
          const v2 = record.sensors?.sound_level;
          const v3 = record.decibels;
          const value = v1 ?? v2 ?? v3;
          
          return {
            timestamp: record.timestamp,
            timeAgo: formatTimeAgo(record.timestamp),
            rawData: { 'sound.level': v1, 'sensors.sound_level': v2, 'decibels': v3 },
            extractions: [
              { field: 'sound.level', path: 'sound.level', value: v1 },
              { field: 'sensors.sound_level', path: 'sensors.sound_level', value: v2 },
              { field: 'decibels', path: 'decibels', value: v3 },
            ],
            inputs: [
              { name: 'sound.level', value: v1 ?? 'null', source: 'sound.level' },
              { name: 'sensors.sound_level', value: v2 ?? 'null', source: 'sensors.sound_level' },
              { name: 'decibels', value: v3 ?? 'null', source: 'decibels' },
            ],
            calculation: `First non-null = ${value ?? 'null'}`,
            result: value ?? 'N/A',
            displayedAs: value !== undefined ? `${Math.round(value)} dB` : '—',
          };
        }),
      });

      // ========== 4. LIGHT LEVEL ==========
      metricTraces.push({
        name: 'Light Level',
        description: 'Lux reading from light sensor',
        formula: 'First non-null: light.lux → sensors.light_level',
        readings: last3.map(record => {
          const v1 = record.light?.lux;
          const v2 = record.sensors?.light_level;
          const value = v1 ?? v2;
          
          return {
            timestamp: record.timestamp,
            timeAgo: formatTimeAgo(record.timestamp),
            rawData: { 'light.lux': v1, 'sensors.light_level': v2 },
            extractions: [
              { field: 'light.lux', path: 'light.lux', value: v1 },
              { field: 'sensors.light_level', path: 'sensors.light_level', value: v2 },
            ],
            inputs: [
              { name: 'light.lux', value: v1 ?? 'null', source: 'light.lux' },
              { name: 'sensors.light_level', value: v2 ?? 'null', source: 'sensors.light_level' },
            ],
            calculation: `First non-null = ${value ?? 'null'}`,
            result: value ?? 'N/A',
            displayedAs: value !== undefined ? `${Math.round(value)} lux` : '—',
          };
        }),
      });

      // ========== 5. CURRENT SONG ==========
      metricTraces.push({
        name: 'Current Song',
        description: 'Currently detected song',
        formula: 'Direct extraction from currentSong + artist',
        readings: last3.map(record => {
          const song = record.currentSong ?? record.spotify?.current_song;
          const artist = record.artist ?? record.spotify?.artist;
          
          return {
            timestamp: record.timestamp,
            timeAgo: formatTimeAgo(record.timestamp),
            rawData: { currentSong: record.currentSong, artist: record.artist },
            extractions: [
              { field: 'currentSong', path: 'currentSong', value: song },
              { field: 'artist', path: 'artist', value: artist },
            ],
            inputs: [
              { name: 'song', value: song ?? 'null', source: 'currentSong' },
              { name: 'artist', value: artist ?? 'null', source: 'artist' },
            ],
            calculation: song ? `"${song}" by ${artist}` : 'No song detected',
            result: song ? `${song} - ${artist}` : 'None',
            displayedAs: song ? `${song}` : '—',
          };
        }),
      });

      // ========== 6. ENTRIES (cumulative) ==========
      metricTraces.push({
        name: 'Total Entries',
        description: 'Cumulative entry count from sensor',
        formula: 'Direct from occupancy.entries (cumulative)',
        readings: last3.map(record => {
          const entries = record.occupancy?.entries;
          
          return {
            timestamp: record.timestamp,
            timeAgo: formatTimeAgo(record.timestamp),
            rawData: { entries },
            extractions: [
              { field: 'entries', path: 'occupancy.entries', value: entries },
            ],
            inputs: [
              { name: 'entries', value: entries ?? 'null', source: 'occupancy.entries' },
            ],
            calculation: `Direct value = ${entries ?? 'null'}`,
            result: entries ?? 'N/A',
            displayedAs: entries !== undefined ? `${entries}` : '—',
          };
        }),
      });

      // ========== 7. EXITS (cumulative) ==========
      metricTraces.push({
        name: 'Total Exits',
        description: 'Cumulative exit count from sensor',
        formula: 'Direct from occupancy.exits (cumulative)',
        readings: last3.map(record => {
          const exits = record.occupancy?.exits;
          
          return {
            timestamp: record.timestamp,
            timeAgo: formatTimeAgo(record.timestamp),
            rawData: { exits },
            extractions: [
              { field: 'exits', path: 'occupancy.exits', value: exits },
            ],
            inputs: [
              { name: 'exits', value: exits ?? 'null', source: 'occupancy.exits' },
            ],
            calculation: `Direct value = ${exits ?? 'null'}`,
            result: exits ?? 'N/A',
            displayedAs: exits !== undefined ? `${exits}` : '—',
          };
        }),
      });

      setTraces(metricTraces);
      setLastRefresh(new Date());
      
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh every 15 seconds when enabled
  useEffect(() => {
    if (autoRefresh && selectedVenue) {
      refreshInterval.current = setInterval(() => {
        loadData();
      }, 15000);
    }
    
    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current);
      }
    };
  }, [autoRefresh, selectedVenue]);

  useEffect(() => {
    if (selectedVenue) {
      loadData();
    }
  }, [selectedVenue]);

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold gradient-text mb-2">🔬 Data Transparency</h1>
          <p className="text-gray-400">
            See every number at every step. Verify the math yourself.
          </p>
        </div>

        {/* Controls */}
        <div className="glass-card p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm text-gray-400 mb-1">Select Venue</label>
              <select
                value={selectedVenue}
                onChange={(e) => setSelectedVenue(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
              >
                <option value="">Choose a venue...</option>
                {venues
                  .filter(v => v.venueId !== 'theshowcaselounge')
                  .map(v => (
                    <option key={v.venueId} value={v.venueId}>
                      {v.venueName || v.venueId}
                    </option>
                  ))
                }
              </select>
            </div>
            
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                />
                Auto-refresh (15s)
              </label>
              
              <button
                onClick={loadData}
                disabled={loading || !selectedVenue}
                className="btn-primary flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          
          {lastRefresh && (
            <div className="mt-3 text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last refreshed: {format(lastRefresh, 'h:mm:ss a')}
            </div>
          )}
        </div>

        {!selectedVenue ? (
          <div className="glass-card p-12 text-center">
            <Database className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">Select a venue to see the data pipeline</p>
          </div>
        ) : loading && rawRecords.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading data...</p>
          </div>
        ) : rawRecords.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <Database className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">No data found for this venue in the last hour</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Raw Data - Last 10 Records */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-400" />
                  <h2 className="text-lg font-bold text-white">Raw DynamoDB Records</h2>
                  <span className="text-sm text-gray-400">(Last 10)</span>
                </div>
                <button
                  onClick={() => copyToClipboard(JSON.stringify(rawRecords, null, 2), 'raw')}
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                >
                  {copiedField === 'raw' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedField === 'raw' ? 'Copied!' : 'Copy All'}
                </button>
              </div>
              
              {/* Scrollable table of records */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th className="pb-2 pr-4">Timestamp</th>
                      <th className="pb-2 pr-4">Entries</th>
                      <th className="pb-2 pr-4">Exits</th>
                      <th className="pb-2 pr-4">Current</th>
                      <th className="pb-2 pr-4">Sound</th>
                      <th className="pb-2 pr-4">Light</th>
                      <th className="pb-2">Song</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {rawRecords.map((record, i) => (
                      <tr key={i} className={`border-b border-gray-800 ${i === 0 ? 'bg-cyan-500/5' : ''}`}>
                        <td className="py-2 pr-4 text-gray-300">
                          {format(new Date(record.timestamp), 'h:mm:ss a')}
                          {i === 0 && <span className="ml-2 text-xs text-cyan-400">(latest)</span>}
                        </td>
                        <td className="py-2 pr-4 text-white">{record.occupancy?.entries ?? '—'}</td>
                        <td className="py-2 pr-4 text-white">{record.occupancy?.exits ?? '—'}</td>
                        <td className="py-2 pr-4 text-white">{record.occupancy?.current ?? '—'}</td>
                        <td className="py-2 pr-4 text-white">
                          {(record.sound?.level ?? record.sensors?.sound_level ?? record.decibels) !== undefined 
                            ? Math.round(record.sound?.level ?? record.sensors?.sound_level ?? record.decibels)
                            : '—'}
                        </td>
                        <td className="py-2 pr-4 text-white">
                          {(record.light?.lux ?? record.sensors?.light_level) !== undefined
                            ? Math.round(record.light?.lux ?? record.sensors?.light_level)
                            : '—'}
                        </td>
                        <td className="py-2 text-white truncate max-w-[150px]">
                          {record.currentSong || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Full JSON expandable */}
              <details className="mt-4">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                  View full JSON (click to expand)
                </summary>
                <pre className="mt-2 text-xs text-gray-300 bg-black/50 p-4 rounded-lg overflow-x-auto max-h-64 overflow-y-auto font-mono">
                  {JSON.stringify(rawRecords, null, 2)}
                </pre>
              </details>
            </div>

            {/* Metric Traces - Each showing last 3 readings */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Calculator className="w-5 h-5 text-cyan-400" />
                Metric Calculations
                <span className="text-sm text-gray-400 font-normal">(Last 3 readings each)</span>
              </h2>
              
              {traces.map((trace) => (
                <div key={trace.name} className="glass-card overflow-hidden">
                  {/* Header */}
                  <button
                    onClick={() => setExpandedTrace(expandedTrace === trace.name ? null : trace.name)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5"
                  >
                    <div className="flex items-center gap-3">
                      <Calculator className="w-5 h-5 text-cyan-400" />
                      <div>
                        <div className="font-medium text-white">{trace.name}</div>
                        <div className="text-sm text-gray-400">{trace.description}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {/* Show last 3 values inline */}
                      <div className="flex items-center gap-2">
                        {trace.readings.map((r, i) => (
                          <div key={i} className={`text-center px-3 py-1 rounded ${i === 0 ? 'bg-cyan-500/20' : 'bg-gray-800'}`}>
                            <div className={`text-xs ${i === 0 ? 'text-cyan-400' : 'text-gray-500'}`}>{r.timeAgo}</div>
                            <div className={`font-mono font-bold ${i === 0 ? 'text-white' : 'text-gray-400'}`}>
                              {r.displayedAs}
                            </div>
                          </div>
                        ))}
                      </div>
                      {expandedTrace === trace.name ? (
                        <ChevronDown className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {expandedTrace === trace.name && (
                    <div className="border-t border-gray-700 p-4">
                      {/* Formula */}
                      <div className="mb-4 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                        <div className="text-xs text-cyan-400 mb-1">FORMULA</div>
                        <code className="text-cyan-300 font-mono">{trace.formula}</code>
                      </div>
                      
                      {/* Readings table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-400 border-b border-gray-700">
                              <th className="pb-2 pr-4">Time</th>
                              <th className="pb-2 pr-4">Raw Values</th>
                              <th className="pb-2 pr-4">Calculation</th>
                              <th className="pb-2 pr-4">Result</th>
                              <th className="pb-2">Displayed</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono">
                            {trace.readings.map((reading, i) => (
                              <tr key={i} className={`border-b border-gray-800 ${i === 0 ? 'bg-cyan-500/5' : ''}`}>
                                <td className="py-3 pr-4">
                                  <div className="text-gray-300">{format(new Date(reading.timestamp), 'h:mm:ss a')}</div>
                                  <div className="text-xs text-gray-500">{reading.timeAgo}</div>
                                </td>
                                <td className="py-3 pr-4">
                                  <div className="space-y-1">
                                    {reading.extractions.map((ext, j) => (
                                      <div key={j} className="text-xs">
                                        <span className="text-gray-500">{ext.path}:</span>
                                        <span className={`ml-1 ${ext.value !== null && ext.value !== undefined ? 'text-green-400' : 'text-red-400'}`}>
                                          {ext.value !== null && ext.value !== undefined ? String(ext.value) : 'null'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-3 pr-4">
                                  <code className="text-orange-300">{reading.calculation}</code>
                                </td>
                                <td className="py-3 pr-4">
                                  <span className="text-white font-bold">{String(reading.result)}</span>
                                </td>
                                <td className="py-3">
                                  <span className={`px-2 py-1 rounded ${i === 0 ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-300'}`}>
                                    {reading.displayedAs}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      {/* Full raw data for this metric */}
                      <details className="mt-4">
                        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                          View raw data for all 3 readings
                        </summary>
                        <pre className="mt-2 text-xs text-gray-300 bg-black/50 p-3 rounded-lg overflow-x-auto font-mono">
                          {JSON.stringify(trace.readings.map(r => ({ timestamp: r.timestamp, data: r.rawData })), null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
