/**
 * CrowdBreakdownModal - Occupancy details
 */

import { motion } from 'framer-motion';
import { Modal } from '../common/Modal';
import { Users, UserPlus, UserMinus, TrendingUp, Clock } from 'lucide-react';

interface CrowdBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOccupancy: number;
  todayEntries: number;
  todayExits: number;
  peakOccupancy: number;
  peakTime: string | null;
  weeklyAverage?: number;
}

export function CrowdBreakdownModal({
  isOpen,
  onClose,
  currentOccupancy,
  todayEntries,
  todayExits,
  peakOccupancy,
  peakTime,
  weeklyAverage,
}: CrowdBreakdownModalProps) {
  // Calculate comparison to weekly average
  const vsAverage = weeklyAverage && weeklyAverage > 0
    ? Math.round(((currentOccupancy - weeklyAverage) / weeklyAverage) * 100)
    : null;
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Crowd Details">
      <div className="space-y-5">
        {/* Current occupancy */}
        <div className="text-center py-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Users className="w-6 h-6 text-green-500" />
            <p className="text-4xl font-bold text-warm-800">{currentOccupancy}</p>
          </div>
          <p className="text-sm text-warm-500">currently in venue</p>
          {vsAverage !== null && (
            <p className={`text-sm mt-1 ${vsAverage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {vsAverage >= 0 ? '+' : ''}{vsAverage}% vs typical
            </p>
          )}
        </div>
        
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={UserPlus}
            iconColor="text-green-500"
            label="Entries Today"
            value={todayEntries.toString()}
          />
          <StatCard
            icon={UserMinus}
            iconColor="text-red-500"
            label="Exits Today"
            value={todayExits.toString()}
          />
          <StatCard
            icon={TrendingUp}
            iconColor="text-primary"
            label="Peak Today"
            value={peakOccupancy.toString()}
            sub={peakTime ? `@ ${peakTime}` : undefined}
          />
          {weeklyAverage !== undefined && (
            <StatCard
              icon={Clock}
              iconColor="text-amber-500"
              label="Weekly Avg"
              value={Math.round(weeklyAverage).toString()}
              sub="per day"
            />
          )}
        </div>
        
        {/* Capacity visualization */}
        <div className="p-3 rounded-xl bg-warm-50">
          <div className="flex justify-between text-xs text-warm-500 mb-2">
            <span>Estimated capacity usage</span>
            <span>{Math.min(100, Math.round((currentOccupancy / Math.max(peakOccupancy * 1.2, 50)) * 100))}%</span>
          </div>
          <div className="h-2 bg-warm-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-green-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ 
                width: `${Math.min(100, (currentOccupancy / Math.max(peakOccupancy * 1.2, 50)) * 100)}%` 
              }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
        
        {/* Info */}
        <div className="text-xs text-warm-400 text-center">
          <p>Data resets at 3am (bar day)</p>
        </div>
      </div>
    </Modal>
  );
}

// ============ STAT CARD ============

interface StatCardProps {
  icon: typeof Users;
  iconColor: string;
  label: string;
  value: string;
  sub?: string;
}

function StatCard({ icon: Icon, iconColor, label, value, sub }: StatCardProps) {
  return (
    <div className="p-3 rounded-xl bg-warm-50">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <span className="text-xs text-warm-500">{label}</span>
      </div>
      <p className="text-lg font-bold text-warm-800">{value}</p>
      {sub && <p className="text-xs text-warm-400">{sub}</p>}
    </div>
  );
}

export default CrowdBreakdownModal;
