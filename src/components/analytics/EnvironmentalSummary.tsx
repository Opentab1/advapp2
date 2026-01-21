/**
 * EnvironmentalSummary - Shows average conditions for the period
 * 
 * Sound: Avg dB (range min-max)
 * Light: Avg lux (range min-max)
 * Crowd: Peak count and when
 */

import { motion } from 'framer-motion';
import { Volume2, Sun, Users, Thermometer } from 'lucide-react';
import type { SensorData } from '../../types';

interface EnvironmentalSummaryProps {
  data: SensorData[];
  loading: boolean;
}

interface EnvStats {
  sound: { avg: number; min: number; max: number; hasData: boolean };
  light: { avg: number; min: number; max: number; hasData: boolean };
  crowd: { peak: number; peakTime: string; avg: number; hasData: boolean };
  temp: { avg: number; hasData: boolean };
}

function processEnvData(data: SensorData[]): EnvStats {
  const stats: EnvStats = {
    sound: { avg: 0, min: 999, max: 0, hasData: false },
    light: { avg: 0, min: 999, max: 0, hasData: false },
    crowd: { peak: 0, peakTime: '', avg: 0, hasData: false },
    temp: { avg: 0, hasData: false },
  };
  
  if (data.length === 0) return stats;
  
  let soundSum = 0, soundCount = 0;
  let lightSum = 0, lightCount = 0;
  let crowdSum = 0, crowdCount = 0;
  let tempSum = 0, tempCount = 0;
  
  data.forEach(d => {
    // Sound
    if (d.decibels && d.decibels > 0) {
      soundSum += d.decibels;
      soundCount++;
      stats.sound.hasData = true;
      if (d.decibels < stats.sound.min) stats.sound.min = d.decibels;
      if (d.decibels > stats.sound.max) stats.sound.max = d.decibels;
    }
    
    // Light
    if (d.light !== undefined && d.light >= 0) {
      lightSum += d.light;
      lightCount++;
      stats.light.hasData = true;
      if (d.light < stats.light.min) stats.light.min = d.light;
      if (d.light > stats.light.max) stats.light.max = d.light;
    }
    
    // Crowd
    if (d.occupancy?.current !== undefined) {
      crowdSum += d.occupancy.current;
      crowdCount++;
      stats.crowd.hasData = true;
      if (d.occupancy.current > stats.crowd.peak) {
        stats.crowd.peak = d.occupancy.current;
        const ts = new Date(d.timestamp);
        stats.crowd.peakTime = ts.toLocaleDateString('en-US', { 
          weekday: 'short', 
          hour: 'numeric',
          minute: '2-digit',
        });
      }
    }
    
    // Temperature
    if (d.indoorTemp || d.outdoorTemp) {
      const temp = d.indoorTemp || d.outdoorTemp;
      if (temp && temp > 0) {
        tempSum += temp;
        tempCount++;
        stats.temp.hasData = true;
      }
    }
  });
  
  // Calculate averages
  if (soundCount > 0) stats.sound.avg = Math.round(soundSum / soundCount);
  if (lightCount > 0) stats.light.avg = Math.round(lightSum / lightCount);
  if (crowdCount > 0) stats.crowd.avg = Math.round(crowdSum / crowdCount);
  if (tempCount > 0) stats.temp.avg = Math.round(tempSum / tempCount);
  
  // Fix min values if no data
  if (!stats.sound.hasData) stats.sound.min = 0;
  if (!stats.light.hasData) stats.light.min = 0;
  
  return stats;
}

function EnvCard({ 
  icon: Icon, 
  label, 
  value, 
  subtext,
  color,
}: { 
  icon: typeof Volume2;
  label: string;
  value: string;
  subtext?: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-warm-800/30 rounded-lg">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-warm-400">{label}</div>
        <div className="text-white font-semibold">{value}</div>
        {subtext && <div className="text-xs text-warm-500">{subtext}</div>}
      </div>
    </div>
  );
}

export function EnvironmentalSummary({ data, loading }: EnvironmentalSummaryProps) {
  if (loading) {
    return (
      <div className="bg-whoop-panel border border-whoop-divider rounded-xl p-4">
        <div className="h-5 bg-warm-700 rounded w-40 mb-4 animate-pulse" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-16 bg-warm-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const stats = processEnvData(data);
  
  if (!stats.sound.hasData && !stats.light.hasData && !stats.crowd.hasData) {
    return null; // Don't show if no environmental data
  }

  return (
    <motion.div
      className="bg-whoop-panel border border-whoop-divider rounded-xl p-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h3 className="text-sm font-semibold text-warm-200 uppercase tracking-whoop mb-4">
        Environment Summary
      </h3>
      
      <div className="grid grid-cols-2 gap-3">
        {stats.sound.hasData && (
          <EnvCard
            icon={Volume2}
            label="Sound Level"
            value={`${stats.sound.avg} dB avg`}
            subtext={`Range: ${stats.sound.min}-${stats.sound.max} dB`}
            color="bg-blue-500/20 text-blue-400"
          />
        )}
        
        {stats.light.hasData && (
          <EnvCard
            icon={Sun}
            label="Lighting"
            value={`${stats.light.avg} lux avg`}
            subtext={`Range: ${stats.light.min}-${stats.light.max} lux`}
            color="bg-yellow-500/20 text-yellow-400"
          />
        )}
        
        {stats.crowd.hasData && (
          <EnvCard
            icon={Users}
            label="Peak Crowd"
            value={`${stats.crowd.peak} guests`}
            subtext={stats.crowd.peakTime || 'Peak time'}
            color="bg-purple-500/20 text-purple-400"
          />
        )}
        
        {stats.temp.hasData && (
          <EnvCard
            icon={Thermometer}
            label="Temperature"
            value={`${stats.temp.avg}°F avg`}
            color="bg-orange-500/20 text-orange-400"
          />
        )}
      </div>
    </motion.div>
  );
}

export default EnvironmentalSummary;
