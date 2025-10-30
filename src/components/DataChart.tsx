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
import zoomPlugin from 'chartjs-plugin-zoom';
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
  Filler,
  zoomPlugin
);

interface DataChartProps {
  data: SensorData[];
  metric: 'decibels' | 'light' | 'indoorTemp' | 'outdoorTemp' | 'humidity' | 'occupancy';
  title: string;
  color?: string;
}

export function DataChart({ data, metric, title, color = '#00d4ff' }: DataChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);

  const chartData = {
    labels: data.map(d => new Date(d.timestamp)),
    datasets: [
      {
        label: title,
        data: data.map(d => metric === 'occupancy' ? (d.occupancy?.current || 0) : d[metric]),
        borderColor: color,
        backgroundColor: `${color}20`,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        fill: true,
        tension: 0.4
      }
    ]
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
        backgroundColor: 'rgba(10, 25, 47, 0.95)',
        titleColor: '#00d4ff',
        bodyColor: '#fff',
        borderColor: 'rgba(0, 212, 255, 0.3)',
        borderWidth: 1,
        padding: 12,
        displayColors: false,
        callbacks: {
          title: (items: any) => {
            const date = new Date(items[0].parsed.x);
            return date.toLocaleString();
          },
          label: (context: any) => {
            let label = context.dataset.label || '';
            if (label) {
              label += ': ';
            }
            const value = context.parsed.y;
            if (metric === 'decibels') {
              label += `${value.toFixed(1)} dB`;
            } else if (metric === 'light') {
              label += `${Math.round(value)} lux`;
            } else if (metric.includes('Temp')) {
              label += `${value.toFixed(1)}°F`;
            } else if (metric === 'humidity') {
              label += `${value.toFixed(0)}%`;
            } else if (metric === 'occupancy') {
              label += `${Math.round(value)} people`;
            } else {
              label += value.toFixed(1);
            }
            return label;
          }
        }
      },
      zoom: {
        zoom: {
          wheel: {
            enabled: true
          },
          pinch: {
            enabled: true
          },
          mode: 'x' as const
        },
        pan: {
          enabled: true,
          mode: 'x' as const
        },
        limits: {
          x: { min: 'original' as const, max: 'original' as const }
        }
      }
    },
    scales: {
      x: {
        type: 'time' as const,
        time: {
          displayFormats: {
            hour: 'HH:mm',
            day: 'MMM dd'
          }
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
          drawBorder: false
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.6)',
          font: {
            size: 11
          }
        }
      },
      y: {
        grid: {
          color: 'rgba(255, 255, 255, 0.05)',
          drawBorder: false
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.6)',
          font: {
            size: 11
          },
          callback: function(value: any) {
            if (metric === 'decibels') {
              return `${value} dB`;
            } else if (metric === 'light') {
              return `${value} lux`;
            } else if (metric.includes('Temp')) {
              return `${value}°F`;
            } else if (metric === 'humidity') {
              return `${value}%`;
            } else if (metric === 'occupancy') {
              return `${value}`;
            }
            return value;
          }
        }
      }
    }
  };

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  return (
    <motion.div
      className="glass-card p-6 h-[400px]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <button
          onClick={handleResetZoom}
          className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-cyan transition-colors"
        >
          Reset Zoom
        </button>
      </div>
      
      <div className="h-[calc(100%-3rem)]">
        <Line ref={chartRef} data={chartData} options={options} />
      </div>
      
      <p className="text-xs text-gray-400 mt-2 text-center">
        Scroll to zoom • Drag to pan
      </p>
    </motion.div>
  );
}
