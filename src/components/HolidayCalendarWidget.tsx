import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Calendar,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Lightbulb
} from 'lucide-react';
import holidayService, { Holiday } from '../services/holiday.service';

export function HolidayCalendarWidget() {
  const [upcomingHolidays, setUpcomingHolidays] = useState<Holiday[]>([]);
  const [todaysHolidays, setTodaysHolidays] = useState<Holiday[]>([]);
  const [nextBigHoliday, setNextBigHoliday] = useState<Holiday | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadHolidays();
  }, []);

  const loadHolidays = () => {
    const upcoming = holidayService.getUpcomingHolidays(60);
    const todays = holidayService.getTodaysHolidays();
    const nextBig = holidayService.getNextBigHoliday();
    
    setUpcomingHolidays(upcoming);
    setTodaysHolidays(todays);
    setNextBigHoliday(nextBig);
  };

  const getDaysUntil = (holiday: Holiday): number => {
    return holidayService.getDaysUntil(holiday);
  };

  const getImpactColor = (impact: Holiday['impact']) => {
    switch (impact) {
      case 'very-high': return 'text-red-400 bg-red-500/20 border-red-500/30';
      case 'high': return 'text-orange-400 bg-orange-500/20 border-orange-500/30';
      case 'medium': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
      case 'low': return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
    }
  };

  const getImpactLabel = (impact: Holiday['impact']) => {
    switch (impact) {
      case 'very-high': return 'Very Busy';
      case 'high': return 'Busy';
      case 'medium': return 'Moderate';
      case 'low': return 'Slow';
    }
  };

  const getTypeColor = (type: Holiday['type']) => {
    switch (type) {
      case 'major': return 'bg-purple-500/20 text-purple-400';
      case 'drinking': return 'bg-green-500/20 text-green-400';
      case 'sports': return 'bg-blue-500/20 text-blue-400';
      case 'busy': return 'bg-orange-500/20 text-orange-400';
      case 'slow': return 'bg-gray-500/20 text-gray-400';
    }
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  // Holidays to display (show 3 by default, all when expanded)
  const displayHolidays = expanded ? upcomingHolidays : upcomingHolidays.slice(0, 4);

  return (
    <motion.div
      className="glass-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/20">
            <Calendar className="w-5 h-5 text-purple-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Holiday Calendar</h3>
        </div>
        <span className="text-xs text-gray-500">Next 60 days</span>
      </div>

      {/* Today's Holiday Alert */}
      {todaysHolidays.length > 0 && (
        <motion.div 
          className="mb-4 p-3 rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30"
          initial={{ scale: 0.95 }}
          animate={{ scale: 1 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-purple-300">TODAY</span>
          </div>
          {todaysHolidays.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xl">{h.icon}</span>
              <span className="text-white font-medium">{h.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${getImpactColor(h.impact)}`}>
                {getImpactLabel(h.impact)}
              </span>
            </div>
          ))}
        </motion.div>
      )}

      {/* Next Big Holiday Countdown */}
      {nextBigHoliday && getDaysUntil(nextBigHoliday) > 0 && (
        <div className="mb-4 p-4 rounded-lg bg-white/5 border border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{nextBigHoliday.icon}</span>
              <div>
                <div className="text-white font-medium">{nextBigHoliday.name}</div>
                <div className="text-xs text-gray-400">{formatDate(nextBigHoliday.date)}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-cyan">{getDaysUntil(nextBigHoliday)}</div>
              <div className="text-xs text-gray-400">days away</div>
            </div>
          </div>
          {nextBigHoliday.tips && (
            <div className="mt-3 pt-3 border-t border-white/10 flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-gray-300">{nextBigHoliday.tips}</span>
            </div>
          )}
        </div>
      )}

      {/* Upcoming Holidays List */}
      <div className="space-y-2">
        {displayHolidays.map((holiday, index) => {
          const daysUntil = getDaysUntil(holiday);
          const isToday = daysUntil === 0;
          
          return (
            <motion.div
              key={`${holiday.name}-${index}`}
              className={`p-3 rounded-lg border transition-all ${
                isToday 
                  ? 'bg-purple-500/10 border-purple-500/30' 
                  : 'bg-white/5 border-white/10 hover:border-white/20'
              }`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{holiday.icon}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{holiday.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${getTypeColor(holiday.type)}`}>
                        {holiday.type}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400">{formatDate(holiday.date)}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {/* Impact indicator */}
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${getImpactColor(holiday.impact)}`}>
                    {holiday.impact === 'low' ? (
                      <TrendingDown className="w-3 h-3" />
                    ) : (
                      <TrendingUp className="w-3 h-3" />
                    )}
                    {getImpactLabel(holiday.impact)}
                  </div>
                  
                  {/* Days countdown */}
                  <div className="text-right min-w-[50px]">
                    {isToday ? (
                      <span className="text-xs font-bold text-purple-400">TODAY</span>
                    ) : (
                      <>
                        <div className="text-sm font-bold text-white">{daysUntil}</div>
                        <div className="text-[10px] text-gray-500">days</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Tip on hover/expand */}
              {holiday.tips && expanded && (
                <div className="mt-2 pt-2 border-t border-white/5 flex items-start gap-2">
                  <Lightbulb className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-gray-400">{holiday.tips}</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Expand/Collapse Button */}
      {upcomingHolidays.length > 4 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-4 flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all text-sm"
        >
          {expanded ? (
            <>
              Show Less <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              Show All ({upcomingHolidays.length} holidays) <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}

      {/* No holidays message */}
      {upcomingHolidays.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No major holidays in the next 60 days</p>
        </div>
      )}
    </motion.div>
  );
}
