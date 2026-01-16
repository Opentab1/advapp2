/**
 * DataTransparency - See every number, every step, verify it yourself
 * 
 * This is NOT automated validation. This is a transparent view where you can:
 * 1. See the raw DynamoDB data (actual JSON)
 * 2. See what we extract from it
 * 3. See the formula we use
 * 4. See the actual inputs plugged in
 * 5. See the calculated result
 * 6. See what the customer sees
 * 
 * You can pull out a calculator and verify every step yourself.
 */

import { useState, useEffect } from 'react';
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
  Check
} from 'lucide-react';
import { useAdminData } from '../../hooks/useAdminData';
import dynamoDBService from '../../services/dynamodb.service';
import { format } from 'date-fns';

interface MetricTrace {
  name: string;
  description: string;
  rawData: any;
  extractions: { field: string; path: string; value: any }[];
  formula: string;
  inputs: { name: string; value: number | string; source: string }[];
  calculation: string;
  result: number | string;
  displayedAs: string;
  customerSees: string;
}

export function DataTransparency() {
  const { venues, loading: venuesLoading } = useAdminData();
  const [selectedVenue, setSelectedVenue] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<any>(null);
  const [traces, setTraces] = useState<MetricTrace[]>([]);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

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
      const dayStart = new Date(now);
      dayStart.setHours(3, 0, 0, 0); // Bar day starts at 3 AM
      if (now < dayStart) {
        dayStart.setDate(dayStart.getDate() - 1);
      }
      
      // Get raw data from DynamoDB
      const data = await dynamoDBService.getSensorDataByDateRange(
        selectedVenue, 
        dayStart, 
        now, 
        500
      );
      
      if (!data || data.length === 0) {
        setRawData(null);
        setTraces([]);
        return;
      }

      // Sort by timestamp descending
      const sorted = [...data].sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      const latest = sorted[0];
      const todayData = sorted;
      
      // Store raw data for display
      setRawData(latest);
      
      // Build metric traces
      const metricTraces: MetricTrace[] = [];

      // ========== 1. CURRENT OCCUPANCY ==========
      const occCurrent = latest.occupancy?.current;
      const occEntries = latest.occupancy?.entries;
      const occExits = latest.occupancy?.exits;
      const occCapacity = latest.occupancy?.capacity;
      
      metricTraces.push({
        name: 'Current Occupancy',
        description: 'How many people are in the venue right now',
        rawData: latest.occupancy,
        extractions: [
          { field: 'current', path: 'occupancy.current', value: occCurrent },
          { field: 'entries', path: 'occupancy.entries', value: occEntries },
          { field: 'exits', path: 'occupancy.exits', value: occExits },
          { field: 'capacity', path: 'occupancy.capacity', value: occCapacity },
        ],
        formula: 'current = entries - exits',
        inputs: [
          { name: 'entries', value: occEntries ?? 'null', source: 'occupancy.entries' },
          { name: 'exits', value: occExits ?? 'null', source: 'occupancy.exits' },
        ],
        calculation: `${occEntries ?? '?'} - ${occExits ?? '?'} = ${(occEntries ?? 0) - (occExits ?? 0)}`,
        result: (occEntries ?? 0) - (occExits ?? 0),
        displayedAs: String(occCurrent ?? 'null'),
        customerSees: occCurrent !== undefined && occCurrent !== null ? `${occCurrent} people` : '—',
      });

      // ========== 2. OCCUPANCY PERCENTAGE ==========
      const occPercent = occCapacity && occCapacity > 0 
        ? Math.round((occCurrent ?? 0) / occCapacity * 100) 
        : null;
      
      metricTraces.push({
        name: 'Occupancy Percentage',
        description: 'Current occupancy as % of capacity',
        rawData: { current: occCurrent, capacity: occCapacity },
        extractions: [
          { field: 'current', path: 'occupancy.current', value: occCurrent },
          { field: 'capacity', path: 'occupancy.capacity', value: occCapacity },
        ],
        formula: 'percentage = (current / capacity) × 100',
        inputs: [
          { name: 'current', value: occCurrent ?? 'null', source: 'occupancy.current' },
          { name: 'capacity', value: occCapacity ?? 'null', source: 'occupancy.capacity' },
        ],
        calculation: `(${occCurrent ?? '?'} / ${occCapacity ?? '?'}) × 100 = ${occPercent ?? '?'}`,
        result: occPercent ?? 'N/A',
        displayedAs: occPercent !== null ? `${occPercent}%` : 'N/A',
        customerSees: occPercent !== null ? `${occPercent}%` : '—',
      });

      // ========== 3. SOUND LEVEL ==========
      const rawSound = latest.sound?.level ?? latest.sensors?.sound_level ?? latest.decibels;
      
      metricTraces.push({
        name: 'Sound Level',
        description: 'Current decibel reading from microphone',
        rawData: { 
          'sound.level': latest.sound?.level,
          'sensors.sound_level': latest.sensors?.sound_level,
          'decibels': latest.decibels
        },
        extractions: [
          { field: 'sound.level', path: 'sound.level', value: latest.sound?.level },
          { field: 'sensors.sound_level', path: 'sensors.sound_level', value: latest.sensors?.sound_level },
          { field: 'decibels', path: 'decibels', value: latest.decibels },
        ],
        formula: 'First non-null of: sound.level → sensors.sound_level → decibels',
        inputs: [
          { name: 'sound.level', value: latest.sound?.level ?? 'null', source: 'sound.level' },
          { name: 'sensors.sound_level', value: latest.sensors?.sound_level ?? 'null', source: 'sensors.sound_level' },
          { name: 'decibels', value: latest.decibels ?? 'null', source: 'decibels' },
        ],
        calculation: `First non-null = ${rawSound ?? 'null'}`,
        result: rawSound ?? 'N/A',
        displayedAs: rawSound !== undefined ? `${Math.round(rawSound)} dB` : 'N/A',
        customerSees: rawSound !== undefined ? `${Math.round(rawSound)} dB` : '—',
      });

      // ========== 4. LIGHT LEVEL ==========
      const rawLight = latest.light?.lux ?? latest.sensors?.light_level;
      
      metricTraces.push({
        name: 'Light Level',
        description: 'Current lux reading from light sensor',
        rawData: { 
          'light.lux': latest.light?.lux,
          'sensors.light_level': latest.sensors?.light_level,
        },
        extractions: [
          { field: 'light.lux', path: 'light.lux', value: latest.light?.lux },
          { field: 'sensors.light_level', path: 'sensors.light_level', value: latest.sensors?.light_level },
        ],
        formula: 'First non-null of: light.lux → sensors.light_level',
        inputs: [
          { name: 'light.lux', value: latest.light?.lux ?? 'null', source: 'light.lux' },
          { name: 'sensors.light_level', value: latest.sensors?.light_level ?? 'null', source: 'sensors.light_level' },
        ],
        calculation: `First non-null = ${rawLight ?? 'null'}`,
        result: rawLight ?? 'N/A',
        displayedAs: rawLight !== undefined ? `${Math.round(rawLight)} lux` : 'N/A',
        customerSees: rawLight !== undefined ? `${Math.round(rawLight)} lux` : '—',
      });

      // ========== 5. CURRENT SONG ==========
      const currentSong = latest.currentSong ?? latest.spotify?.current_song;
      const artist = latest.artist ?? latest.spotify?.artist;
      
      metricTraces.push({
        name: 'Current Song',
        description: 'Currently detected song playing',
        rawData: { 
          currentSong: latest.currentSong,
          artist: latest.artist,
          'spotify.current_song': latest.spotify?.current_song,
          'spotify.artist': latest.spotify?.artist,
        },
        extractions: [
          { field: 'currentSong', path: 'currentSong', value: latest.currentSong },
          { field: 'artist', path: 'artist', value: latest.artist },
        ],
        formula: 'Direct extraction, no calculation',
        inputs: [
          { name: 'currentSong', value: currentSong ?? 'null', source: 'currentSong OR spotify.current_song' },
          { name: 'artist', value: artist ?? 'null', source: 'artist OR spotify.artist' },
        ],
        calculation: 'N/A (direct value)',
        result: currentSong ? `${currentSong} - ${artist}` : 'No song',
        displayedAs: currentSong ? `${currentSong} - ${artist}` : 'No song playing',
        customerSees: currentSong ? `"${currentSong}" by ${artist}` : 'No song detected',
      });

      // ========== 6. AVERAGE STAY (Today) ==========
      if (todayData.length > 1) {
        const firstReading = todayData[todayData.length - 1];
        const lastReading = todayData[0];
        
        const startEntries = firstReading.occupancy?.entries ?? 0;
        const endEntries = lastReading.occupancy?.entries ?? 0;
        const startExits = firstReading.occupancy?.exits ?? 0;
        const endExits = lastReading.occupancy?.exits ?? 0;
        
        const totalNewGuests = endEntries - startEntries;
        const totalExits = endExits - startExits;
        
        const startTime = new Date(firstReading.timestamp);
        const endTime = new Date(lastReading.timestamp);
        const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
        
        // Simplified avg stay calculation
        let avgStayMinutes: number | null = null;
        if (totalExits > 0 && totalNewGuests > 0) {
          // Average time = total person-minutes / exits
          // Approximation: if exits happened evenly, avg stay ≈ duration * (entries/exits) / 2
          avgStayMinutes = Math.round(durationMinutes * (totalNewGuests / totalExits) / 2);
        }

        metricTraces.push({
          name: 'Average Stay (Today)',
          description: 'Estimated average time guests stay',
          rawData: {
            firstReading: { 
              timestamp: firstReading.timestamp, 
              entries: startEntries, 
              exits: startExits 
            },
            lastReading: { 
              timestamp: lastReading.timestamp, 
              entries: endEntries, 
              exits: endExits 
            },
            dataPoints: todayData.length
          },
          extractions: [
            { field: 'First reading entries', path: `data[${todayData.length - 1}].occupancy.entries`, value: startEntries },
            { field: 'Last reading entries', path: 'data[0].occupancy.entries', value: endEntries },
            { field: 'First reading exits', path: `data[${todayData.length - 1}].occupancy.exits`, value: startExits },
            { field: 'Last reading exits', path: 'data[0].occupancy.exits', value: endExits },
          ],
          formula: 'avgStay ≈ duration × (newGuests / exits) / 2',
          inputs: [
            { name: 'duration', value: `${durationMinutes} min`, source: 'lastTimestamp - firstTimestamp' },
            { name: 'newGuests', value: totalNewGuests, source: 'endEntries - startEntries' },
            { name: 'totalExits', value: totalExits, source: 'endExits - startExits' },
          ],
          calculation: `${durationMinutes} × (${totalNewGuests} / ${totalExits}) / 2 = ${avgStayMinutes ?? 'N/A'}`,
          result: avgStayMinutes ?? 'N/A',
          displayedAs: avgStayMinutes ? `${avgStayMinutes} min` : 'N/A',
          customerSees: avgStayMinutes ? `${avgStayMinutes} min` : '—',
        });
      }

      // ========== 7. TOTAL GUESTS TODAY ==========
      if (todayData.length > 1) {
        const firstReading = todayData[todayData.length - 1];
        const lastReading = todayData[0];
        
        const startEntries = firstReading.occupancy?.entries ?? 0;
        const endEntries = lastReading.occupancy?.entries ?? 0;
        const totalNewGuests = endEntries - startEntries;

        metricTraces.push({
          name: 'Total Guests Today',
          description: 'Number of people who entered since day start',
          rawData: {
            firstReading: { timestamp: firstReading.timestamp, entries: startEntries },
            lastReading: { timestamp: lastReading.timestamp, entries: endEntries },
          },
          extractions: [
            { field: 'Day start entries', path: 'firstReading.occupancy.entries', value: startEntries },
            { field: 'Current entries', path: 'lastReading.occupancy.entries', value: endEntries },
          ],
          formula: 'totalGuests = currentEntries - dayStartEntries',
          inputs: [
            { name: 'currentEntries', value: endEntries, source: 'Latest occupancy.entries' },
            { name: 'dayStartEntries', value: startEntries, source: 'First reading today occupancy.entries' },
          ],
          calculation: `${endEntries} - ${startEntries} = ${totalNewGuests}`,
          result: totalNewGuests,
          displayedAs: String(totalNewGuests),
          customerSees: `${totalNewGuests} guests`,
        });
      }

      // ========== 8. DATA TIMESTAMP ==========
      metricTraces.push({
        name: 'Data Timestamp',
        description: 'When this data was recorded',
        rawData: { timestamp: latest.timestamp },
        extractions: [
          { field: 'timestamp', path: 'timestamp', value: latest.timestamp },
        ],
        formula: 'Direct extraction, formatted for display',
        inputs: [
          { name: 'raw timestamp', value: latest.timestamp, source: 'timestamp' },
        ],
        calculation: 'Format as readable date/time',
        result: latest.timestamp,
        displayedAs: format(new Date(latest.timestamp), 'MMM d, yyyy h:mm:ss a'),
        customerSees: format(new Date(latest.timestamp), 'h:mm a'),
      });

      setTraces(metricTraces);
      
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

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

        {/* Venue Selector */}
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
            
            <button
              onClick={loadData}
              disabled={loading || !selectedVenue}
              className="btn-primary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
          </div>
        </div>

        {!selectedVenue ? (
          <div className="glass-card p-12 text-center">
            <Database className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">Select a venue to see the data pipeline</p>
          </div>
        ) : loading ? (
          <div className="glass-card p-12 text-center">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading data...</p>
          </div>
        ) : !rawData ? (
          <div className="glass-card p-12 text-center">
            <Database className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">No data found for this venue today</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Raw Data Preview */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-400" />
                  <h2 className="text-lg font-bold text-white">Raw DynamoDB Record</h2>
                </div>
                <button
                  onClick={() => copyToClipboard(JSON.stringify(rawData, null, 2), 'raw')}
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                >
                  {copiedField === 'raw' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedField === 'raw' ? 'Copied!' : 'Copy JSON'}
                </button>
              </div>
              <pre className="text-xs text-gray-300 bg-black/50 p-4 rounded-lg overflow-x-auto max-h-64 overflow-y-auto font-mono">
                {JSON.stringify(rawData, null, 2)}
              </pre>
            </div>

            {/* Metric Traces */}
            <div className="space-y-3">
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
                      <div className="text-right">
                        <div className="text-sm text-gray-400">Customer sees</div>
                        <div className="text-lg font-bold text-white">{trace.customerSees}</div>
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
                    <div className="border-t border-gray-700 p-4 space-y-4">
                      {/* Step 1: Raw Data */}
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-sm font-bold">1</div>
                          <div className="flex-1 w-px bg-gray-700 my-2"></div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Database className="w-4 h-4 text-blue-400" />
                            <span className="font-medium text-blue-400">Raw Data from DynamoDB</span>
                          </div>
                          <pre className="text-xs text-gray-300 bg-black/50 p-3 rounded-lg overflow-x-auto font-mono">
                            {JSON.stringify(trace.rawData, null, 2)}
                          </pre>
                        </div>
                      </div>

                      {/* Step 2: Extraction */}
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 text-sm font-bold">2</div>
                          <div className="flex-1 w-px bg-gray-700 my-2"></div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <ArrowDown className="w-4 h-4 text-purple-400" />
                            <span className="font-medium text-purple-400">Values We Extract</span>
                          </div>
                          <div className="bg-black/50 p-3 rounded-lg space-y-1">
                            {trace.extractions.map((ext, i) => (
                              <div key={i} className="flex items-center gap-2 text-sm font-mono">
                                <span className="text-gray-500">{ext.path}</span>
                                <span className="text-gray-400">→</span>
                                <span className={ext.value !== null && ext.value !== undefined ? 'text-green-400' : 'text-red-400'}>
                                  {ext.value !== null && ext.value !== undefined ? String(ext.value) : 'null'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Step 3: Formula */}
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm font-bold">3</div>
                          <div className="flex-1 w-px bg-gray-700 my-2"></div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Calculator className="w-4 h-4 text-cyan-400" />
                            <span className="font-medium text-cyan-400">Formula We Apply</span>
                          </div>
                          <div className="bg-black/50 p-3 rounded-lg">
                            <code className="text-cyan-300 font-mono">{trace.formula}</code>
                          </div>
                        </div>
                      </div>

                      {/* Step 4: Inputs */}
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-400 text-sm font-bold">4</div>
                          <div className="flex-1 w-px bg-gray-700 my-2"></div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-yellow-400">Actual Inputs</span>
                          </div>
                          <div className="bg-black/50 p-3 rounded-lg space-y-1">
                            {trace.inputs.map((input, i) => (
                              <div key={i} className="flex items-center gap-2 text-sm">
                                <span className="text-yellow-300 font-mono">{input.name}</span>
                                <span className="text-gray-400">=</span>
                                <span className="text-white font-bold font-mono">{String(input.value)}</span>
                                <span className="text-gray-500 text-xs">({input.source})</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Step 5: Calculation */}
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 text-sm font-bold">5</div>
                          <div className="flex-1 w-px bg-gray-700 my-2"></div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-orange-400">The Math</span>
                          </div>
                          <div className="bg-black/50 p-3 rounded-lg">
                            <code className="text-orange-300 font-mono text-lg">{trace.calculation}</code>
                          </div>
                        </div>
                      </div>

                      {/* Step 6: Result */}
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-sm font-bold">6</div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Monitor className="w-4 h-4 text-green-400" />
                            <span className="font-medium text-green-400">What Customer Sees</span>
                          </div>
                          <div className="bg-green-500/10 border border-green-500/30 p-4 rounded-lg">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm text-gray-400">Calculated Result</div>
                                <div className="text-xl font-bold text-white font-mono">{String(trace.result)}</div>
                              </div>
                              <div className="text-4xl">→</div>
                              <div className="text-right">
                                <div className="text-sm text-gray-400">Displayed As</div>
                                <div className="text-2xl font-bold text-green-400">{trace.customerSees}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
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
