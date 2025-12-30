import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Star,
  Clock,
  Users,
  Music,
  Calendar,
  Lightbulb,
  CheckCircle,
  AlertTriangle,
  Target,
  ExternalLink
} from 'lucide-react';
import googleReviewsService from '../services/google-reviews.service';
import authService from '../services/auth.service';
import venueSettingsService from '../services/venue-settings.service';
import holidayService from '../services/holiday.service';
import sportsService from '../services/sports.service';

// WHOOP Color Palette
const COLORS = {
  black: '#000000',
  cardBg: '#1a1a1a',
  traffic: '#0085FF',    // Blue
  reputation: '#00D084', // Green
  engagement: '#8B5CF6', // Purple
  warning: '#FF4444',
  neutral: '#6B6B6B',
  white: '#FFFFFF',
};

type MetricType = 'traffic' | 'reputation' | 'engagement' | null;

interface WeeklyData {
  day: string;
  value: number;
  label: string;
}

export function Insights() {
  const [expandedMetric, setExpandedMetric] = useState<MetricType>(null);
  const [venueScore, setVenueScore] = useState(0);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [reviewsData, setReviewsData] = useState<{ rating: number; reviewCount: number } | null>(null);
  const [upcomingGames, setUpcomingGames] = useState(0);
  const [nextHoliday, setNextHoliday] = useState<{ name: string; daysUntil: number } | null>(null);

  const user = authService.getStoredUser();
  const venueName = user?.venueName || 'Your Venue';
  const venueId = user?.venueId || '';

  // Load data on mount
  useEffect(() => {
    loadData();
  }, [venueId]);

  // Animate score on load
  useEffect(() => {
    const duration = 1500;
    const steps = 60;
    const increment = venueScore / steps;
    let current = 0;
    
    const timer = setInterval(() => {
      current += increment;
      if (current >= venueScore) {
        setAnimatedScore(venueScore);
        clearInterval(timer);
      } else {
        setAnimatedScore(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [venueScore]);

  const loadData = async () => {
    // Load reviews data
    try {
      const address = venueSettingsService.getFormattedAddress(venueId) || '';
      const reviews = await googleReviewsService.getReviews(venueName, address, venueId);
      if (reviews) {
        setReviewsData({ rating: reviews.rating, reviewCount: reviews.reviewCount });
      }
    } catch (e) {
      console.error('Error loading reviews:', e);
    }

    // Load sports games
    try {
      const games = await sportsService.getGames();
      const upcoming = games.filter(g => g.status === 'scheduled').length;
      setUpcomingGames(upcoming);
    } catch (e) {
      console.error('Error loading games:', e);
    }

    // Load holiday data
    const holidays = holidayService.getUpcomingHolidays(1);
    if (holidays.length > 0) {
      const daysUntil = holidayService.getDaysUntil(holidays[0]);
      setNextHoliday({ name: holidays[0].name, daysUntil });
    }

    // Calculate venue score (simplified algorithm)
    calculateVenueScore();
  };

  const calculateVenueScore = () => {
    let score = 65; // Base score
    
    // Boost for good reviews
    if (reviewsData) {
      if (reviewsData.rating >= 4.5) score += 15;
      else if (reviewsData.rating >= 4.0) score += 10;
      else if (reviewsData.rating >= 3.5) score += 5;
    }
    
    // Boost for activity
    if (upcomingGames > 5) score += 5;
    
    // Random variance for demo (in production, use real data)
    score += Math.floor(Math.random() * 10);
    
    setVenueScore(Math.min(100, Math.max(0, score)));
  };

  // Mock weekly data (in production, pull from real metrics)
  const weeklyTraffic: WeeklyData[] = [
    { day: 'M', value: 23, label: 'slow' },
    { day: 'T', value: 45, label: 'avg' },
    { day: 'W', value: 62, label: 'avg' },
    { day: 'T', value: 58, label: 'avg' },
    { day: 'F', value: 91, label: 'peak' },
    { day: 'S', value: 87, label: 'peak' },
    { day: 'S', value: 64, label: 'avg' },
  ];

  const getScoreColor = (score: number) => {
    if (score >= 67) return COLORS.reputation;
    if (score >= 34) return '#FFAA00';
    return COLORS.warning;
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return 'Thriving';
    if (score >= 67) return 'Performing above average';
    if (score >= 50) return 'Steady performance';
    if (score >= 34) return 'Room for improvement';
    return 'Needs attention';
  };

  const scoreColor = getScoreColor(animatedScore);

  return (
    <div className="max-w-4xl mx-auto" style={{ background: COLORS.black, minHeight: '100vh' }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="pb-24"
      >
        {/* Hero: Venue Pulse Score */}
        <div className="flex flex-col items-center pt-8 pb-10">
          {/* Score Ring */}
          <div className="relative w-48 h-48 mb-6">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="#1a1a1a"
                strokeWidth="8"
              />
              {/* Score arc */}
              <motion.circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={scoreColor}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(animatedScore / 100) * 264} 264`}
                initial={{ strokeDasharray: '0 264' }}
                animate={{ strokeDasharray: `${(animatedScore / 100) * 264} 264` }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
                style={{
                  filter: `drop-shadow(0 0 10px ${scoreColor}40)`,
                }}
              />
            </svg>
            {/* Score text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span 
                className="text-5xl font-bold"
                style={{ color: COLORS.white }}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
              >
                {animatedScore}
              </motion.span>
              <span className="text-xs font-medium tracking-wider" style={{ color: COLORS.neutral }}>
                VENUE PULSE
              </span>
            </div>
          </div>
          
          {/* Score description */}
          <motion.p 
            className="text-base font-medium mb-1"
            style={{ color: COLORS.white }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            {getScoreLabel(animatedScore)}
          </motion.p>
          <motion.p 
            className="text-sm flex items-center gap-1"
            style={{ color: COLORS.neutral }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            <TrendingUp className="w-4 h-4" style={{ color: COLORS.reputation }} />
            <span style={{ color: COLORS.reputation }}>↑ 5</span> from last week
          </motion.p>
        </div>

        {/* Three Metric Cards */}
        <div className="px-4 mb-8">
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              type="traffic"
              label="TRAFFIC"
              value="82"
              subtext="↑ 12%"
              subLabel="vs last wk"
              color={COLORS.traffic}
              onClick={() => setExpandedMetric('traffic')}
            />
            <MetricCard
              type="reputation"
              label="REPUTATION"
              value={reviewsData?.rating.toFixed(1) || '4.6'}
              subtext="★★★★☆"
              subLabel={`${reviewsData?.reviewCount || 523} reviews`}
              color={COLORS.reputation}
              onClick={() => setExpandedMetric('reputation')}
            />
            <MetricCard
              type="engagement"
              label="ENGAGEMENT"
              value="71"
              subtext="↑ 8%"
              subLabel="47 min avg"
              color={COLORS.engagement}
              onClick={() => setExpandedMetric('engagement')}
            />
          </div>
        </div>

        {/* Weekly Timeline */}
        <div className="px-4 mb-8">
          <div className="p-4 rounded-2xl" style={{ background: COLORS.cardBg }}>
            <h3 className="text-sm font-semibold mb-4" style={{ color: COLORS.neutral }}>
              THIS WEEK
            </h3>
            <div className="flex justify-between items-end h-24">
              {weeklyTraffic.map((day, i) => {
                const height = (day.value / 100) * 100;
                const isToday = i === new Date().getDay() - 1 || (i === 6 && new Date().getDay() === 0);
                return (
                  <div key={i} className="flex flex-col items-center gap-2 flex-1">
                    <div 
                      className="w-full max-w-[24px] rounded-t-md transition-all"
                      style={{ 
                        height: `${height}%`,
                        background: isToday 
                          ? COLORS.traffic 
                          : day.value >= 80 
                            ? COLORS.reputation 
                            : day.value >= 50 
                              ? '#FFAA00' 
                              : COLORS.neutral,
                        opacity: isToday ? 1 : 0.6,
                      }}
                    />
                    <span 
                      className="text-xs font-medium"
                      style={{ color: isToday ? COLORS.white : COLORS.neutral }}
                    >
                      {day.day}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Insight Cards */}
        <div className="px-4 space-y-3 mb-8">
          {/* Opportunity Card */}
          {upcomingGames > 0 && (
            <InsightCard
              type="opportunity"
              title="NFL Playoffs Saturday"
              subtitle="Cowboys vs Eagles · 4:30 PM"
              description="Venues like yours see +40% traffic"
              icon={<Target className="w-5 h-5" />}
            />
          )}

          {/* Winning Card */}
          <InsightCard
            type="winning"
            title="Friday nights are your superpower"
            subtitle="9-11 PM · Country music · 2.1x average traffic"
            icon={<CheckCircle className="w-5 h-5" />}
          />

          {/* Watch Card */}
          <InsightCard
            type="watch"
            title="Monday traffic dropped 15%"
            subtitle="Consider a weekly special or trivia night"
            icon={<AlertTriangle className="w-5 h-5" />}
          />
        </div>

        {/* Coach Tip */}
        <div className="px-4 mb-8">
          <div 
            className="p-5 rounded-2xl border"
            style={{ 
              background: 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)',
              borderColor: '#333',
            }}
          >
            <div className="flex items-start gap-4">
              <div 
                className="p-2 rounded-lg"
                style={{ background: `${COLORS.engagement}20` }}
              >
                <Lightbulb className="w-5 h-5" style={{ color: COLORS.engagement }} />
              </div>
              <div className="flex-1">
                <p className="text-sm leading-relaxed" style={{ color: COLORS.white }}>
                  {nextHoliday ? (
                    <>
                      <strong>{nextHoliday.name}</strong> is in {nextHoliday.daysUntil} days. 
                      Your peak capacity was 127 last year. Staff accordingly.
                    </>
                  ) : (
                    <>
                      <strong>Pro tip:</strong> Your busiest hour is Friday 9 PM. 
                      Consider adding a second bartender for the weekend rush.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="px-4">
          <div className="grid grid-cols-4 gap-2">
            <QuickStat label="Top Genre" value="Country" />
            <QuickStat label="Peak Hour" value="9 PM Fri" />
            <QuickStat label="Avg Visit" value="47 min" />
            <QuickStat label="Trend" value="↗️ +0.2" />
          </div>
        </div>

        {/* Expanded Metric Modal */}
        <AnimatePresence>
          {expandedMetric && (
            <MetricModal
              type={expandedMetric}
              onClose={() => setExpandedMetric(null)}
              reviewsData={reviewsData}
              weeklyTraffic={weeklyTraffic}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// Metric Card Component
function MetricCard({ 
  type, 
  label, 
  value, 
  subtext, 
  subLabel, 
  color, 
  onClick 
}: {
  type: string;
  label: string;
  value: string;
  subtext: string;
  subLabel: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      className="p-4 rounded-2xl text-left transition-all relative overflow-hidden"
      style={{ background: COLORS.cardBg }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Subtle glow effect */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          background: `radial-gradient(circle at 50% 120%, ${color}40 0%, transparent 60%)`,
        }}
      />
      
      <div className="relative z-10">
        <span 
          className="text-[10px] font-semibold tracking-wider block mb-3"
          style={{ color: COLORS.neutral }}
        >
          {label}
        </span>
        <span 
          className="text-3xl font-bold block mb-1"
          style={{ color }}
        >
          {value}
        </span>
        <span 
          className="text-sm block mb-1"
          style={{ color }}
        >
          {subtext}
        </span>
        <span 
          className="text-[10px] block"
          style={{ color: COLORS.neutral }}
        >
          {subLabel}
        </span>
        
        {/* Chevron indicator */}
        <ChevronRight 
          className="absolute bottom-4 right-3 w-4 h-4"
          style={{ color: COLORS.neutral }}
        />
      </div>
    </motion.button>
  );
}

// Insight Card Component
function InsightCard({ 
  type, 
  title, 
  subtitle, 
  description, 
  icon 
}: {
  type: 'opportunity' | 'winning' | 'watch';
  title: string;
  subtitle: string;
  description?: string;
  icon: React.ReactNode;
}) {
  const colors = {
    opportunity: { bg: COLORS.traffic, border: `${COLORS.traffic}50` },
    winning: { bg: COLORS.reputation, border: `${COLORS.reputation}50` },
    watch: { bg: '#FFAA00', border: '#FFAA0050' },
  };

  const labels = {
    opportunity: '🎯 OPPORTUNITY',
    winning: '✅ WINNING',
    watch: '⚠️ WATCH',
  };

  return (
    <motion.div
      className="p-4 rounded-2xl border-l-4"
      style={{ 
        background: COLORS.cardBg,
        borderLeftColor: colors[type].bg,
      }}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      whileHover={{ x: 4 }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <span 
            className="text-[10px] font-bold tracking-wider block mb-2"
            style={{ color: colors[type].bg }}
          >
            {labels[type]}
          </span>
          <h4 className="text-sm font-semibold mb-1" style={{ color: COLORS.white }}>
            {title}
          </h4>
          <p className="text-xs" style={{ color: COLORS.neutral }}>
            {subtitle}
          </p>
          {description && (
            <p className="text-xs mt-2" style={{ color: colors[type].bg }}>
              {description}
            </p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 mt-1" style={{ color: COLORS.neutral }} />
      </div>
    </motion.div>
  );
}

// Quick Stat Component
function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div 
      className="p-3 rounded-xl text-center"
      style={{ background: COLORS.cardBg }}
    >
      <span 
        className="text-[9px] font-semibold tracking-wider block mb-1"
        style={{ color: COLORS.neutral }}
      >
        {label}
      </span>
      <span 
        className="text-sm font-bold"
        style={{ color: COLORS.white }}
      >
        {value}
      </span>
    </div>
  );
}

// Metric Modal (Expanded View)
function MetricModal({ 
  type, 
  onClose, 
  reviewsData,
  weeklyTraffic,
}: {
  type: MetricType;
  onClose: () => void;
  reviewsData: { rating: number; reviewCount: number } | null;
  weeklyTraffic: WeeklyData[];
}) {
  if (!type) return null;

  const config = {
    traffic: {
      color: COLORS.traffic,
      title: 'TRAFFIC',
      value: '82',
      subtitle: '↑ 12% vs last week',
    },
    reputation: {
      color: COLORS.reputation,
      title: 'REPUTATION',
      value: reviewsData?.rating.toFixed(1) || '4.6',
      subtitle: `${reviewsData?.reviewCount || 523} Google reviews`,
    },
    engagement: {
      color: COLORS.engagement,
      title: 'ENGAGEMENT',
      value: '71',
      subtitle: '↑ 8% vs last week',
    },
  };

  const { color, title, value, subtitle } = config[type];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      {/* Modal Content */}
      <motion.div
        className="relative w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ background: COLORS.black, maxHeight: '90vh' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: '#222' }}
        >
          <button 
            onClick={onClose}
            className="flex items-center gap-2 text-sm"
            style={{ color: COLORS.white }}
          >
            ← {title}
          </button>
          <button onClick={onClose}>
            <X className="w-6 h-6" style={{ color: COLORS.neutral }} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 60px)' }}>
          {/* Main Score */}
          <div className="text-center mb-8">
            <motion.span 
              className="text-6xl font-bold block mb-2"
              style={{ color }}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              {value}{type === 'reputation' && ' ★'}
            </motion.span>
            <span className="text-sm" style={{ color: COLORS.neutral }}>
              {subtitle}
            </span>
          </div>

          {/* Type-specific content */}
          {type === 'traffic' && (
            <>
              {/* Weekly Chart */}
              <div className="mb-6">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  THIS WEEK
                </h4>
                <div className="flex justify-between items-end h-32">
                  {weeklyTraffic.map((day, i) => (
                    <div key={i} className="flex flex-col items-center gap-2 flex-1">
                      <span className="text-xs font-bold" style={{ color: COLORS.white }}>
                        {day.value}
                      </span>
                      <div 
                        className="w-8 rounded-t-md"
                        style={{ 
                          height: `${(day.value / 100) * 80}px`,
                          background: day.value >= 80 ? color : `${color}60`,
                        }}
                      />
                      <span className="text-xs" style={{ color: COLORS.neutral }}>
                        {day.day}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Peak Times */}
              <div className="mb-6">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  PEAK TIMES
                </h4>
                <div className="space-y-3">
                  <PeakTimeBar label="Friday 9-11 PM" value={91} max={100} color={color} />
                  <PeakTimeBar label="Saturday 8-10 PM" value={87} max={100} color={color} />
                  <PeakTimeBar label="Thursday 7-9 PM" value={58} max={100} color={color} />
                </div>
              </div>

              {/* Insight */}
              <div 
                className="p-4 rounded-xl"
                style={{ background: `${color}15` }}
              >
                <div className="flex items-start gap-3">
                  <Lightbulb className="w-5 h-5 mt-0.5" style={{ color }} />
                  <div>
                    <h5 className="text-sm font-semibold mb-1" style={{ color: COLORS.white }}>
                      Insight
                    </h5>
                    <p className="text-xs" style={{ color: COLORS.neutral }}>
                      Friday + Country music = your best combo. Consider extending Friday happy hour.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {type === 'reputation' && (
            <>
              {/* Rating Breakdown */}
              <div className="mb-6">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  RATING BREAKDOWN
                </h4>
                <div className="space-y-2">
                  <RatingBar stars={5} count={312} total={reviewsData?.reviewCount || 523} color={color} />
                  <RatingBar stars={4} count={128} total={reviewsData?.reviewCount || 523} color={color} />
                  <RatingBar stars={3} count={52} total={reviewsData?.reviewCount || 523} color={color} />
                  <RatingBar stars={2} count={18} total={reviewsData?.reviewCount || 523} color={color} />
                  <RatingBar stars={1} count={13} total={reviewsData?.reviewCount || 523} color={color} />
                </div>
              </div>

              {/* Trend */}
              <div className="mb-6 p-4 rounded-xl" style={{ background: COLORS.cardBg }}>
                <h4 className="text-xs font-semibold mb-2" style={{ color: COLORS.neutral }}>
                  TREND
                </h4>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" style={{ color }} />
                  <span style={{ color: COLORS.white }}>+0.2 stars in last 90 days</span>
                </div>
                <p className="text-xs mt-2" style={{ color: COLORS.neutral }}>
                  Above area average (4.2)
                </p>
              </div>

              {/* Recent Mentions */}
              <div className="mb-6">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  RECENT MENTIONS
                </h4>
                <div className="space-y-2">
                  <MentionItem type="positive" text="Great cocktails" count={23} />
                  <MentionItem type="positive" text="Friendly staff" count={18} />
                  <MentionItem type="negative" text="Slow service" count={4} />
                </div>
              </div>

              {/* CTA */}
              <button 
                className="w-full p-4 rounded-xl flex items-center justify-center gap-2"
                style={{ background: COLORS.cardBg }}
                onClick={() => window.open('https://www.google.com/maps', '_blank')}
              >
                <span style={{ color: COLORS.white }}>View on Google Maps</span>
                <ExternalLink className="w-4 h-4" style={{ color: COLORS.neutral }} />
              </button>
            </>
          )}

          {type === 'engagement' && (
            <>
              {/* Average Dwell Time */}
              <div className="mb-6 text-center">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  AVERAGE DWELL TIME
                </h4>
                <span className="text-4xl font-bold" style={{ color: COLORS.white }}>
                  47 min
                </span>
                <p className="text-xs mt-2" style={{ color: COLORS.neutral }}>
                  (industry avg: 38 min)
                </p>
              </div>

              {/* What Keeps Them */}
              <div className="mb-6">
                <h4 className="text-xs font-semibold mb-4" style={{ color: COLORS.neutral }}>
                  WHAT KEEPS THEM
                </h4>
                <div className="space-y-3">
                  <EngagementFactor icon="🎵" label="Live music nights" bonus="+18 min" color={color} />
                  <EngagementFactor icon="🏈" label="Game days" bonus="+12 min" color={color} />
                  <EngagementFactor icon="🍺" label="Happy hour" bonus="+8 min" color={color} />
                </div>
              </div>

              {/* Top Genres */}
              <div className="p-4 rounded-xl" style={{ background: COLORS.cardBg }}>
                <h4 className="text-xs font-semibold mb-3" style={{ color: COLORS.neutral }}>
                  TOP GENRES PLAYED
                </h4>
                <div className="flex flex-wrap gap-2">
                  <GenreChip label="Country" percent={34} color={color} />
                  <GenreChip label="Rock" percent={28} />
                  <GenreChip label="Pop" percent={22} />
                  <GenreChip label="Other" percent={16} />
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// Helper Components
function PeakTimeBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const width = (value / max) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-32" style={{ color: COLORS.white }}>{label}</span>
      <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: COLORS.cardBg }}>
        <div 
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold w-8" style={{ color: COLORS.white }}>{value}</span>
    </div>
  );
}

function RatingBar({ stars, count, total, color }: { stars: number; count: number; total: number; color: string }) {
  const width = (count / total) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-8" style={{ color: COLORS.white }}>{stars} ★</span>
      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: COLORS.cardBg }}>
        <div 
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
      <span className="text-xs w-8 text-right" style={{ color: COLORS.neutral }}>{count}</span>
    </div>
  );
}

function MentionItem({ type, text, count }: { type: 'positive' | 'negative'; text: string; count: number }) {
  const emoji = type === 'positive' ? '👍' : '👎';
  const color = type === 'positive' ? COLORS.reputation : COLORS.warning;
  return (
    <div 
      className="flex items-center justify-between p-3 rounded-lg"
      style={{ background: COLORS.cardBg }}
    >
      <span style={{ color: COLORS.white }}>
        {emoji} "{text}"
      </span>
      <span className="text-xs" style={{ color }}>
        {count}x mentioned
      </span>
    </div>
  );
}

function EngagementFactor({ icon, label, bonus, color }: { icon: string; label: string; bonus: string; color: string }) {
  return (
    <div 
      className="flex items-center justify-between p-3 rounded-lg"
      style={{ background: COLORS.cardBg }}
    >
      <span style={{ color: COLORS.white }}>
        {icon} {label}
      </span>
      <span className="text-sm font-bold" style={{ color }}>
        {bonus}
      </span>
    </div>
  );
}

function GenreChip({ label, percent, color }: { label: string; percent: number; color?: string }) {
  return (
    <span 
      className="px-3 py-1 rounded-full text-xs font-medium"
      style={{ 
        background: color ? `${color}30` : COLORS.cardBg,
        color: color || COLORS.neutral,
      }}
    >
      {label} {percent}%
    </span>
  );
}
