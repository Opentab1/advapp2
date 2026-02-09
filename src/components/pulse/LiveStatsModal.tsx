/**
 * LiveStatsModal - Detailed view of all live venue stats
 * 
 * Shows comprehensive real-time data:
 * - Sound level (dB)
 * - Light level (lux)
 * - Current occupancy
 * - People in/out today
 * - Indoor/outdoor temperature
 * - Humidity
 * - Current song + album art
 * - Google reviews summary
 */

import { motion } from 'framer-motion';
import { 
  Volume2, Sun, Users, UserPlus, UserMinus, 
  Thermometer, Music, Star, Clock, Timer,
  ExternalLink, Smartphone, Watch, Tablet, Laptop, Headphones, Radio
} from 'lucide-react';
import { BottomSheet } from '../common/BottomSheet';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { SoundVisualizer } from '../common/SoundVisualizer';
import { OPTIMAL_RANGES } from '../../utils/constants';
import type { GoogleReviewsData } from '../../services/google-reviews.service';
import type { DeviceBreakdown } from '../../types';

interface LiveStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Sensor data
  decibels: number | null;
  light: number | null;
  outdoorTemp: number | null;
  // Occupancy
  currentOccupancy: number;
  todayEntries: number;
  todayExits: number;
  peakOccupancy: number;
  isBLEEstimated?: boolean; // True if entries/exits are estimated from BLE device
  // BLE device breakdown
  totalDevices?: number | null;
  deviceBreakdown?: DeviceBreakdown | null;
  // BLE dwell time tracking
  bleDwellTime?: number | null;
  longestVisitorMinutes?: number | null;
  totalVisitsTracked?: number | null;
  // Music
  currentSong: string | null;
  artist: string | null;
  albumArt: string | null;
  // Reviews
  reviews: GoogleReviewsData | null;
  // Meta
  lastUpdated: Date | null;
}

export function LiveStatsModal({
  isOpen,
  onClose,
  decibels,
  light,
  outdoorTemp,
  currentOccupancy,
  todayEntries,
  todayExits,
  peakOccupancy,
  isBLEEstimated = false,
  totalDevices,
  deviceBreakdown,
  bleDwellTime,
  longestVisitorMinutes,
  totalVisitsTracked,
  currentSong,
  artist,
  albumArt,
  reviews,
  lastUpdated,
}: LiveStatsModalProps) {
  const secondsAgo = lastUpdated 
    ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000) 
    : null;
  const isFresh = secondsAgo !== null && secondsAgo < 60;
  
  // Normalize sound for visualizer
  const normalizedSound = decibels !== null 
    ? Math.min(100, Math.max(0, ((decibels - 40) / 50) * 100))
    : null;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Live Stats">
      <div className="space-y-6">
        {/* Last Updated */}
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${isFresh ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
          <span className="text-warm-400">
            {isFresh ? 'Live data' : secondsAgo ? `Updated ${secondsAgo}s ago` : 'No data'}
          </span>
        </div>

        {/* ============ ENVIRONMENT ============ */}
        <section>
          <h3 className="text-sm font-semibold text-warm-400 uppercase tracking-wide mb-3">
            Environment
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {/* Sound - show if we have valid data (not 0) */}
            {decibels !== null && decibels !== 0 && (
              <StatCard
                icon={Volume2}
                label="Sound Level"
                value={decibels}
                unit="dB"
                status={getStatus(decibels, OPTIMAL_RANGES.sound)}
                optimal={`${OPTIMAL_RANGES.sound.min}-${OPTIMAL_RANGES.sound.max} dB`}
                extra={<SoundVisualizer level={normalizedSound} height={20} barCount={5} />}
              />
            )}
            
            {/* Light - only show if sensor has data (Pi Zero 2W sends 0) */}
            {light !== null && light > 0 && (
              <StatCard
                icon={Sun}
                label="Light Level"
                value={light}
                unit="lux"
                status={getStatus(light, OPTIMAL_RANGES.light)}
                optimal={`${OPTIMAL_RANGES.light.min}-${OPTIMAL_RANGES.light.max} lux`}
              />
            )}
            
            {/* Outdoor Temp - only show if we have data */}
            {outdoorTemp !== null && outdoorTemp > 0 && (
              <StatCard
                icon={Thermometer}
                label="Outside"
                value={outdoorTemp}
                unit="°F"
                status="neutral"
              />
            )}
          </div>
        </section>

        {/* ============ OCCUPANCY ============ */}
        <section>
          <h3 className="text-sm font-semibold text-warm-400 uppercase tracking-wide mb-3">
            Occupancy
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {/* Current */}
            <div className="col-span-2 p-4 rounded-xl bg-primary/20 border border-primary/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium text-warm-300">Currently Inside</span>
                </div>
                <div className="text-right">
                  <AnimatedNumber 
                    value={currentOccupancy} 
                    className="text-3xl font-bold text-primary"
                  />
                  <p className="text-xs text-warm-400">
                    Peak today: {peakOccupancy}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Entries/Exits - show for camera devices and BLE-estimated devices */}
            {(todayEntries > 0 || todayExits > 0) && (
              <>
                <StatCard
                  icon={UserPlus}
                  label={isBLEEstimated ? "People In ~" : "People In"}
                  value={todayEntries}
                  unit={isBLEEstimated ? "estimated" : "today"}
                  status="neutral"
                  iconColor="text-green-500"
                />
                
                <StatCard
                  icon={UserMinus}
                  label={isBLEEstimated ? "People Out ~" : "People Out"}
                  value={todayExits}
                  unit={isBLEEstimated ? "estimated" : "today"}
                  status="neutral"
                  iconColor="text-red-500"
                />
              </>
            )}
            
            {/* Total Devices - BLE breakdown */}
            {totalDevices && totalDevices > 0 && (
              <StatCard
                icon={Radio}
                label="Devices in Range"
                value={totalDevices}
                unit="bluetooth"
                status="neutral"
                iconColor="text-blue-400"
              />
            )}
          </div>
        </section>
        
        {/* ============ DEVICE BREAKDOWN ============ */}
        {deviceBreakdown && (
          <section>
            <h3 className="text-sm font-semibold text-warm-400 uppercase tracking-wide mb-3">
              Audience Profile
            </h3>
            <div className="bg-warm-800/50 rounded-xl p-4 space-y-3">
              {/* Device breakdown bars */}
              {(() => {
                const total = Object.values(deviceBreakdown).reduce((a, b) => a + b, 0);
                if (total === 0) return null;
                
                const devices = [
                  { key: 'phone', label: 'Phones', icon: Smartphone, count: deviceBreakdown.phone, color: 'bg-primary' },
                  { key: 'watch', label: 'Watches', icon: Watch, count: deviceBreakdown.watch, color: 'bg-purple-500' },
                  { key: 'headphones', label: 'Headphones', icon: Headphones, count: deviceBreakdown.headphones, color: 'bg-pink-500' },
                  { key: 'tablet', label: 'Tablets', icon: Tablet, count: deviceBreakdown.tablet, color: 'bg-blue-500' },
                  { key: 'computer', label: 'Computers', icon: Laptop, count: deviceBreakdown.computer, color: 'bg-green-500' },
                ].filter(d => d.count > 0);
                
                const watchToPhoneRatio = deviceBreakdown.phone > 0 
                  ? Math.round((deviceBreakdown.watch / deviceBreakdown.phone) * 100) 
                  : 0;
                
                const headphonePercent = total > 0 
                  ? Math.round((deviceBreakdown.headphones / total) * 100) 
                  : 0;
                
                return (
                  <>
                    {/* Breakdown bars */}
                    <div className="space-y-2">
                      {devices.map(({ key, label, icon: Icon, count, color }) => {
                        const percent = Math.round((count / total) * 100);
                        return (
                          <div key={key} className="flex items-center gap-3">
                            <Icon className="w-4 h-4 text-warm-400 flex-shrink-0" />
                            <div className="flex-1">
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-warm-300">{label}</span>
                                <span className="text-warm-400">{count} ({percent}%)</span>
                              </div>
                              <div className="h-1.5 bg-warm-700 rounded-full overflow-hidden">
                                <motion.div
                                  className={`h-full ${color} rounded-full`}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${percent}%` }}
                                  transition={{ duration: 0.5, ease: 'easeOut' }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    
                    {/* Insights */}
                    <div className="pt-3 border-t border-warm-700 space-y-2">
                      {watchToPhoneRatio >= 30 && (
                        <div className="flex items-center gap-2 text-xs">
                          <Watch className="w-3.5 h-3.5 text-purple-400" />
                          <span className="text-warm-300">
                            <span className="text-purple-400 font-medium">{watchToPhoneRatio}%</span> watch-to-phone ratio
                            {watchToPhoneRatio >= 50 && <span className="text-warm-500 ml-1">• Affluent crowd</span>}
                          </span>
                        </div>
                      )}
                      {headphonePercent >= 10 && (
                        <div className="flex items-center gap-2 text-xs">
                          <Headphones className="w-3.5 h-3.5 text-pink-400" />
                          <span className="text-warm-300">
                            <span className="text-pink-400 font-medium">{headphonePercent}%</span> wearing earbuds
                            <span className="text-warm-500 ml-1">• May not hear venue music</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </section>
        )}
        
        {/* ============ DWELL TIME (BLE) ============ */}
        {(bleDwellTime || longestVisitorMinutes) && (
          <section>
            <h3 className="text-sm font-semibold text-warm-400 uppercase tracking-wide mb-3">
              Visit Duration
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {bleDwellTime && bleDwellTime > 0 && (
                <div className="bg-warm-800/50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="text-xs text-warm-400">Avg Stay</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {Math.round(bleDwellTime)}
                    <span className="text-sm font-normal text-warm-400 ml-1">min</span>
                  </div>
                  {totalVisitsTracked && totalVisitsTracked > 0 && (
                    <p className="text-[10px] text-warm-500 mt-1">
                      Based on {totalVisitsTracked} visits
                    </p>
                  )}
                </div>
              )}
              {longestVisitorMinutes && longestVisitorMinutes > 0 && (
                <div className="bg-warm-800/50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Timer className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-warm-400">Longest Here</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {Math.round(longestVisitorMinutes)}
                    <span className="text-sm font-normal text-warm-400 ml-1">min</span>
                  </div>
                  <p className="text-[10px] text-warm-500 mt-1">
                    Current visitor
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ============ NOW PLAYING ============ */}
        {currentSong && (
          <section>
            <h3 className="text-sm font-semibold text-warm-400 uppercase tracking-wide mb-3">
              Now Playing
            </h3>
            <motion.div 
              className="p-4 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/20 flex items-center gap-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {/* Album Art */}
              {albumArt ? (
                <motion.img 
                  src={albumArt} 
                  alt="Album art"
                  className="w-16 h-16 rounded-xl object-cover shadow-lg"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Music className="w-8 h-8 text-primary" />
                </div>
              )}
              
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-warm-100 truncate text-lg">
                  {currentSong}
                </p>
                {artist && (
                  <p className="text-sm text-warm-400 truncate">
                    {artist}
                  </p>
                )}
              </div>
              
              {/* Animated equalizer */}
              <div className="flex items-end gap-0.5 h-8">
                {[16, 24, 12, 20, 14, 22].map((height, i) => (
                  <motion.span 
                    key={i}
                    className="w-1.5 bg-primary rounded-full"
                    animate={{ 
                      height: [height * 0.3, height, height * 0.5, height * 0.8],
                    }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                      repeatType: 'reverse',
                      delay: i * 0.08,
                      ease: 'easeInOut',
                    }}
                  />
                ))}
              </div>
            </motion.div>
          </section>
        )}

        {/* ============ REVIEWS ============ */}
        {reviews && (
          <section>
            <h3 className="text-sm font-semibold text-warm-400 uppercase tracking-wide mb-3">
              Google Reviews
            </h3>
            <div className="p-4 rounded-xl bg-warm-700/50 border border-warm-600">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {/* Rating */}
                  <div className="flex items-center gap-1">
                    <Star className="w-6 h-6 text-amber-500 fill-amber-500" />
                    <span className="text-2xl font-bold text-warm-100">
                      {reviews.rating.toFixed(1)}
                    </span>
                  </div>
                  
                  {/* Stars visual */}
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star 
                        key={star}
                        className={`w-4 h-4 ${
                          star <= Math.round(reviews.rating)
                            ? 'text-amber-500 fill-amber-500'
                            : 'text-warm-600'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                
                {/* View on Google */}
                {reviews.url && (
                  <a
                    href={reviews.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <span>View</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              
              <p className="text-sm text-warm-400">
                Based on {reviews.reviewCount.toLocaleString()} reviews
              </p>
            </div>
          </section>
        )}
      </div>
    </BottomSheet>
  );
}

// ============ STAT CARD ============

type Status = 'optimal' | 'warning' | 'critical' | 'neutral';

interface StatCardProps {
  icon: typeof Volume2;
  label: string;
  value: number | null;
  unit: string;
  status: Status;
  optimal?: string;
  extra?: React.ReactNode;
  iconColor?: string;
}

const STATUS_STYLES: Record<Status, { bg: string; border: string; text: string }> = {
  optimal: { 
    bg: 'bg-green-900/20', 
    border: 'border-green-800',
    text: 'text-green-400' 
  },
  warning: { 
    bg: 'bg-amber-900/20', 
    border: 'border-amber-800',
    text: 'text-amber-400' 
  },
  critical: { 
    bg: 'bg-red-900/20', 
    border: 'border-red-800',
    text: 'text-red-400' 
  },
  neutral: { 
    bg: 'bg-warm-700/50', 
    border: 'border-warm-600',
    text: 'text-warm-200' 
  },
};

function StatCard({ icon: Icon, label, value, unit, status, optimal, extra, iconColor }: StatCardProps) {
  const style = STATUS_STYLES[status];
  
  return (
    <div className={`p-3 rounded-xl ${style.bg} border ${style.border} transition-colors`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconColor || (status === 'neutral' ? 'text-warm-500' : style.text)}`} />
          <span className="text-xs text-warm-400">{label}</span>
        </div>
        {extra}
      </div>
      
      <div className="flex items-baseline gap-1">
        {value !== null ? (
          <AnimatedNumber 
            value={value} 
            className={`text-xl font-bold ${style.text}`}
            formatFn={(v) => v.toFixed(0)}
          />
        ) : (
          <span className="text-xl font-bold text-warm-400">--</span>
        )}
        <span className="text-sm text-warm-500">{unit}</span>
      </div>
      
      {optimal && status !== 'neutral' && (
        <p className="text-[10px] text-warm-500 mt-1">
          Optimal: {optimal}
        </p>
      )}
    </div>
  );
}

// ============ HELPERS ============

function getStatus(value: number | null, range: { min: number; max: number }): Status {
  if (value === null) return 'neutral';
  if (value >= range.min && value <= range.max) return 'optimal';
  
  const distanceFromOptimal = value < range.min 
    ? range.min - value 
    : value - range.max;
  const rangeSize = range.max - range.min;
  
  if (distanceFromOptimal > rangeSize * 0.5) return 'critical';
  return 'warning';
}

export default LiveStatsModal;
