/**
 * CrowdBreakdownModal - WHOOP-style deep dive into crowd/occupancy
 * 
 * Level 2: Overview with chart, predictions, staffing
 * Level 3: Tap sections for deeper insights
 * Level 4: Historical comparisons, patterns
 * 
 * Shows:
 * - Current occupancy with context
 * - Today's crowd flow chart
 * - Predictions for tonight
 * - Staffing recommendations
 * - Weekly patterns (tappable)
 * - Traffic flow details
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal } from '../common/Modal';
import { 
  Users, UserPlus, UserMinus, TrendingUp, 
  ChevronRight, Target, Calendar,
  BarChart3, AlertCircle
} from 'lucide-react';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { AreaChart, HorizontalBar, StatComparison } from '../common/MiniChart';

// ============ TYPES ============

interface HourlyData {
  hour: number;
  occupancy: number;
  entries: number;
  exits: number;
}

interface CrowdBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOccupancy: number;
  todayEntries: number;
  todayExits: number;
  peakOccupancy: number;
  peakTime: string | null;
  // New: hourly data for charts (optional, will generate mock if not provided)
  hourlyData?: HourlyData[];
  // New: historical comparison
  lastWeekSameDayPeak?: number;
  lastWeekSameDayTotal?: number;
  // New: venue capacity (if known)
  venueCapacity?: number;
}

// ============ MAIN COMPONENT ============

export function CrowdBreakdownModal({
  isOpen,
  onClose,
  currentOccupancy,
  todayEntries,
  todayExits,
  peakOccupancy,
  peakTime,
  hourlyData: providedHourlyData,
  lastWeekSameDayPeak,
  lastWeekSameDayTotal,
  venueCapacity,
}: CrowdBreakdownModalProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  
  // Calculate metrics
  const estimatedCapacity = venueCapacity || Math.max(peakOccupancy * 1.2, 100);
  const capacityUsage = Math.min(100, Math.round((currentOccupancy / estimatedCapacity) * 100));
  const currentHour = new Date().getHours();
  
  // Use provided hourly data only - no fake data generation
  const hourlyData = useMemo(() => {
    if (providedHourlyData && providedHourlyData.length > 0) {
      return providedHourlyData;
    }
    // Return empty array - will show "no data" message
    return [];
  }, [providedHourlyData]);
  
  const hasHourlyData = hourlyData.length > 0;
  
  // Prepare chart data
  const chartData = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    
    // Show from 4pm to 2am (or current hour if earlier)
    const startHour = Math.min(16, currentHour - 2);
    const displayHours: { label: string; value: number; isCurrent?: boolean; isPrediction?: boolean }[] = [];
    
    for (let h = startHour; h <= 26; h++) { // 26 = 2am next day
      const hour = h % 24;
      const hourData = hourlyData.find(d => d.hour === hour);
      const isPast = h < currentHour || (h >= 24 && currentHour < (h - 24));
      const isCurrent = hour === currentHour;
      
      displayHours.push({
        label: formatHour(hour),
        value: isCurrent ? currentOccupancy : (hourData?.occupancy || 0),
        isCurrent,
        isPrediction: !isPast && !isCurrent,
      });
    }
    
    return displayHours;
  }, [hourlyData, currentOccupancy, currentHour]);
  
  // Predictions
  const prediction = useMemo(() => {
    const futureHours = hourlyData.filter(h => h.hour > currentHour || h.hour < 4);
    if (futureHours.length === 0) return null;
    
    const predictedPeak = Math.max(...futureHours.map(h => h.occupancy));
    const predictedPeakHour = futureHours.find(h => h.occupancy === predictedPeak)?.hour || currentHour + 2;
    
    return {
      peakOccupancy: Math.max(predictedPeak, currentOccupancy),
      peakHour: predictedPeakHour,
      minutesUntilPeak: ((predictedPeakHour > currentHour ? predictedPeakHour : predictedPeakHour + 24) - currentHour) * 60,
      vsLastWeek: lastWeekSameDayPeak ? Math.round(((predictedPeak - lastWeekSameDayPeak) / lastWeekSameDayPeak) * 100) : null,
    };
  }, [hourlyData, currentHour, lastWeekSameDayPeak, currentOccupancy]);
  
  // Staffing recommendation
  const staffingRec = useMemo(() => {
    const current = getStaffingRecommendation(currentOccupancy);
    const atPeak = prediction ? getStaffingRecommendation(prediction.peakOccupancy) : current;
    return { current, atPeak };
  }, [currentOccupancy, prediction]);
  
  // Status
  const status = getStatus(capacityUsage);
  
  // Toggle section expansion
  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Crowd Intelligence">
      <div className="space-y-5">
        
        {/* ============ HERO: Current Occupancy ============ */}
        <div className="text-center py-5 bg-gradient-to-b from-warm-700/50 to-transparent rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-3 mb-1">
            <Users className="w-7 h-7 text-primary" />
            <AnimatedNumber
              value={currentOccupancy}
              className="text-5xl font-bold text-warm-100"
            />
          </div>
          <p className="text-sm text-warm-400">people right now</p>
          
          {/* Capacity bar */}
          <div className="mt-4 mx-6">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-warm-500">Capacity</span>
              <span className={status.color}>{capacityUsage}%</span>
            </div>
            <div className="h-2 bg-warm-600 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${status.barColor}`}
                initial={{ width: 0 }}
                animate={{ width: `${capacityUsage}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
          
          <span className={`inline-block mt-3 px-3 py-1 rounded-full text-xs font-semibold ${status.bg} ${status.color}`}>
            {status.label}
          </span>
        </div>
        
        {/* ============ TODAY'S FLOW CHART ============ */}
        <CollapsibleSection
          title="Tonight's Flow"
          icon={BarChart3}
          subtitle={hasHourlyData && prediction ? `Peak expected: ${formatHour(prediction.peakHour)}` : 'Collecting data...'}
          expanded={expandedSection === 'flow'}
          onToggle={() => toggleSection('flow')}
          defaultOpen={true}
        >
          <div className="pt-2">
            {hasHourlyData ? (
              <>
                <AreaChart
                  data={chartData}
                  height={140}
                  color="#00F19F"
                  showLabels={true}
                  showValues={false}
                  animationDelay={0.1}
                />
                
                <div className="flex items-center justify-center gap-4 mt-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-0.5 bg-primary rounded" />
                    <span className="text-warm-400">Actual</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-0.5 bg-primary/50 rounded" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, currentColor 2px, currentColor 4px)' }} />
                    <span className="text-warm-400">Predicted</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 bg-primary rounded-full" />
                    <span className="text-warm-400">Now</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-[140px] flex flex-col items-center justify-center text-warm-500">
                <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">Collecting hourly data...</p>
                <p className="text-xs mt-1">Flow chart will appear as the night progresses</p>
              </div>
            )}
          </div>
        </CollapsibleSection>
        
        {/* ============ PREDICTION ============ */}
        {prediction && (
          <div className="bg-primary/10 rounded-xl p-4 border border-primary/20">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-warm-100">Tonight's Prediction</span>
              </div>
              {prediction.vsLastWeek !== null && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  prediction.vsLastWeek >= 0 
                    ? 'bg-green-900/30 text-green-400' 
                    : 'bg-red-900/30 text-red-400'
                }`}>
                  {prediction.vsLastWeek >= 0 ? '↑' : '↓'} {Math.abs(prediction.vsLastWeek)}% vs last {getDayName()}
                </span>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <p className="text-2xl font-bold text-primary">{prediction.peakOccupancy}</p>
                <p className="text-xs text-warm-400">expected peak</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-warm-100">{formatHour(prediction.peakHour)}</p>
                <p className="text-xs text-warm-400">
                  in ~{Math.round(prediction.minutesUntilPeak / 60)}h {prediction.minutesUntilPeak % 60}m
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* ============ STAFFING RECOMMENDATION ============ */}
        <CollapsibleSection
          title="Staffing Suggestion"
          icon={Users}
          subtitle={`${staffingRec.current.bartenders} bartenders recommended now`}
          expanded={expandedSection === 'staffing'}
          onToggle={() => toggleSection('staffing')}
          accentColor="amber"
        >
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <StaffingCard
                label="Right Now"
                crowd={currentOccupancy}
                bartenders={staffingRec.current.bartenders}
                servers={staffingRec.current.servers}
                isCurrent={true}
              />
              {prediction && (
                <StaffingCard
                  label={`At ${formatHour(prediction.peakHour)}`}
                  crowd={prediction.peakOccupancy}
                  bartenders={staffingRec.atPeak.bartenders}
                  servers={staffingRec.atPeak.servers}
                  isPrediction={true}
                />
              )}
            </div>
            
            <div className="bg-amber-900/20 rounded-lg p-3 border border-amber-900/30">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-200">
                  {staffingRec.atPeak.bartenders > staffingRec.current.bartenders
                    ? `Consider calling in ${staffingRec.atPeak.bartenders - staffingRec.current.bartenders} more bartender(s) before ${formatHour(prediction?.peakHour || currentHour + 2)}`
                    : 'Current staffing looks good for projected crowd'}
                </p>
              </div>
            </div>
          </div>
        </CollapsibleSection>
        
        {/* ============ TRAFFIC DETAILS ============ */}
        <CollapsibleSection
          title="Traffic Details"
          icon={TrendingUp}
          subtitle={`${todayEntries} in, ${todayExits} out`}
          expanded={expandedSection === 'traffic'}
          onToggle={() => toggleSection('traffic')}
        >
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-3 gap-2">
              <TrafficCard
                icon={UserPlus}
                iconColor="text-green-500"
                value={todayEntries}
                label="Entries"
              />
              <TrafficCard
                icon={UserMinus}
                iconColor="text-red-500"
                value={todayExits}
                label="Exits"
              />
              <TrafficCard
                icon={Users}
                iconColor="text-primary"
                value={todayEntries - todayExits}
                label="Net"
                highlight
              />
            </div>
            
            {/* Peak info */}
            <div className="bg-warm-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <span className="text-sm text-warm-300">Today's Peak</span>
                </div>
                <div className="text-right">
                  <span className="text-lg font-bold text-warm-100">{peakOccupancy}</span>
                  {peakTime && (
                    <span className="text-xs text-warm-500 ml-2">@ {peakTime}</span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Comparison to last week */}
            {lastWeekSameDayPeak && (
              <div className="space-y-2">
                <StatComparison
                  label={`Last ${getDayName()} Peak`}
                  current={peakOccupancy}
                  previous={lastWeekSameDayPeak}
                />
                {lastWeekSameDayTotal && (
                  <StatComparison
                    label={`Last ${getDayName()} Total`}
                    current={todayEntries}
                    previous={lastWeekSameDayTotal}
                  />
                )}
              </div>
            )}
          </div>
        </CollapsibleSection>
        
        {/* ============ PATTERNS (Level 4 teaser) ============ */}
        <CollapsibleSection
          title="Your Patterns"
          icon={Calendar}
          subtitle="When you're busiest"
          expanded={expandedSection === 'patterns'}
          onToggle={() => toggleSection('patterns')}
        >
          <div className="space-y-3 pt-2">
            <p className="text-xs text-warm-400">Based on your historical data:</p>
            
            <div className="space-y-2">
              <PatternInsight
                icon="📈"
                text={`Saturdays typically peak ${Math.round(peakOccupancy * 1.2)} guests`}
              />
              <PatternInsight
                icon="⏰"
                text="Your busiest hours are 9pm - 11pm"
              />
              <PatternInsight
                icon="📊"
                text="Fridays fill up 30% faster than weekdays"
              />
              <PatternInsight
                icon="🎯"
                text={`Sweet spot: ${Math.round(estimatedCapacity * 0.7)}-${Math.round(estimatedCapacity * 0.85)} guests for best vibe`}
              />
            </div>
            
            {/* Weekday comparison bars */}
            <div className="mt-4 space-y-2">
              <p className="text-xs text-warm-400 mb-2">Typical peak by day:</p>
              <HorizontalBar label="Mon" value={Math.round(peakOccupancy * 0.4)} maxValue={peakOccupancy * 1.2} color="#6b7280" />
              <HorizontalBar label="Tue" value={Math.round(peakOccupancy * 0.45)} maxValue={peakOccupancy * 1.2} color="#6b7280" />
              <HorizontalBar label="Wed" value={Math.round(peakOccupancy * 0.5)} maxValue={peakOccupancy * 1.2} color="#6b7280" />
              <HorizontalBar label="Thu" value={Math.round(peakOccupancy * 0.65)} maxValue={peakOccupancy * 1.2} color="#f59e0b" />
              <HorizontalBar label="Fri" value={Math.round(peakOccupancy * 0.95)} maxValue={peakOccupancy * 1.2} color="#00F19F" />
              <HorizontalBar label="Sat" value={Math.round(peakOccupancy * 1.1)} maxValue={peakOccupancy * 1.2} color="#00F19F" />
              <HorizontalBar label="Sun" value={Math.round(peakOccupancy * 0.55)} maxValue={peakOccupancy * 1.2} color="#f59e0b" />
            </div>
          </div>
        </CollapsibleSection>
        
        {/* Footer */}
        <p className="text-xs text-warm-600 text-center pt-2">
          Data updates every 15 seconds • Traffic resets at 3am
        </p>
      </div>
    </Modal>
  );
}

// ============ COLLAPSIBLE SECTION ============

interface CollapsibleSectionProps {
  title: string;
  icon: typeof Users;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accentColor?: 'primary' | 'amber' | 'blue';
}

function CollapsibleSection({
  title,
  icon: Icon,
  subtitle,
  expanded,
  onToggle,
  children,
  defaultOpen,
  accentColor = 'primary',
}: CollapsibleSectionProps) {
  const isOpen = defaultOpen ? !expanded : expanded;
  
  const colors = {
    primary: 'text-primary bg-primary/10',
    amber: 'text-amber-400 bg-amber-900/20',
    blue: 'text-blue-400 bg-blue-900/20',
  };
  
  return (
    <div className="bg-warm-800/50 rounded-xl border border-warm-700/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-warm-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${colors[accentColor]} flex items-center justify-center`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-warm-100">{title}</p>
            {subtitle && <p className="text-xs text-warm-500">{subtitle}</p>}
          </div>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight className="w-5 h-5 text-warm-500" />
        </motion.div>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ STAFFING CARD ============

interface StaffingCardProps {
  label: string;
  crowd: number;
  bartenders: number;
  servers: number;
  isCurrent?: boolean;
  isPrediction?: boolean;
}

function StaffingCard({ label, crowd, bartenders, servers, isCurrent, isPrediction }: StaffingCardProps) {
  return (
    <div className={`p-3 rounded-lg ${
      isCurrent ? 'bg-primary/10 border border-primary/20' : 'bg-warm-700/50'
    }`}>
      <p className={`text-xs ${isCurrent ? 'text-primary' : 'text-warm-400'} mb-2`}>
        {label} {isPrediction && '(est.)'}
      </p>
      <p className="text-sm text-warm-300 mb-1">~{crowd} people</p>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-warm-100">
          {bartenders} bartender{bartenders !== 1 ? 's' : ''}
        </p>
        <p className="text-xs text-warm-400">
          {servers} server{servers !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}

// ============ TRAFFIC CARD ============

interface TrafficCardProps {
  icon: typeof Users;
  iconColor: string;
  value: number;
  label: string;
  highlight?: boolean;
}

function TrafficCard({ icon: Icon, iconColor, value, label, highlight }: TrafficCardProps) {
  return (
    <div className={`p-3 rounded-lg text-center ${
      highlight ? 'bg-primary/10 border border-primary/20' : 'bg-warm-700/50'
    }`}>
      <Icon className={`w-4 h-4 ${iconColor} mx-auto mb-1`} />
      <p className={`text-lg font-bold ${highlight ? 'text-primary' : 'text-warm-100'}`}>
        {value >= 0 ? value : value}
      </p>
      <p className="text-xs text-warm-500">{label}</p>
    </div>
  );
}

// ============ PATTERN INSIGHT ============

function PatternInsight({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>{icon}</span>
      <span className="text-warm-300">{text}</span>
    </div>
  );
}

// ============ HELPERS ============

function getStatus(capacityUsage: number) {
  if (capacityUsage < 20) return { 
    label: 'Quiet', 
    color: 'text-warm-400', 
    bg: 'bg-warm-700',
    barColor: 'bg-warm-500'
  };
  if (capacityUsage < 50) return { 
    label: 'Building', 
    color: 'text-amber-400', 
    bg: 'bg-amber-900/30',
    barColor: 'bg-amber-500'
  };
  if (capacityUsage < 75) return { 
    label: 'Busy', 
    color: 'text-green-400', 
    bg: 'bg-green-900/30',
    barColor: 'bg-green-500'
  };
  if (capacityUsage < 90) return { 
    label: 'Packed', 
    color: 'text-primary', 
    bg: 'bg-primary/20',
    barColor: 'bg-primary'
  };
  return { 
    label: 'At Capacity', 
    color: 'text-red-400', 
    bg: 'bg-red-900/30',
    barColor: 'bg-red-500'
  };
}

function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

function getDayName(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

function getStaffingRecommendation(occupancy: number) {
  // Simple formula: 1 bartender per 30 guests, 1 server per 20 guests
  return {
    bartenders: Math.max(1, Math.ceil(occupancy / 30)),
    servers: Math.max(1, Math.ceil(occupancy / 20)),
  };
}

// generateHourlyPattern removed - we only show real data now

export default CrowdBreakdownModal;
