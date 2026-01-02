/**
 * StaffDetailView - Individual staff member performance
 */

import { motion } from 'framer-motion';
import { ArrowLeft, Trash2, Zap, Clock, Target, Star, TrendingUp, TrendingDown } from 'lucide-react';
import type { StaffPerformance } from '../../services/staff.service';

interface StaffDetailViewProps {
  performance: StaffPerformance;
  teamAvg: number;
  onBack: () => void;
  onDelete: () => void;
}

export function StaffDetailView({ performance, teamAvg, onBack, onDelete }: StaffDetailViewProps) {
  const vsTeam = performance.avgPulseScore - teamAvg;
  const vsTeamPercent = teamAvg > 0 ? Math.round((vsTeam / teamAvg) * 100) : 0;
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-warm-600 hover:text-warm-800 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Back</span>
        </button>
        <button
          onClick={() => {
            if (confirm(`Remove ${performance.staffName} from the team?`)) {
              onDelete();
            }
          }}
          className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </motion.div>
      
      {/* Profile Card */}
      <motion.div
        className="bg-white rounded-2xl border border-warm-200 p-6 text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        {/* Avatar */}
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-3xl font-bold text-primary mx-auto mb-3">
          {performance.staffName.charAt(0).toUpperCase()}
        </div>
        
        <h2 className="text-xl font-bold text-warm-800">{performance.staffName}</h2>
        <p className="text-warm-500 capitalize">{performance.staffRole}</p>
        
        {/* vs Team */}
        {performance.totalShifts > 0 && (
          <div className={`
            inline-flex items-center gap-1 mt-3 px-3 py-1 rounded-full text-sm font-medium
            ${vsTeam >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}
          `}>
            {vsTeam >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {vsTeam >= 0 ? '+' : ''}{vsTeamPercent}% vs team avg
          </div>
        )}
      </motion.div>
      
      {/* Stats Grid */}
      <motion.div
        className="grid grid-cols-3 gap-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <StatCard
          icon={Zap}
          iconColor="text-primary"
          iconBg="bg-primary/10"
          label="Avg Pulse"
          value={performance.avgPulseScore || '--'}
        />
        <StatCard
          icon={Clock}
          iconColor="text-amber-500"
          iconBg="bg-amber-50"
          label="Shifts"
          value={performance.totalShifts}
        />
        <StatCard
          icon={Target}
          iconColor="text-green-500"
          iconBg="bg-green-50"
          label="Actions"
          value={performance.totalActionsCompleted}
        />
      </motion.div>
      
      {/* Best Shift */}
      {performance.bestShift && (
        <motion.div
          className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-2xl border border-amber-200 p-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-5 h-5 text-amber-500" />
            <span className="font-semibold text-amber-800">Best Shift</span>
          </div>
          <p className="text-2xl font-bold text-amber-900">
            {performance.bestShift.score} Pulse Score
          </p>
          <p className="text-sm text-amber-700">
            {formatDate(performance.bestShift.date)}
          </p>
        </motion.div>
      )}
      
      {/* Recent Shifts */}
      {performance.recentShifts.length > 0 && (
        <motion.div
          className="bg-white rounded-2xl border border-warm-200 overflow-hidden"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="px-4 py-3 bg-warm-50 border-b border-warm-200">
            <h3 className="font-semibold text-warm-800">Recent Shifts</h3>
          </div>
          <div className="divide-y divide-warm-100">
            {performance.recentShifts.slice(0, 5).map((shift) => (
              <div key={shift.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-warm-800">{formatDate(shift.startTime)}</p>
                  <p className="text-xs text-warm-500">
                    {formatShiftDuration(shift.startTime, shift.endTime)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-warm-800">{shift.avgPulseScore}</p>
                  <p className="text-xs text-warm-500">{shift.actionsCompleted} actions</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
      
      {/* No Data State */}
      {performance.totalShifts === 0 && (
        <motion.div
          className="bg-warm-50 rounded-2xl p-8 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <Clock className="w-12 h-12 text-warm-300 mx-auto mb-3" />
          <p className="font-medium text-warm-600">No shifts recorded yet</p>
          <p className="text-sm text-warm-500 mt-1">
            Toggle this staff member "On" to start tracking their performance.
          </p>
        </motion.div>
      )}
    </div>
  );
}

// ============ STAT CARD ============

interface StatCardProps {
  icon: typeof Zap;
  iconColor: string;
  iconBg: string;
  label: string;
  value: number | string;
}

function StatCard({ icon: Icon, iconColor, iconBg, label, value }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-warm-200 p-4 text-center">
      <div className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center mx-auto mb-2`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <p className="text-2xl font-bold text-warm-800">{value}</p>
      <p className="text-xs text-warm-500">{label}</p>
    </div>
  );
}

// ============ HELPERS ============

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatShiftDuration(start: string, end?: string): string {
  if (!end) return 'In progress';
  
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffHours = Math.round(diffMs / 3600000 * 10) / 10;
  
  const startTime = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const endTime = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  
  return `${startTime} - ${endTime} (${diffHours}h)`;
}

export default StaffDetailView;
