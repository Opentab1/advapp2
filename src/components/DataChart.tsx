/**
 * DataChart - Clean, professional chart component
 * 
 * Light theme styling with clear, readable axes.
 */

import { useRef } from 'react';
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
import type { SensorData } from '../types';

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
}

export function DataChart({ data, metric, title, color = '#0077B6' }: DataChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);

  // Extract values based on metric
  const values = data.map(d => {
    if (metric === 'occupancy') {
      return d.occupancy?.current || 0;
    }
    return d[metric] as number;
  });

  const chartData = {
    labels: data.map(d => new Date(d.timestamp)),
    datasets: [
      {
        label: title,
        data: values,
        borderColor: color,
        backgroundColor: `${color}15`,
        borderWidth: 2,
        pointRadius: 0,
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
          displayFormats: {
            hour: 'ha',
            day: 'MMM d'
          }
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
          maxRotation: 0
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
      <div className="h-[200px] flex items-center justify-center text-warm-400">
        No data available
      </div>
    );
  }

  return (
    <motion.div
      className="h-[200px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Line ref={chartRef} data={chartData} options={options} />
    </motion.div>
  );
}

export default DataChart;
