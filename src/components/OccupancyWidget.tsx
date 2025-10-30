import { motion } from 'framer-motion';
import { Users, UserPlus, UserMinus, BarChart2 } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { useOccupancy } from '../hooks/useOccupancy';
import type { OccupancyAggregate } from '../types';

interface OccupancyWidgetProps {
  venueId: string;
}

export function OccupancyWidget({ venueId }: OccupancyWidgetProps) {
  const { live, aggregates, loading, error, refetch } = useOccupancy({ venueId });

  const renderTotals = (aggs: OccupancyAggregate[] | null) => {
    if (!aggs || aggs.length === 0) return null;
    const labelMap: Record<string, string> = { '1d': '1 Day', '7d': '7 Days', '14d': '14 Days' };

    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        {aggs.map((a) => (
          <div key={a.period} className="glass-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400 font-medium">Total Occupancy • {labelMap[a.period] || a.period}</span>
              <BarChart2 className="w-4 h-4 text-cyan" />
            </div>
            <div className="text-2xl font-bold">{a.totalOccupancy}</div>
            <div className="text-xs text-gray-400 mt-1">Entries {a.entries} • Exits {a.exits}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <motion.div
      className="glass-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Occupancy</h3>
        <button
          onClick={refetch}
          className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-cyan transition-colors"
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-400 mb-3">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          title="Current Occupancy"
          value={String(live?.current ?? 0)}
          unit=""
          icon={Users}
          color="#9b87f5"
        />
        <MetricCard
          title="Entries Today"
          value={String(live?.entriesToday ?? 0)}
          unit=""
          icon={UserPlus}
          color="#22c55e"
          delay={0.05}
        />
        <MetricCard
          title="Exits Today"
          value={String(live?.exitsToday ?? 0)}
          unit=""
          icon={UserMinus}
          color="#ef4444"
          delay={0.1}
        />
      </div>

      {renderTotals(aggregates)}
    </motion.div>
  );
}
