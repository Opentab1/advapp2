/**
 * usePeakPrediction - Historical average-based peak prediction
 * 
 * Uses last 4 weeks of same-day data to predict when the venue will be busiest.
 * Simple and honest - just averages from historical data.
 */

import { useState, useEffect, useMemo } from 'react';
import dynamoDBService from '../services/dynamodb.service';

export interface PeakPrediction {
  hour: string;           // "10 PM"
  expectedOccupancy: number;
  minutesUntil: number;
  confidence: 'high' | 'medium' | 'low';  // Based on data availability
  basedOnWeeks: number;   // How many weeks of data
}

interface HourlyAverage {
  hour: number;
  avgOccupancy: number;
  dataPoints: number;
}

export function usePeakPrediction(venueId: string | null): {
  prediction: PeakPrediction | null;
  isLoading: boolean;
  error: string | null;
} {
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch last 4 weeks of same-day data
  useEffect(() => {
    if (!venueId) return;

    const fetchHistorical = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const now = new Date();
        
        // Get dates for same day of week over last 4 weeks
        const dates: { start: Date; end: Date }[] = [];
        for (let week = 1; week <= 4; week++) {
          const targetDate = new Date(now);
          targetDate.setDate(targetDate.getDate() - (week * 7));
          
          const start = new Date(targetDate);
          start.setHours(0, 0, 0, 0);
          
          const end = new Date(targetDate);
          end.setHours(23, 59, 59, 999);
          
          dates.push({ start, end });
        }
        
        // Fetch data for each past same-day
        const allData: any[] = [];
        for (const { start, end } of dates) {
          try {
            const data = await dynamoDBService.getSensorDataByDateRange(
              venueId,
              start,
              end,
              200
            );
            allData.push(...data);
          } catch (err) {
            // Silently handle individual fetch errors
            console.log(`No data for ${start.toDateString()}`);
          }
        }
        
        setHistoricalData(allData);
      } catch (err) {
        setError('Unable to load historical data');
        console.error('Peak prediction error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistorical();
  }, [venueId]);

  // Calculate peak prediction from historical data
  const prediction = useMemo((): PeakPrediction | null => {
    if (historicalData.length === 0) return null;

    const now = new Date();
    const currentHour = now.getHours();

    // Group by hour and calculate averages
    const hourlyAverages: Map<number, { sum: number; count: number }> = new Map();
    
    historicalData.forEach(d => {
      const hour = new Date(d.timestamp).getHours();
      const occupancy = d.occupancy?.current || 0;
      
      if (!hourlyAverages.has(hour)) {
        hourlyAverages.set(hour, { sum: 0, count: 0 });
      }
      const existing = hourlyAverages.get(hour)!;
      existing.sum += occupancy;
      existing.count += 1;
    });

    // Convert to array and sort by average occupancy
    const hourlyData: HourlyAverage[] = [];
    hourlyAverages.forEach((data, hour) => {
      hourlyData.push({
        hour,
        avgOccupancy: Math.round(data.sum / data.count),
        dataPoints: data.count,
      });
    });

    // Find peak hour that's still upcoming today
    const upcomingHours = hourlyData
      .filter(h => h.hour > currentHour)
      .sort((a, b) => b.avgOccupancy - a.avgOccupancy);

    if (upcomingHours.length === 0) {
      // No more peaks today
      return null;
    }

    const peakHour = upcomingHours[0];
    
    // Calculate minutes until peak
    const minutesUntil = (peakHour.hour - currentHour) * 60 - now.getMinutes();
    
    // Determine confidence based on data availability
    const totalDataPoints = hourlyData.reduce((sum, h) => sum + h.dataPoints, 0);
    const weeksOfData = Math.min(4, Math.floor(totalDataPoints / 24));
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (weeksOfData >= 3) confidence = 'high';
    else if (weeksOfData >= 2) confidence = 'medium';

    // Format hour for display
    const hourFormatted = new Date(2000, 0, 1, peakHour.hour).toLocaleTimeString([], {
      hour: 'numeric',
      hour12: true,
    });

    return {
      hour: hourFormatted,
      expectedOccupancy: peakHour.avgOccupancy,
      minutesUntil,
      confidence,
      basedOnWeeks: weeksOfData,
    };
  }, [historicalData]);

  return { prediction, isLoading, error };
}

export default usePeakPrediction;
