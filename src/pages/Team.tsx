/**
 * Team - Staff management and performance tracking
 * 
 * Shows:
 * - Tonight's active staff
 * - Leaderboard (last 30 days)
 * - Individual staff performance
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, Trophy, ChevronRight, Clock, Zap, Target, ArrowLeft } from 'lucide-react';
import { staffService, StaffMember, StaffPerformance } from '../services/staff.service';
import { AddStaffModal } from '../components/team/AddStaffModal';
import { StaffDetailView } from '../components/team/StaffDetailView';

// ============ MAIN COMPONENT ============

export function Team() {
  const [roster, setRoster] = useState<StaffMember[]>([]);
  const [activeStaffIds, setActiveStaffIds] = useState<string[]>([]);
  const [leaderboard, setLeaderboard] = useState<StaffPerformance[]>([]);
  const [teamAvg, setTeamAvg] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  
  // Load data
  useEffect(() => {
    loadData();
  }, []);
  
  const loadData = () => {
    setRoster(staffService.getRoster());
    setActiveStaffIds(staffService.getActiveStaff());
    setLeaderboard(staffService.getLeaderboard());
    setTeamAvg(staffService.getTeamAverage());
  };
  
  const handleToggleActive = (staffId: string) => {
    staffService.toggleStaffActive(staffId);
    setActiveStaffIds(staffService.getActiveStaff());
  };
  
  const handleAddStaff = (name: string, role: StaffMember['role']) => {
    staffService.addStaffMember({ name, role });
    loadData();
    setShowAddModal(false);
  };
  
  const handleDeleteStaff = (staffId: string) => {
    staffService.removeStaffMember(staffId);
    loadData();
    setSelectedStaffId(null);
  };
  
  // Show detail view if staff selected
  if (selectedStaffId) {
    const performance = staffService.getStaffPerformance(selectedStaffId);
    if (performance) {
      return (
        <StaffDetailView
          performance={performance}
          teamAvg={teamAvg}
          onBack={() => setSelectedStaffId(null)}
          onDelete={() => handleDeleteStaff(selectedStaffId)}
        />
      );
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold text-warm-800">Team</h1>
        </div>
        <motion.button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-white text-sm font-medium"
          whileTap={{ scale: 0.95 }}
        >
          <Plus className="w-4 h-4" />
          Add
        </motion.button>
      </motion.div>
      
      {/* Tonight Section */}
      <motion.div
        className="bg-white rounded-2xl border border-warm-200 overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="px-4 py-3 bg-primary/5 border-b border-warm-200">
          <h2 className="font-semibold text-warm-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Tonight
          </h2>
          <p className="text-xs text-warm-500 mt-0.5">
            Tap to toggle who's working
          </p>
        </div>
        
        <div className="p-4">
          {roster.length === 0 ? (
            <div className="text-center py-6">
              <Users className="w-10 h-10 text-warm-300 mx-auto mb-2" />
              <p className="text-warm-500 font-medium">No staff members yet</p>
              <p className="text-sm text-warm-400 mt-1">
                Tap "Add" to add your first team member
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {roster.map((member) => {
                const isActive = activeStaffIds.includes(member.id);
                const activeShift = isActive ? staffService.getActiveShift(member.id) : null;
                const shiftDuration = activeShift 
                  ? getShiftDuration(activeShift.startTime) 
                  : null;
                
                return (
                  <motion.button
                    key={member.id}
                    onClick={() => handleToggleActive(member.id)}
                    className={`
                      w-full p-3 rounded-xl border-2 flex items-center gap-3 transition-all
                      ${isActive 
                        ? 'border-green-500 bg-green-50' 
                        : 'border-warm-200 bg-warm-50 hover:border-warm-300'
                      }
                    `}
                    whileTap={{ scale: 0.98 }}
                  >
                    {/* Avatar */}
                    <div className={`
                      w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold
                      ${isActive ? 'bg-green-500 text-white' : 'bg-warm-300 text-warm-600'}
                    `}>
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 text-left">
                      <p className="font-medium text-warm-800">{member.name}</p>
                      <p className="text-xs text-warm-500 capitalize">{member.role}</p>
                    </div>
                    
                    {/* Status */}
                    {isActive ? (
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-green-600">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-sm font-medium">On</span>
                        </div>
                        {shiftDuration && (
                          <p className="text-xs text-green-600">{shiftDuration}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-warm-400">Off</span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
      
      {/* Leaderboard Section */}
      <motion.div
        className="bg-white rounded-2xl border border-warm-200 overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="px-4 py-3 bg-amber-50 border-b border-warm-200">
          <h2 className="font-semibold text-warm-800 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            Leaderboard
          </h2>
          <p className="text-xs text-warm-500 mt-0.5">
            Last 30 days • Tap for details
          </p>
        </div>
        
        <div className="p-4">
          {leaderboard.length === 0 ? (
            <div className="text-center py-6">
              <Trophy className="w-10 h-10 text-warm-300 mx-auto mb-2" />
              <p className="text-warm-500 font-medium">No performance data yet</p>
              <p className="text-sm text-warm-400 mt-1">
                Toggle staff "On" to start tracking
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((perf, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : null;
                const vsTeam = perf.avgPulseScore - teamAvg;
                
                return (
                  <motion.button
                    key={perf.staffId}
                    onClick={() => setSelectedStaffId(perf.staffId)}
                    className="w-full p-3 rounded-xl bg-warm-50 hover:bg-warm-100 flex items-center gap-3 transition-colors"
                    whileTap={{ scale: 0.98 }}
                  >
                    {/* Rank */}
                    <div className="w-8 text-center">
                      {medal ? (
                        <span className="text-xl">{medal}</span>
                      ) : (
                        <span className="text-warm-400 font-medium">{index + 1}</span>
                      )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 text-left">
                      <p className="font-medium text-warm-800">{perf.staffName}</p>
                      <p className="text-xs text-warm-500">{perf.totalShifts} shifts</p>
                    </div>
                    
                    {/* Score */}
                    <div className="text-right">
                      <p className="text-lg font-bold text-warm-800">{perf.avgPulseScore}</p>
                      {vsTeam !== 0 && (
                        <p className={`text-xs ${vsTeam > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {vsTeam > 0 ? '+' : ''}{vsTeam} vs avg
                        </p>
                      )}
                    </div>
                    
                    <ChevronRight className="w-4 h-4 text-warm-400" />
                  </motion.button>
                );
              })}
            </div>
          )}
          
          {/* Team Average */}
          {leaderboard.length > 0 && (
            <div className="mt-4 pt-4 border-t border-warm-200 flex items-center justify-between">
              <span className="text-sm text-warm-500">Team Average</span>
              <span className="text-lg font-bold text-warm-800">{teamAvg}</span>
            </div>
          )}
        </div>
      </motion.div>
      
      {/* Add Staff Modal */}
      <AddStaffModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddStaff}
      />
    </div>
  );
}

// ============ HELPERS ============

function getShiftDuration(startTime: string): string {
  const start = new Date(startTime);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 60) {
    return `${diffMins}m`;
  }
  
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default Team;
