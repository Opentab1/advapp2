/**
 * DataChart - Clean, professional chart component
 * 
 * Light theme styling with clear, readable axes.
 * Automatically adjusts time format based on data range.
 */

import { useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';
import type { SensorData, TimeRange } from '../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler
);

interface DataChartProps {
  data: SensorData[];
  metric: 'decibels' | 'light' | 'indoorTemp' | 'outdoorTemp' | 'humidity' | 'occupancy';
  title: string;
  color?: string;
  timeRange?: TimeRange;
}

export function DataChart({ data, metric, title, color = '#0077B6', timeRange = '7d' }: DataChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);

  // Sort data by timestamp to ensure proper chart rendering
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [data]);

  // Extract values based on metric
  const values = sortedData.map(d => {
    if (metric === 'occupancy') {
      return d.occupancy?.current || 0;
    }
    return d[metric] as number;
  });

  // Get appropriate time settings based on range
  const getTimeSettings = () => {
    switch (timeRange) {
      case '24h':
        return {
          unit: 'hour' as const,
          displayFormats: {
            hour: 'ha',
            day: 'MMM d'
          },
          tooltipFormat: 'h:mm a',
          maxTicksLimit: 12
        };
      case '7d':
        return {
          unit: 'day' as const,
          displayFormats: {
            hour: 'ha',
            day: 'EEE'
          },
          tooltipFormat: 'EEE, MMM d, h:mm a',
          maxTicksLimit: 7
        };
      case '30d':
        return {
          unit: 'day' as const,
          displayFormats: {
            day: 'MMM d',
            week: 'MMM d'
          },
          tooltipFormat: 'MMM d, yyyy',
          maxTicksLimit: 10
        };
      case '90d':
        return {
          unit: 'week' as const,
          displayFormats: {
            week: 'MMM d',
            month: 'MMM yyyy'
          },
          tooltipFormat: 'MMM d, yyyy',
          maxTicksLimit: 12
        };
      default:
        return {
          unit: 'day' as const,
          displayFormats: {
            hour: 'ha',
            day: 'MMM d'
          },
          tooltipFormat: 'MMM d, h:mm a',
          maxTicksLimit: 10
        };
    }
  };

  const timeSettings = getTimeSettings();

  const chartData = {
    labels: sortedData.map(d => new Date(d.timestamp)),
    datasets: [
      {
        label: title,
        data: values,
        borderColor: color,
        backgroundColor: `${color}15`,
        borderWidth: 2,
        pointRadius: timeRange === '24h' ? 0 : timeRange === '7d' ? 1 : 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        fill: true,
        tension: 0.3
      }
    ]
  };

  const getUnit = () => {
    switch (metric) {
      case 'decibels': return 'dB';
      case 'light': return 'lux';
      case 'indoorTemp':
      case 'outdoorTemp': return '°F';
      case 'humidity': return '%';
      case 'occupancy': return '';
      default: return '';
    }
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: '#1C1917',
        titleColor: '#FAFAFA',
        bodyColor: '#FAFAFA',
        borderColor: '#44403C',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          title: (items: any) => {
            const date = new Date(items[0].parsed.x);
            return date.toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit'
            });
          },
          label: (context: any) => {
            const value = context.parsed.y;
            const unit = getUnit();
            if (metric === 'occupancy') {
              return `${Math.round(value)} people`;
            }
            return `${value.toFixed(metric === 'decibels' ? 1 : 0)}${unit}`;
          }
        }
      }
    },
    scales: {
      x: {
        type: 'time' as const,
        time: {
          unit: timeSettings.unit,
          displayFormats: timeSettings.displayFormats
        },
        grid: {
          color: '#E7E5E4',
          drawBorder: false
        },
        ticks: {
          color: '#78716C',
          font: {
            size: 11,
            family: 'Inter'
          },
          maxRotation: 0,
          maxTicksLimit: timeSettings.maxTicksLimit
        }
      },
      y: {
        grid: {
          color: '#E7E5E4',
          drawBorder: false
        },
        ticks: {
          color: '#78716C',
          font: {
            size: 11,
            family: 'Inter'
          },
          callback: function(value: any) {
            const unit = getUnit();
            if (metric === 'occupancy') return value;
            return `${value}${unit}`;
          }
        }
      }
    }
  };

  // No data state
  if (!data || data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-warm-400 dark:text-warm-500">
        No data available
      </div>
    );
  }

  // Show data info
  const dataInfo = useMemo(() => {
    if (sortedData.length === 0) return null;
    const firstDate = new Date(sortedData[0].timestamp);
    const lastDate = new Date(sortedData[sortedData.length - 1].timestamp);
    return {
      from: firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      to: lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      points: sortedData.length
    };
  }, [sortedData]);

  return (
    <motion.div
      className="space-y-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Data range info */}
      {dataInfo && (
        <div className="flex justify-between text-xs text-warm-400 dark:text-warm-500">
          <span>{dataInfo.from} – {dataInfo.to}</span>
          <span>{dataInfo.points.toLocaleString()} readings</span>
        </div>
      )}
      <div className="h-[200px]">
        <Line ref={chartRef} data={chartData} options={options} />
      </div>
    </motion.div>
  );
}

export default DataChart;
