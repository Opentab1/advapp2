/**
 * Events Service
 *
 * Analyzes venue's top performing songs to determine vibe,
 * then suggests themed events that match.
 *
 * Events rotate so users see different suggestions each session.
 */

import { getDemoTopSongs, getDemoGenreStats, isDemoAccount } from '../utils/demoData';
import songLogService from './song-log.service';

// ============ TYPES ============

export interface VenueVibe {
  primary: { genre: string; percentage: number };
  secondary: { genre: string; percentage: number } | null;
  tertiary: { genre: string; percentage: number } | null;
  vibeName: string;
  vibeDescription: string;
  songsAnalyzed: number;
  topArtists: string[];
}

export interface EventSuggestion {
  id: string;
  name: string;
  emoji: string;
  description: string;
  whyItFits: string;
  bestNight: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  category: 'theme_night' | 'special_event' | 'recurring' | 'promotion';
  attendanceBoostPct: number;   // % uplift this event type typically drives
  signalReasons: string[];      // Why this was suggested
}

export interface VenueHistoryContext {
  avgGuestsByDow: Record<number, number>; // 0=Sun..6=Sat -> avg totalEntries
  slowestDays: number[];    // DOW indices sorted by avg guests asc
  busiestDays: number[];    // DOW indices sorted by avg guests desc
  avgDrinksPerShift: number;
  totalShiftsAnalyzed: number;
}

export function buildHistoryContext(jobs: import('../services/venuescope.service').VenueScopeJob[]): VenueHistoryContext {
  const nonLive = jobs.filter(j => !j.isLive && j.totalEntries != null && j.totalEntries > 0);
  const dowTotals: Record<number, { sum: number; count: number }> = {};
  for (let i = 0; i < 7; i++) dowTotals[i] = { sum: 0, count: 0 };

  nonLive.forEach(j => {
    const dow = new Date((j.createdAt ?? 0) * 1000).getDay();
    dowTotals[dow].sum += j.totalEntries ?? 0;
    dowTotals[dow].count += 1;
  });

  const avgGuestsByDow: Record<number, number> = {};
  for (let i = 0; i < 7; i++) {
    avgGuestsByDow[i] = dowTotals[i].count > 0 ? Math.round(dowTotals[i].sum / dowTotals[i].count) : 0;
  }

  const dowsSorted = [0, 1, 2, 3, 4, 5, 6].sort((a, b) => avgGuestsByDow[a] - avgGuestsByDow[b]);

  const drinkJobs = jobs.filter(j => !j.isLive && j.totalDrinks != null);
  const avgDrinksPerShift = drinkJobs.length
    ? Math.round(drinkJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0) / drinkJobs.length)
    : 0;

  return {
    avgGuestsByDow,
    slowestDays: dowsSorted.slice(0, 3),
    busiestDays: [...dowsSorted].reverse().slice(0, 3),
    avgDrinksPerShift,
    totalShiftsAnalyzed: nonLive.length,
  };
}

export function predictAttendance(
  event: EventSuggestion,
  history: VenueHistoryContext,
): { low: number; high: number; basis: string } | null {
  if (history.totalShiftsAnalyzed < 3) return null;

  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dowMap: Record<string, number> = {
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
    'Thursday': 4, 'Friday': 5, 'Saturday': 6,
  };

  const dow = dowMap[event.bestNight];
  if (dow === undefined) return null;

  const baseAvg = history.avgGuestsByDow[dow] || 0;
  if (baseAvg === 0) return null;

  const boost = event.attendanceBoostPct / 100;
  const low = Math.round(baseAvg * (1 + boost * 0.5));
  const high = Math.round(baseAvg * (1 + boost * 1.2));

  return {
    low,
    high,
    basis: `Based on avg ${baseAvg} guests on ${DOW_NAMES[dow]}s`,
  };
}

// ============ EVENT DATABASE ============

const EVENT_DATABASE: Record<string, EventSuggestion[]> = {
  'Country': [
    { id: 'country-1', name: 'Line Dance Night', emoji: '🤠', description: 'Teach basic line dances, play country hits all night', whyItFits: 'Your crowd already loves country music', bestNight: 'Thursday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'country-2', name: 'Whiskey Tasting', emoji: '🥃', description: 'Partner with a whiskey brand for a tasting event', whyItFits: 'Tennessee Whiskey is one of your top songs', bestNight: 'Wednesday', difficulty: 'Medium', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'country-3', name: 'Country Karaoke', emoji: '🎤', description: 'Karaoke night featuring only country songs', whyItFits: 'Your crowd loves singalong tracks', bestNight: 'Sunday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'country-4', name: 'Boots & Brews', emoji: '🍺', description: 'Cowboy boot dress code with craft beer specials', whyItFits: 'Matches the Southern party vibe', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'country-5', name: 'Nashville Nights', emoji: '🎸', description: 'Live acoustic country music or Nashville playlist', whyItFits: 'Authentic country experience your crowd craves', bestNight: 'Saturday', difficulty: 'Hard', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'country-6', name: 'Honky Tonk Happy Hour', emoji: '🎵', description: 'Extended happy hour with classic country hits', whyItFits: 'Classic country resonates with your regulars', bestNight: 'Tuesday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'country-7', name: 'Wallen Wednesdays', emoji: '🎤', description: 'Dedicated Morgan Wallen playlist night', whyItFits: 'Morgan Wallen dominates your top songs', bestNight: 'Wednesday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'country-8', name: 'Two-Step Tuesday', emoji: '💃', description: 'Partner dancing with country western music', whyItFits: 'Your crowd stays for danceable country tracks', bestNight: 'Tuesday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
  ],
  'Hip Hop': [
    { id: 'hiphop-1', name: 'Throwback Thursday', emoji: '📼', description: '90s and 2000s hip hop classics all night', whyItFits: 'Classic hip hop gets your crowd moving', bestNight: 'Thursday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'hiphop-2', name: 'R&B Slow Jam Sunday', emoji: '💜', description: 'Chill R&B vibes for a relaxed Sunday', whyItFits: 'R&B tracks perform well at your venue', bestNight: 'Sunday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'hiphop-3', name: 'Open Mic Night', emoji: '🎙️', description: 'Local artists perform original hip hop', whyItFits: 'Hip hop crowd appreciates live talent', bestNight: 'Wednesday', difficulty: 'Medium', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'hiphop-4', name: 'Old School vs New School', emoji: '🔥', description: 'DJ battle between classic and modern hip hop', whyItFits: 'Your playlist spans multiple hip hop eras', bestNight: 'Saturday', difficulty: 'Hard', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'hiphop-5', name: 'Drake Night', emoji: '🦉', description: 'All Drake everything - deep cuts to hits', whyItFits: 'Drake tracks consistently perform at your venue', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'hiphop-6', name: 'Trap Tuesday', emoji: '🔊', description: 'Heavy bass and trap music night', whyItFits: 'High energy tracks keep your crowd engaged', bestNight: 'Tuesday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'hiphop-7', name: 'Hip Hop Karaoke', emoji: '🎤', description: 'Rap your favorite verses with backing tracks', whyItFits: 'Your crowd knows every word', bestNight: 'Thursday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'hiphop-8', name: 'Kendrick vs Cole Night', emoji: '👑', description: 'Battle of the lyricists playlist night', whyItFits: 'Lyrical hip hop resonates with your audience', bestNight: 'Saturday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
  ],
  'Pop': [
    { id: 'pop-1', name: 'Sing-Along Saturday', emoji: '🎤', description: 'Everyone knows the words - pop hits all night', whyItFits: 'Pop anthems get your whole crowd singing', bestNight: 'Saturday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'pop-2', name: 'Decade Night', emoji: '📅', description: 'Pick a decade - 80s, 90s, 2000s, or 2010s', whyItFits: 'Pop nostalgia drives engagement', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'pop-3', name: 'TikTok Hits Night', emoji: '📱', description: 'All the songs that went viral on TikTok', whyItFits: 'Your playlist includes trending tracks', bestNight: 'Thursday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'pop-4', name: 'Lip Sync Battle', emoji: '👄', description: 'Customers compete in lip sync performances', whyItFits: 'Pop songs are perfect for performances', bestNight: 'Wednesday', difficulty: 'Medium', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'pop-5', name: 'Taylor Swift Night', emoji: '✨', description: 'All eras of Taylor Swift', whyItFits: 'Taylor Swift tracks are top performers', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'pop-6', name: 'Brunch & Bangers', emoji: '🥂', description: 'Weekend brunch with upbeat pop music', whyItFits: 'Your pop tracks work across all day parts', bestNight: 'Sunday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'pop-7', name: 'One Hit Wonders', emoji: '⭐', description: 'Night of songs everyone forgot they loved', whyItFits: 'Nostalgic pop drives singalongs', bestNight: 'Tuesday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'pop-8', name: 'Pop Diva Night', emoji: '👸', description: 'Beyoncé, Rihanna, Dua Lipa, and more', whyItFits: 'Female pop artists dominate your playlist', bestNight: 'Saturday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
  ],
  'Electronic': [
    { id: 'edm-1', name: 'Silent Disco', emoji: '🎧', description: 'Wireless headphones, multiple DJ channels', whyItFits: 'EDM fans love immersive experiences', bestNight: 'Saturday', difficulty: 'Hard', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'edm-2', name: 'Glow Party', emoji: '✨', description: 'Blacklights, glow sticks, neon everything', whyItFits: 'Visual experience matches EDM energy', bestNight: 'Friday', difficulty: 'Medium', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'edm-3', name: 'Guest DJ Night', emoji: '🎛️', description: 'Bring in local DJs to spin', whyItFits: 'Your crowd appreciates quality mixing', bestNight: 'Saturday', difficulty: 'Medium', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'edm-4', name: 'EDM Brunch', emoji: '🍳', description: 'Daytime party with house music', whyItFits: 'Electronic music works for day parties', bestNight: 'Sunday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'edm-5', name: 'Bass Drop Friday', emoji: '🔊', description: 'Heavy bass and dubstep night', whyItFits: 'High energy drops keep the floor packed', bestNight: 'Friday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'edm-6', name: 'House Music Monday', emoji: '🏠', description: 'Deep house to start the week', whyItFits: 'House tracks perform well at your venue', bestNight: 'Monday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'edm-7', name: 'Avicii Tribute Night', emoji: '🕊️', description: 'Celebrating the legend with his hits', whyItFits: 'Avicii tracks are crowd favorites', bestNight: 'Thursday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'edm-8', name: 'Techno Underground', emoji: '🌑', description: 'Dark, minimal techno experience', whyItFits: 'Late night crowd appreciates deeper sounds', bestNight: 'Saturday', difficulty: 'Medium', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
  ],
  'Rock': [
    { id: 'rock-1', name: 'Rock Karaoke', emoji: '🎸', description: 'Belt out classic rock anthems', whyItFits: 'Rock songs are made for singalongs', bestNight: 'Thursday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'rock-2', name: 'Vinyl Night', emoji: '💿', description: 'Spin classic rock on vinyl', whyItFits: 'Your crowd appreciates rock authenticity', bestNight: 'Wednesday', difficulty: 'Medium', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'rock-3', name: 'Battle of the Bands', emoji: '⚔️', description: 'Local bands compete for prizes', whyItFits: 'Live rock music would energize your crowd', bestNight: 'Saturday', difficulty: 'Hard', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'rock-4', name: 'Tribute Band Night', emoji: '🎤', description: 'Tribute bands play classic rock sets', whyItFits: 'Classic rock is a top genre for you', bestNight: 'Friday', difficulty: 'Hard', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'rock-5', name: 'Dad Rock Night', emoji: '👨', description: 'Journey, Eagles, Fleetwood Mac, etc.', whyItFits: 'Classic rock resonates with your crowd', bestNight: 'Saturday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'rock-6', name: 'Indie Rock Wednesday', emoji: '🎵', description: 'Alternative and indie rock playlist', whyItFits: 'Alternative tracks perform well here', bestNight: 'Wednesday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'rock-7', name: '80s Hair Metal Night', emoji: '🤘', description: 'Big hair, bigger riffs', whyItFits: '80s rock tracks get strong reactions', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'rock-8', name: 'Acoustic Unplugged', emoji: '🪕', description: 'Stripped down acoustic rock covers', whyItFits: 'Your crowd stays for melodic tracks', bestNight: 'Sunday', difficulty: 'Medium', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
  ],
  'R&B': [
    { id: 'rnb-1', name: 'Slow Jam Sunday', emoji: '💜', description: 'Classic and modern R&B slow jams', whyItFits: 'R&B defines your venue vibe', bestNight: 'Sunday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'rnb-2', name: 'Neo-Soul Night', emoji: '🎷', description: 'SZA, Frank Ocean, Daniel Caesar vibes', whyItFits: 'Neo-soul artists top your charts', bestNight: 'Thursday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'rnb-3', name: '90s R&B Party', emoji: '📼', description: 'Usher, TLC, Boyz II Men, and more', whyItFits: '90s R&B resonates with your crowd', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'rnb-4', name: 'Couples Night', emoji: '💑', description: 'Romantic R&B for date night', whyItFits: 'Your vibe is perfect for couples', bestNight: 'Saturday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'rnb-5', name: 'SZA vs Summer Walker', emoji: '👑', description: 'Battle of modern R&B queens', whyItFits: 'These artists dominate your playlist', bestNight: 'Wednesday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'rnb-6', name: 'Wine & R&B', emoji: '🍷', description: 'Wine specials with smooth R&B', whyItFits: 'Sophisticated vibe matches your crowd', bestNight: 'Thursday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'rnb-7', name: 'Live R&B Showcase', emoji: '🎤', description: 'Local R&B artists perform', whyItFits: 'Your crowd appreciates vocal talent', bestNight: 'Saturday', difficulty: 'Hard', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'rnb-8', name: 'Throwback R&B', emoji: '⏪', description: 'Pre-2010 R&B classics only', whyItFits: 'Classic R&B gets strong engagement', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
  ],
  'Latin': [
    { id: 'latin-1', name: 'Salsa Night', emoji: '💃', description: 'Salsa dancing with lessons early', whyItFits: 'Latin rhythms get your crowd moving', bestNight: 'Thursday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'latin-2', name: 'Reggaeton Thursday', emoji: '🔥', description: 'Bad Bunny, Daddy Yankee, J Balvin', whyItFits: 'Reggaeton tracks are top performers', bestNight: 'Thursday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'latin-3', name: 'Latin Ladies Night', emoji: '👠', description: 'Drink specials for ladies, Latin hits', whyItFits: 'Latin music draws a great crowd', bestNight: 'Friday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'latin-4', name: 'Bachata & Bottles', emoji: '🍾', description: 'Bottle service with bachata music', whyItFits: 'Romantic Latin vibes work for your space', bestNight: 'Saturday', difficulty: 'Medium', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'latin-5', name: 'Bad Bunny Night', emoji: '🐰', description: 'All Bad Bunny, all night', whyItFits: 'Bad Bunny dominates your Latin tracks', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'latin-6', name: 'Cumbia Sundays', emoji: '🎺', description: 'Traditional cumbia and modern fusions', whyItFits: 'Latin classics resonate with your crowd', bestNight: 'Sunday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'latin-7', name: 'Latin Karaoke', emoji: '🎤', description: 'Sing your favorite Spanish songs', whyItFits: 'Your crowd knows every word', bestNight: 'Wednesday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'latin-8', name: 'Perreo Intenso', emoji: '🔊', description: 'High energy reggaeton party', whyItFits: 'Peak energy tracks perform best for you', bestNight: 'Saturday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
  ],
  'Alternative': [
    { id: 'alt-1', name: 'Indie Night', emoji: '🎸', description: 'Independent and alternative artists', whyItFits: 'Alternative tracks define your vibe', bestNight: 'Wednesday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'alt-2', name: 'Emo Night', emoji: '🖤', description: 'My Chemical Romance, Fall Out Boy, etc.', whyItFits: 'Emo/pop-punk gets strong reactions', bestNight: 'Thursday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'alt-3', name: 'Chill Vibes Sunday', emoji: '🌅', description: 'Relaxed alternative and indie', whyItFits: 'Your crowd appreciates laid-back tracks', bestNight: 'Sunday', difficulty: 'Easy', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'alt-4', name: 'Local Band Spotlight', emoji: '🎵', description: 'Feature local alternative bands', whyItFits: 'Your crowd supports local music', bestNight: 'Saturday', difficulty: 'Medium', category: 'special_event', attendanceBoostPct: 30, signalReasons: ['Matches your music vibe'] },
    { id: 'alt-5', name: '2000s Indie Revival', emoji: '📼', description: 'Arctic Monkeys, The Strokes, Killers', whyItFits: '2000s indie is a top performer', bestNight: 'Friday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'alt-6', name: 'Acoustic Sessions', emoji: '🎸', description: 'Stripped down acoustic performances', whyItFits: 'Acoustic tracks drive dwell time', bestNight: 'Tuesday', difficulty: 'Medium', category: 'recurring', attendanceBoostPct: 12, signalReasons: ['Matches your music vibe'] },
    { id: 'alt-7', name: 'Shoegaze & Dream Pop', emoji: '☁️', description: 'Atmospheric and ethereal sounds', whyItFits: 'Your crowd appreciates depth', bestNight: 'Thursday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
    { id: 'alt-8', name: 'Brit Pop Night', emoji: '🇬🇧', description: 'Oasis, Blur, Pulp, and more', whyItFits: 'British alternative resonates here', bestNight: 'Saturday', difficulty: 'Easy', category: 'theme_night', attendanceBoostPct: 20, signalReasons: ['Matches your music vibe'] },
  ],
};

// Vibe names based on genre combinations
const VIBE_NAMES: Record<string, { name: string; description: string }> = {
  'Country': { name: 'Southern Party', description: 'Your crowd loves singalongs, whiskey, and boots on the dance floor.' },
  'Hip Hop': { name: 'Urban Nights', description: 'High energy, great beats, and a crowd that knows every word.' },
  'Pop': { name: 'Mainstream Magic', description: 'Everyone knows the songs, everyone sings along.' },
  'Electronic': { name: 'Electric Energy', description: 'Bass-driven nights that keep the floor packed.' },
  'Rock': { name: 'Rock & Roll', description: 'Classic energy with crowds that love to headbang and sing.' },
  'R&B': { name: 'Smooth Vibes', description: 'Chill atmosphere with soulful sounds and good company.' },
  'Latin': { name: 'Fuego Latino', description: 'Hot rhythms and a crowd that loves to dance.' },
  'Alternative': { name: 'Indie Spirit', description: 'Eclectic taste and appreciation for the unique.' },
};

// ============ SESSION ROTATION ============

function getSessionSeed(): number {
  const STORAGE_KEY = 'events_session_seed';
  let seed = sessionStorage.getItem(STORAGE_KEY);

  if (!seed) {
    seed = Date.now().toString();
    sessionStorage.setItem(STORAGE_KEY, seed);
  }

  return parseInt(seed, 10);
}

function shuffleWithSeed<T>(array: T[], seed: number): T[] {
  const shuffled = [...array];
  let currentIndex = shuffled.length;

  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  while (currentIndex > 0) {
    const randomIndex = Math.floor(seededRandom() * currentIndex);
    currentIndex--;
    [shuffled[currentIndex], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[currentIndex]];
  }

  return shuffled;
}

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DOW_MAP: Record<string, number> = {
  'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
  'Thursday': 4, 'Friday': 5, 'Saturday': 6,
};

// ============ MAIN SERVICE ============

class EventsService {
  private vibeCache: Map<string, { vibe: VenueVibe; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 300000; // 5 minutes

  /**
   * Analyze venue's song data to determine vibe profile
   */
  async getVenueVibe(venueId: string): Promise<VenueVibe> {
    const cached = this.vibeCache.get(venueId);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.vibe;
    }

    if (isDemoAccount(venueId)) {
      const genreStats = getDemoGenreStats();
      const topSongs = getDemoTopSongs(10);
      const totalPlays = genreStats.reduce((sum, g) => sum + g.plays, 0);
      const sorted = [...genreStats].sort((a, b) => b.plays - a.plays);
      const primary = sorted[0];
      const secondary = sorted[1];
      const tertiary = sorted[2];
      const primaryPct = Math.round((primary.plays / totalPlays) * 100);
      const secondaryPct = Math.round((secondary.plays / totalPlays) * 100);
      const tertiaryPct = Math.round((tertiary.plays / totalPlays) * 100);
      const vibeInfo = VIBE_NAMES[primary.genre] || { name: 'Eclectic Mix', description: 'A diverse musical palette.' };
      const topArtists = [...new Set(topSongs.map(s => s.artist))].slice(0, 5);
      const vibe: VenueVibe = {
        primary: { genre: primary.genre, percentage: primaryPct },
        secondary: secondaryPct > 5 ? { genre: secondary.genre, percentage: secondaryPct } : null,
        tertiary: tertiaryPct > 5 ? { genre: tertiary.genre, percentage: tertiaryPct } : null,
        vibeName: vibeInfo.name,
        vibeDescription: vibeInfo.description,
        songsAnalyzed: totalPlays,
        topArtists,
      };
      this.vibeCache.set(venueId, { vibe, timestamp: Date.now() });
      return vibe;
    }

    console.log('🎵 Events: Fetching all songs for vibe analysis...');

    try {
      const genreStats = await songLogService.getGenreStats(20, '90d');
      const topSongs = await songLogService.getTopSongsFromAll(10);
      console.log(`🎵 Events: Got ${genreStats.length} genres, ${topSongs.length} top songs`);

      if (genreStats.length === 0) {
        console.log('🎵 Events: No song data found, using defaults');
        const defaultVibe: VenueVibe = {
          primary: { genre: 'Pop', percentage: 100 },
          secondary: null,
          tertiary: null,
          vibeName: 'Getting Started',
          vibeDescription: 'Play more music to discover your venue\'s vibe!',
          songsAnalyzed: 0,
          topArtists: [],
        };
        return defaultVibe;
      }

      const totalPlays = genreStats.reduce((sum, g) => sum + g.plays, 0);
      const sorted = [...genreStats].sort((a, b) => b.plays - a.plays);
      const primary = sorted[0];
      const secondary = sorted[1];
      const tertiary = sorted[2];
      const primaryPct = totalPlays > 0 ? Math.round((primary.plays / totalPlays) * 100) : 100;
      const secondaryPct = secondary && totalPlays > 0 ? Math.round((secondary.plays / totalPlays) * 100) : 0;
      const tertiaryPct = tertiary && totalPlays > 0 ? Math.round((tertiary.plays / totalPlays) * 100) : 0;
      const vibeInfo = VIBE_NAMES[primary.genre] || { name: 'Eclectic Mix', description: 'A diverse musical palette.' };
      const topArtists = [...new Set(topSongs.map(s => s.artist))].slice(0, 5);
      console.log(`🎵 Events: Vibe detected - ${vibeInfo.name} (${primary.genre} ${primaryPct}%, ${totalPlays} songs)`);

      const vibe: VenueVibe = {
        primary: { genre: primary.genre, percentage: primaryPct },
        secondary: secondary && secondaryPct > 5 ? { genre: secondary.genre, percentage: secondaryPct } : null,
        tertiary: tertiary && tertiaryPct > 5 ? { genre: tertiary.genre, percentage: tertiaryPct } : null,
        vibeName: vibeInfo.name,
        vibeDescription: vibeInfo.description,
        songsAnalyzed: totalPlays,
        topArtists,
      };

      this.vibeCache.set(venueId, { vibe, timestamp: Date.now() });
      return vibe;
    } catch (error) {
      console.error('❌ Events: Error fetching song data:', error);
      return {
        primary: { genre: 'Pop', percentage: 100 },
        secondary: null,
        tertiary: null,
        vibeName: 'Loading...',
        vibeDescription: 'Analyzing your music data...',
        songsAnalyzed: 0,
        topArtists: [],
      };
    }
  }

  /**
   * Get event suggestions based on venue vibe, optionally enriched with history context
   */
  async getEventSuggestions(venueId: string, limit: number = 6, history?: VenueHistoryContext): Promise<EventSuggestion[]> {
    const vibe = await this.getVenueVibe(venueId);
    const sessionSeed = getSessionSeed();

    const primaryEvents = EVENT_DATABASE[vibe.primary.genre] || EVENT_DATABASE['Pop'];
    const secondaryEvents = vibe.secondary
      ? (EVENT_DATABASE[vibe.secondary.genre] || [])
      : [];

    const allEvents = [...primaryEvents, ...secondaryEvents];
    const shuffled = shuffleWithSeed(allEvents, sessionSeed);

    const unique = shuffled.filter((event, index, self) =>
      index === self.findIndex(e => e.id === event.id)
    );

    // Enrich signal reasons for each event
    const enriched: EventSuggestion[] = unique.map(event => {
      const reasons: string[] = [];

      // Music genre reason
      reasons.push(`${vibe.primary.genre} music crowd`);

      if (history && history.totalShiftsAnalyzed > 3) {
        const dow = DOW_MAP[event.bestNight];
        if (dow !== undefined) {
          const isSlowDay = history.slowestDays.includes(dow);
          const isBusyDay = history.busiestDays.includes(dow);
          if (isSlowDay) {
            reasons.unshift(`Boosts your slow ${DOW_NAMES[dow]}s`);
          } else if (isBusyDay) {
            reasons.push(`Capitalizes on busy ${DOW_NAMES[dow]}s`);
          }
        }
        reasons.push(`Based on ${history.totalShiftsAnalyzed} shifts analyzed`);
      }

      return { ...event, signalReasons: reasons };
    });

    // Sort: if history available and has enough data, slow-day events first
    let sorted = enriched;
    if (history && history.totalShiftsAnalyzed > 3) {
      sorted = [...enriched].sort((a, b) => {
        const dowA = DOW_MAP[a.bestNight] ?? -1;
        const dowB = DOW_MAP[b.bestNight] ?? -1;
        const aIsSlow = dowA >= 0 && history.slowestDays.includes(dowA);
        const bIsSlow = dowB >= 0 && history.slowestDays.includes(dowB);
        const aIsBusy = dowA >= 0 && history.busiestDays.includes(dowA);
        const bIsBusy = dowB >= 0 && history.busiestDays.includes(dowB);
        if (aIsSlow && !bIsSlow) return -1;
        if (!aIsSlow && bIsSlow) return 1;
        if (aIsBusy && !bIsBusy) return -1;
        if (!aIsBusy && bIsBusy) return 1;
        return 0;
      });
    }

    return sorted.slice(0, limit);
  }

  /**
   * Get quick win suggestions (easy events)
   */
  async getQuickWins(venueId: string): Promise<EventSuggestion[]> {
    const suggestions = await this.getEventSuggestions(venueId, 10);
    return suggestions.filter(e => e.difficulty === 'Easy').slice(0, 3);
  }

  /**
   * Get all events for a specific category
   */
  async getEventsByCategory(venueId: string, category: EventSuggestion['category']): Promise<EventSuggestion[]> {
    const suggestions = await this.getEventSuggestions(venueId, 20);
    return suggestions.filter(e => e.category === category);
  }

  /**
   * Clear the vibe cache (useful when new song data is available)
   */
  clearCache(): void {
    this.vibeCache.clear();
  }
}

export const eventsService = new EventsService();
export default eventsService;
