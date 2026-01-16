/**
 * Historical Scoring Service
 * 
 * 100% historically based Pulse Score - no industry defaults.
 * Each venue competes with ITSELF, not generic benchmarks.
 * 
 * Time Blocks (3-hour blocks):
 * - Morning: 6am-9am
 * - Late Morning: 9am-12pm
 * - Lunch: 12pm-3pm
 * - Afternoon: 3pm-6pm
 * - Evening: 6pm-9pm
 * - Prime: 9pm-12am
 * - Late Night: 12am-3am
 * - After Hours: 3am-6am
 * 
 * Best Block = Highest Occupancy (60%) + Best Retention (40%)
 */

import dynamoDBService from './dynamodb.service';

// ============ TYPES ============

export type TimeBlock = 
  | 'morning'      // 6am-9am
  | 'late_morning' // 9am-12pm
  | 'lunch'        // 12pm-3pm
  | 'afternoon'    // 3pm-6pm
  | 'evening'      // 6pm-9pm
  | 'prime'        // 9pm-12am
  | 'late_night'   // 12am-3am
  | 'after_hours'; // 3am-6am

export type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

export interface TimeBlockKey {
  day: DayOfWeek;
  block: TimeBlock;
}

export interface BestBlockData {
  // When this best block occurred
  date: string;
  day: DayOfWeek;
  block: TimeBlock;
  
  // The conditions during the best block
  avgOccupancy: number;
  peakOccupancy: number;
  avgSound: number;
  avgLight: number;
  totalEntries: number;
  totalExits: number;
  retentionRate: number; // (entries - exits) / entries * 100
  
  // Music during best block
  topGenres: string[];
  songCount: number;
  
  // How we scored this block
  bestScore: number; // occupancy (60%) + retention (40%)
  
  // Data quality
  dataPoints: number;
}

export interface HistoricalScoreResult {
  // The final score
  score: number;
  
  // Learning status
  isLearning: boolean;
  confidence: number; // 0-100, based on weeks of data
  weeksOfData: number;
  
  // Comparison to best
  bestBlock: BestBlockData | null;
  currentVsBest: {
    occupancyMatch: number;   // 0-100
    soundMatch: number;       // 0-100
    lightMatch: number;       // 0-100
    genreMatch: number;       // 0-100
  } | null;
  
  // Status
  status: 'optimal' | 'good' | 'needs_work';
  statusLabel: string;
  
  // Current time block
  currentBlock: TimeBlockKey;
}

// ============ TIME BLOCK DETECTION ============

const DAYS: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function getCurrentTimeBlock(): TimeBlockKey {
  const now = new Date();
  return getTimeBlockFromDate(now);
}

export function getTimeBlockFromDate(date: Date): TimeBlockKey {
  const day = DAYS[date.getDay()];
  const hour = date.getHours();
  
  let block: TimeBlock;
  if (hour >= 6 && hour < 9) block = 'morning';
  else if (hour >= 9 && hour < 12) block = 'late_morning';
  else if (hour >= 12 && hour < 15) block = 'lunch';
  else if (hour >= 15 && hour < 18) block = 'afternoon';
  else if (hour >= 18 && hour < 21) block = 'evening';
  else if (hour >= 21 && hour < 24) block = 'prime';
  else if (hour >= 0 && hour < 3) block = 'late_night';
  else block = 'after_hours'; // 3am-6am
  
  return { day, block };
}

export function getTimeBlockLabel(block: TimeBlock): string {
  const labels: Record<TimeBlock, string> = {
    morning: '6am-9am',
    late_morning: '9am-12pm',
    lunch: '12pm-3pm',
    afternoon: '3pm-6pm',
    evening: '6pm-9pm',
    prime: '9pm-12am',
    late_night: '12am-3am',
    after_hours: '3am-6am',
  };
  return labels[block];
}

// ============ HISTORICAL ANALYSIS ============

interface BlockAnalysis {
  date: string;
  avgOccupancy: number;
  peakOccupancy: number;
  avgSound: number;
  avgLight: number;
  totalEntries: number;
  totalExits: number;
  retentionRate: number;
  topGenres: string[];
  songCount: number;
  dataPoints: number;
  score: number; // occupancy (60%) + retention (40%)
}

class HistoricalScoringService {
  private bestBlockCache: Map<string, { data: BestBlockData | null; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  /**
   * Get the cache key for a venue + time block
   */
  private getCacheKey(venueId: string, blockKey: TimeBlockKey): string {
    return `${venueId}:${blockKey.day}:${blockKey.block}`;
  }
  
  /**
   * Find the best historical instance of a specific time block for a venue.
   * Looks at the last 90 days of data.
   */
  async findBestBlock(venueId: string, blockKey: TimeBlockKey): Promise<BestBlockData | null> {
    // Check cache first
    const cacheKey = this.getCacheKey(venueId, blockKey);
    const cached = this.bestBlockCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.data;
    }
    
    try {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      
      // Fetch all data for the last 90 days
      const allData = await dynamoDBService.getSensorDataByDateRange(
        venueId,
        ninetyDaysAgo,
        now,
        10000
      );
      
      if (!allData || allData.length === 0) {
        this.bestBlockCache.set(cacheKey, { data: null, timestamp: Date.now() });
        return null;
      }
      
      // Group data by date + block
      const blockInstances: Map<string, any[]> = new Map();
      
      for (const record of allData) {
        const recordDate = new Date(record.timestamp);
        const recordBlock = getTimeBlockFromDate(recordDate);
        
        // Only consider records that match the target day and block
        if (recordBlock.day !== blockKey.day || recordBlock.block !== blockKey.block) {
          continue;
        }
        
        const dateStr = recordDate.toISOString().split('T')[0];
        if (!blockInstances.has(dateStr)) {
          blockInstances.set(dateStr, []);
        }
        blockInstances.get(dateStr)!.push(record);
      }
      
      if (blockInstances.size === 0) {
        this.bestBlockCache.set(cacheKey, { data: null, timestamp: Date.now() });
        return null;
      }
      
      // Analyze each instance and find the best one
      const analyses: BlockAnalysis[] = [];
      
      for (const [dateStr, records] of blockInstances) {
        if (records.length < 3) continue; // Need at least 3 data points
        
        // Sort by timestamp
        records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Calculate metrics for this block
        let totalOccupancy = 0;
        let peakOccupancy = 0;
        let totalSound = 0;
        let soundCount = 0;
        let totalLight = 0;
        let lightCount = 0;
        const genreCounts: Map<string, number> = new Map();
        let songCount = 0;
        
        const firstRecord = records[0];
        const lastRecord = records[records.length - 1];
        
        const startEntries = firstRecord.occupancy?.entries ?? 0;
        const endEntries = lastRecord.occupancy?.entries ?? 0;
        const startExits = firstRecord.occupancy?.exits ?? 0;
        const endExits = lastRecord.occupancy?.exits ?? 0;
        
        const totalEntries = endEntries - startEntries;
        const totalExits = endExits - startExits;
        const retentionRate = totalEntries > 0 
          ? Math.max(0, Math.min(100, ((totalEntries - totalExits) / totalEntries) * 100))
          : 50;
        
        for (const record of records) {
          const occ = record.occupancy?.current ?? 0;
          totalOccupancy += occ;
          if (occ > peakOccupancy) peakOccupancy = occ;
          
          const sound = record.sound?.level ?? record.sensors?.sound_level ?? record.decibels;
          if (sound !== undefined && sound !== null && sound > 0) {
            totalSound += sound;
            soundCount++;
          }
          
          const light = record.light?.lux ?? record.sensors?.light_level;
          if (light !== undefined && light !== null) {
            totalLight += light;
            lightCount++;
          }
          
          if (record.currentSong) {
            songCount++;
            // Simple genre detection from song/artist
            const text = ((record.currentSong || '') + ' ' + (record.artist || '')).toLowerCase();
            const detectedGenres = this.detectGenresFromText(text);
            for (const genre of detectedGenres) {
              genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
            }
          }
        }
        
        const avgOccupancy = Math.round(totalOccupancy / records.length);
        const avgSound = soundCount > 0 ? Math.round(totalSound / soundCount) : 0;
        const avgLight = lightCount > 0 ? Math.round(totalLight / lightCount) : 0;
        
        // Get top genres
        const topGenres = Array.from(genreCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([genre]) => genre);
        
        // Calculate best score: occupancy (60%) + retention (40%)
        // Normalize occupancy to 0-100 scale (assume 200 is max)
        const occupancyScore = Math.min(100, (peakOccupancy / 200) * 100);
        const score = (occupancyScore * 0.6) + (retentionRate * 0.4);
        
        analyses.push({
          date: dateStr,
          avgOccupancy,
          peakOccupancy,
          avgSound,
          avgLight,
          totalEntries,
          totalExits,
          retentionRate,
          topGenres,
          songCount,
          dataPoints: records.length,
          score,
        });
      }
      
      if (analyses.length === 0) {
        this.bestBlockCache.set(cacheKey, { data: null, timestamp: Date.now() });
        return null;
      }
      
      // Find the best one
      analyses.sort((a, b) => b.score - a.score);
      const best = analyses[0];
      
      const bestBlockData: BestBlockData = {
        date: best.date,
        day: blockKey.day,
        block: blockKey.block,
        avgOccupancy: best.avgOccupancy,
        peakOccupancy: best.peakOccupancy,
        avgSound: best.avgSound,
        avgLight: best.avgLight,
        totalEntries: best.totalEntries,
        totalExits: best.totalExits,
        retentionRate: best.retentionRate,
        topGenres: best.topGenres,
        songCount: best.songCount,
        bestScore: best.score,
        dataPoints: best.dataPoints,
      };
      
      this.bestBlockCache.set(cacheKey, { data: bestBlockData, timestamp: Date.now() });
      return bestBlockData;
    } catch (error) {
      console.error('Error finding best block:', error);
      return null;
    }
  }
  
  /**
   * Calculate the Pulse Score by comparing current conditions to the best historical block.
   */
  async calculateScore(
    venueId: string,
    currentData: {
      occupancy: number;
      sound: number | null;
      light: number | null;
      currentSong: string | null;
      artist: string | null;
    }
  ): Promise<HistoricalScoreResult> {
    const currentBlock = getCurrentTimeBlock();
    const bestBlock = await this.findBestBlock(venueId, currentBlock);
    
    // Count weeks of data for this block
    const weeksOfData = await this.countWeeksOfData(venueId, currentBlock);
    const confidence = Math.min(100, weeksOfData * 25); // 4 weeks = 100% confidence
    const isLearning = weeksOfData < 4;
    
    // If no historical data, return a baseline score
    if (!bestBlock) {
      return {
        score: 50, // Neutral starting point
        isLearning: true,
        confidence: 0,
        weeksOfData: 0,
        bestBlock: null,
        currentVsBest: null,
        status: 'good',
        statusLabel: 'Learning Your Venue',
        currentBlock,
      };
    }
    
    // Compare current to best
    const currentVsBest = this.compareToBlock(currentData, bestBlock);
    
    // Calculate final score as weighted average of matches
    const score = Math.round(
      (currentVsBest.occupancyMatch * 0.40) + // 40% - crowd is most important
      (currentVsBest.soundMatch * 0.25) +     // 25% - sound sets energy
      (currentVsBest.lightMatch * 0.20) +     // 20% - light sets mood
      (currentVsBest.genreMatch * 0.15)       // 15% - music genre
    );
    
    // Determine status
    let status: 'optimal' | 'good' | 'needs_work';
    let statusLabel: string;
    
    if (score >= 85) {
      status = 'optimal';
      statusLabel = isLearning ? 'Matching Best (Learning)' : 'Matching Your Best 🔥';
    } else if (score >= 60) {
      status = 'good';
      statusLabel = isLearning ? 'Good (Learning)' : 'Close to Your Best';
    } else {
      status = 'needs_work';
      statusLabel = isLearning ? 'Building Data' : 'Room to Improve';
    }
    
    return {
      score,
      isLearning,
      confidence,
      weeksOfData,
      bestBlock,
      currentVsBest,
      status,
      statusLabel,
      currentBlock,
    };
  }
  
  /**
   * Compare current conditions to a historical best block.
   */
  private compareToBlock(
    current: {
      occupancy: number;
      sound: number | null;
      light: number | null;
      currentSong: string | null;
      artist: string | null;
    },
    best: BestBlockData
  ): { occupancyMatch: number; soundMatch: number; lightMatch: number; genreMatch: number } {
    // Occupancy match - how close to best peak
    let occupancyMatch = 0;
    if (best.peakOccupancy > 0) {
      const ratio = current.occupancy / best.peakOccupancy;
      if (ratio >= 1) {
        occupancyMatch = 100; // At or above best
      } else if (ratio >= 0.8) {
        occupancyMatch = 80 + (ratio - 0.8) * 100; // 80-100%
      } else if (ratio >= 0.5) {
        occupancyMatch = 50 + (ratio - 0.5) * 100; // 50-80%
      } else {
        occupancyMatch = ratio * 100; // 0-50%
      }
    }
    
    // Sound match - how close to best average sound
    let soundMatch = 50; // Neutral if no data
    if (current.sound !== null && best.avgSound > 0) {
      const diff = Math.abs(current.sound - best.avgSound);
      if (diff <= 3) soundMatch = 100;
      else if (diff <= 5) soundMatch = 90;
      else if (diff <= 10) soundMatch = 70;
      else if (diff <= 15) soundMatch = 50;
      else soundMatch = Math.max(0, 50 - (diff - 15) * 2);
    }
    
    // Light match - how close to best average light
    let lightMatch = 50; // Neutral if no data
    if (current.light !== null && best.avgLight > 0) {
      const diff = Math.abs(current.light - best.avgLight);
      if (diff <= 30) lightMatch = 100;
      else if (diff <= 50) lightMatch = 90;
      else if (diff <= 100) lightMatch = 70;
      else if (diff <= 150) lightMatch = 50;
      else lightMatch = Math.max(0, 50 - (diff - 150) * 0.2);
    }
    
    // Genre match - does current music match best block's genres
    let genreMatch = 80; // Neutral if no song
    if (current.currentSong || current.artist) {
      const text = ((current.currentSong || '') + ' ' + (current.artist || '')).toLowerCase();
      const currentGenres = this.detectGenresFromText(text);
      
      if (currentGenres.length === 0) {
        genreMatch = 80; // Can't detect, neutral
      } else if (best.topGenres.length === 0) {
        genreMatch = 80; // No historical genre data, neutral
      } else {
        const hasMatch = currentGenres.some(g => 
          best.topGenres.some(bg => g === bg || g.includes(bg) || bg.includes(g))
        );
        genreMatch = hasMatch ? 100 : 60;
      }
    }
    
    return {
      occupancyMatch: Math.round(occupancyMatch),
      soundMatch: Math.round(soundMatch),
      lightMatch: Math.round(lightMatch),
      genreMatch: Math.round(genreMatch),
    };
  }
  
  /**
   * Count how many weeks of data we have for a specific time block.
   */
  private async countWeeksOfData(venueId: string, blockKey: TimeBlockKey): Promise<number> {
    try {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      
      const allData = await dynamoDBService.getSensorDataByDateRange(
        venueId,
        ninetyDaysAgo,
        now,
        10000
      );
      
      if (!allData || allData.length === 0) return 0;
      
      // Find unique dates that have this block
      const datesWithBlock = new Set<string>();
      
      for (const record of allData) {
        const recordDate = new Date(record.timestamp);
        const recordBlock = getTimeBlockFromDate(recordDate);
        
        if (recordBlock.day === blockKey.day && recordBlock.block === blockKey.block) {
          const dateStr = recordDate.toISOString().split('T')[0];
          datesWithBlock.add(dateStr);
        }
      }
      
      return datesWithBlock.size;
    } catch (error) {
      return 0;
    }
  }
  
  /**
   * Simple genre detection from song/artist text.
   */
  private detectGenresFromText(text: string): string[] {
    const genreKeywords: Record<string, string[]> = {
      'hip-hop': ['hip hop', 'rap', 'drake', 'kendrick', 'travis', 'migos', 'cardi', 'lil ', 'future', 'j cole'],
      'pop': ['pop', 'taylor', 'ariana', 'bieber', 'dua lipa', 'ed sheeran', 'bruno mars', 'weeknd'],
      'edm': ['edm', 'house', 'techno', 'dj', 'remix', 'marshmello', 'chainsmokers', 'calvin harris'],
      'r&b': ['r&b', 'rnb', 'sza', 'usher', 'chris brown', 'beyonce', 'soul'],
      'rock': ['rock', 'guitar', 'metal', 'punk', 'foo fighters', 'nirvana'],
      'country': ['country', 'nashville', 'luke', 'morgan wallen', 'carrie'],
      'latin': ['latin', 'reggaeton', 'bad bunny', 'j balvin', 'daddy yankee', 'bachata', 'salsa'],
      'throwback': ['80s', '90s', '2000s', 'classic', 'retro', 'old school', 'throwback'],
    };
    
    const detected: string[] = [];
    for (const [genre, keywords] of Object.entries(genreKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        detected.push(genre);
      }
    }
    return detected;
  }
  
  /**
   * Clear cache for a venue (call when new data arrives).
   */
  clearCache(venueId?: string): void {
    if (venueId) {
      for (const key of this.bestBlockCache.keys()) {
        if (key.startsWith(venueId + ':')) {
          this.bestBlockCache.delete(key);
        }
      }
    } else {
      this.bestBlockCache.clear();
    }
  }
}

export const historicalScoringService = new HistoricalScoringService();
export default historicalScoringService;
