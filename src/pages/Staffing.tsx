import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Users, Calendar, Clock, RefreshCw, Zap, BarChart3
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import dynamoDBService from '../services/dynamodb.service';
import authService from '../services/auth.service';
import { PullToRefresh } from '../components/common/PullToRefresh';
import type { SensorData } from '../types';

interface DayForecast {
  date: Date;
  dayName: string;
  predictedGuests: number;
  confidence: number;
  peakHours: string;
  weatherImpact: number; // -100 to +100
  weatherCondition?: string;
  staffingRecommendation: {
    bartenders: number;
    servers: number;
    door: number;
  };
}

interface HourlyPattern {
  hour: number;
  avgOccupancy: number;
  peakOccupancy: number;
}

export function Staffing() {
  const [loading, setLoading] = useState(true);
  const [weekForecast, setWeekForecast] = useState<DayForecast[]>([]);
  const [hourlyPatterns, setHourlyPatterns] = useState<Map<number, HourlyPattern[]>>(new Map());
  const [selectedDay, setSelectedDay] = useState<number>(new Date().getDay());
  
  const user = authService.getStoredUser();
  const venueId = user?.venueId;

  useEffect(() => {
    if (venueId) {
      loadPredictions();
    }
  }, [venueId]);

  const loadPredictions = async () => {
    if (!venueId) return;
    setLoading(true);

    try {
      // Get historical data (last 30 days)
      const historicalData = await dynamoDBService.getHistoricalSensorData(venueId, '30d');
      if (!historicalData?.data?.length) {
        setLoading(false);
        return;
      }

      // Analyze patterns by day of week
      const patterns = analyzePatterns(historicalData.data);
      setHourlyPatterns(patterns);

      // Generate forecast for next 7 days
      const forecast = await generateForecast(patterns);
      setWeekForecast(forecast);

    } catch (error) {
      console.error('Error loading predictions:', error);
    } finally {
      setLoading(false);
    }
  };

  const analyzePatterns = (data: SensorData[]): Map<number, HourlyPattern[]> => {
    const patterns = new Map<number, Map<number, number[]>>();

    // Initialize for each day of week
    for (let day = 0; day < 7; day++) {
      patterns.set(day, new Map());
      for (let hour = 0; hour < 24; hour++) {
        patterns.get(day)!.set(hour, []);
      }
    }

    // Group data by day of week and hour
    data.forEach(d => {
      const date = new Date(d.timestamp);
      const dayOfWeek = date.getDay();
      const hour = date.getHours();
      const occupancy = d.occupancy?.current || 0;

      patterns.get(dayOfWeek)!.get(hour)!.push(occupancy);
    });

    // Calculate averages
    const result = new Map<number, HourlyPattern[]>();
    
    patterns.forEach((hours, day) => {
      const hourlyPatterns: HourlyPattern[] = [];
      
      hours.forEach((occupancies, hour) => {
        if (occupancies.length > 0) {
          hourlyPatterns.push({
            hour,
            avgOccupancy: Math.round(occupancies.reduce((a, b) => a + b, 0) / occupancies.length),
            peakOccupancy: Math.max(...occupancies)
          });
        } else {
          hourlyPatterns.push({ hour, avgOccupancy: 0, peakOccupancy: 0 });
        }
      });
      
      result.set(day, hourlyPatterns.sort((a, b) => a.hour - b.hour));
    });

    return result;
  };

  const generateForecast = async (patterns: Map<number, HourlyPattern[]>): Promise<DayForecast[]> => {
    const forecast: DayForecast[] = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = addDays(today, i);
      const dayOfWeek = date.getDay();
      const dayPatterns = patterns.get(dayOfWeek) || [];

      // Calculate predicted guests based on historical patterns
      const totalOccupancy = dayPatterns.reduce((sum, p) => sum + p.avgOccupancy, 0);
      const peakHour = dayPatterns.reduce((max, p) => p.avgOccupancy > max.avgOccupancy ? p : max, dayPatterns[0]);
      
      // Estimate guests (simplified - assumes avg 2 hour stay)
      const predictedGuests = Math.round(totalOccupancy / 2);

      // Calculate confidence based on data availability
      const dataPoints = dayPatterns.filter(p => p.avgOccupancy > 0).length;
      const confidence = Math.min(100, Math.round((dataPoints / 24) * 100 + 20));

      // Weather impact (placeholder - would use real weather API)
      const weatherImpact = 0;

      // Staffing recommendation based on predicted peak
      const peakOcc = peakHour?.peakOccupancy || 0;
      const staffing = {
        bartenders: Math.max(1, Math.ceil(peakOcc / 50)),
        servers: Math.max(1, Math.ceil(peakOcc / 30)),
        door: peakOcc > 100 ? Math.ceil(peakOcc / 150) : 0
      };

      // Find peak hours (hours within 80% of max)
      const threshold = peakHour?.avgOccupancy * 0.8 || 0;
      const peakHours = dayPatterns
        .filter(p => p.avgOccupancy >= threshold && p.avgOccupancy > 0)
        .map(p => p.hour)
        .sort((a, b) => a - b);
      
      const peakHoursStr = peakHours.length > 0
        ? `${formatHour(peakHours[0])}-${formatHour(peakHours[peakHours.length - 1] + 1)}`
        : 'N/A';

      forecast.push({
        date,
        dayName: format(date, 'EEEE'),
        predictedGuests,
        confidence,
        peakHours: peakHoursStr,
        weatherImpact,
        staffingRecommendation: staffing
      });
    }

    return forecast;
  };

  const formatHour = (hour: number): string => {
    const h = hour % 24;
    return `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`;
  };

  const selectedDayPatterns = hourlyPatterns.get(selectedDay) || [];
  const maxOccupancy = Math.max(...selectedDayPatterns.map(p => p.peakOccupancy), 1);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const handleRefresh = async () => {
    await loadPredictions();
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="max-w-6xl mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Users className="w-8 h-8 text-primary" />
                Staffing
              </h1>
              <p className="text-warm-400 mt-1">Predictive staffing based on your venue's patterns</p>
            </div>
            
            <motion.button
              onClick={loadPredictions}
              disabled={loading}
              className="btn-secondary flex items-center gap-2"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </motion.button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <RefreshCw className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : weekForecast.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <BarChart3 className="w-12 h-12 text-warm-600 mx-auto mb-3" />
              <p className="text-warm-400 mb-2">Not enough data for predictions</p>
              <p className="text-sm text-warm-500">Keep collecting data and predictions will appear here</p>
            </div>
          ) : (
            <>
              {/* Week Forecast */}
              <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  This Week's Forecast
                </h2>
                
                <div className="grid grid-cols-7 gap-2">
                  {weekForecast.map((day, i) => {
                    const isToday = i === 0;
                    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                    
                    return (
                      <motion.div
                        key={day.dayName}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        onClick={() => setSelectedDay(day.date.getDay())}
                        className={`p-3 rounded-xl cursor-pointer transition-all ${
                          selectedDay === day.date.getDay()
                            ? 'bg-primary/20 border border-primary/30'
                            : isWeekend
                            ? 'bg-gradient-to-b from-amber-500/10 to-transparent hover:from-amber-500/20'
                            : 'bg-warm-800/50 hover:bg-warm-800'
                        }`}
                      >
                        <div className="text-center">
                          <div className={`text-xs ${isToday ? 'text-primary font-medium' : 'text-warm-400'}`}>
                            {isToday ? 'Today' : format(day.date, 'EEE')}
                          </div>
                          <div className="text-lg font-bold text-white mt-1">
                            {day.predictedGuests}
                          </div>
                          <div className="text-xs text-warm-500">guests</div>
                          
                          {/* Confidence indicator */}
                          <div className="mt-2 h-1 bg-warm-700 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${day.confidence}%` }}
                            />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* Selected Day Details */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Staffing Recommendation */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="glass-card p-6"
                >
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-400" />
                    Staff for {dayNames[selectedDay]}
                  </h3>
                  
                  {weekForecast.find(d => d.date.getDay() === selectedDay) && (
                    <div className="space-y-4">
                      {[
                        { role: 'Bartenders', count: weekForecast.find(d => d.date.getDay() === selectedDay)!.staffingRecommendation.bartenders, color: 'text-purple-400' },
                        { role: 'Servers', count: weekForecast.find(d => d.date.getDay() === selectedDay)!.staffingRecommendation.servers, color: 'text-cyan-400' },
                        { role: 'Door Staff', count: weekForecast.find(d => d.date.getDay() === selectedDay)!.staffingRecommendation.door, color: 'text-amber-400' },
                      ].map(item => (
                        <div key={item.role} className="flex items-center justify-between p-3 bg-warm-800 rounded-lg">
                          <span className="text-warm-300">{item.role}</span>
                          <span className={`text-xl font-bold ${item.color}`}>{item.count}</span>
                        </div>
                      ))}
                      
                      <div className="pt-3 border-t border-warm-700">
                        <div className="flex items-center gap-2 text-sm text-warm-400">
                          <Clock className="w-4 h-4" />
                          <span>Peak hours: {weekForecast.find(d => d.date.getDay() === selectedDay)!.peakHours}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>

                {/* Hourly Breakdown */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="glass-card p-6 lg:col-span-2"
                >
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-primary" />
                    Hourly Pattern - {dayNames[selectedDay]}s
                  </h3>
                  
                  <div className="h-48 flex items-end gap-1">
                    {selectedDayPatterns
                      .filter(p => p.hour >= 10 && p.hour <= 2 + 24) // 10am to 2am
                      .slice(0, 16)
                      .map((pattern, i) => {
                        const height = maxOccupancy > 0 ? (pattern.avgOccupancy / maxOccupancy) * 100 : 0;
                        const isPeak = pattern.avgOccupancy >= maxOccupancy * 0.8;
                        
                        return (
                          <div
                            key={pattern.hour}
                            className="flex-1 flex flex-col items-center gap-1"
                          >
                            <div className="text-xs text-warm-500">{pattern.avgOccupancy}</div>
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: `${Math.max(height, 5)}%` }}
                              transition={{ delay: i * 0.03, duration: 0.5 }}
                              className={`w-full rounded-t-sm ${
                                isPeak ? 'bg-primary' : 'bg-warm-600'
                              }`}
                            />
                            <div className="text-xs text-warm-500">
                              {formatHour(pattern.hour)}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  
                  <div className="flex items-center gap-4 mt-4 pt-4 border-t border-warm-700 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded bg-primary" />
                      <span className="text-warm-400">Peak hours</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded bg-warm-600" />
                      <span className="text-warm-400">Regular hours</span>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Tips */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="glass-card p-4 border-l-4 border-primary"
              >
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-white">How predictions work</h4>
                    <p className="text-sm text-warm-400 mt-1">
                      Staffing recommendations are based on your venue's historical crowd patterns. 
                      The more data collected, the more accurate predictions become. 
                      Confidence bars show data reliability for each day.
                    </p>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </motion.div>
      </div>
    </PullToRefresh>
  );
}

export default Staffing;
