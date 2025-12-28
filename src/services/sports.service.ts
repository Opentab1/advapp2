import type { SportsGame } from '../types';

// ESPN API - Free, reliable, real-time scores
const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports';

// League configurations
const LEAGUES = [
  { sport: 'football', league: 'nfl', name: 'NFL' },
  { sport: 'basketball', league: 'nba', name: 'NBA' },
  { sport: 'hockey', league: 'nhl', name: 'NHL' },
  { sport: 'baseball', league: 'mlb', name: 'MLB' },
  { sport: 'football', league: 'college-football', name: 'NCAAF' },
  { sport: 'basketball', league: 'mens-college-basketball', name: 'NCAAB' },
];

class SportsService {
  private cache: SportsGame[] = [];
  private lastFetch: number = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds

  async getGames(): Promise<SportsGame[]> {
    // Return cache if fresh
    if (this.cache.length > 0 && Date.now() - this.lastFetch < this.CACHE_TTL) {
      return this.cache;
    }

    try {
      console.log('🏈 Fetching live sports data from ESPN...');
      
      const allGames: SportsGame[] = [];

      // Fetch from each league in parallel
      const promises = LEAGUES.map(async ({ sport, league, name }) => {
        try {
          const url = `${ESPN_API}/${sport}/${league}/scoreboard`;
          const response = await fetch(url);
          
          if (!response.ok) {
            console.warn(`⚠️ ESPN ${name} returned ${response.status}`);
            return [];
          }
          
          const data = await response.json();
          return this.transformESPNEvents(data, name);
        } catch (err) {
          console.warn(`Failed to fetch ${name} games:`, err);
          return [];
        }
      });

      const results = await Promise.all(promises);
      results.forEach(games => allGames.push(...games));

      // Sort: live first, then by start time
      const sorted = allGames.sort((a, b) => {
        // Live games first
        if (a.status === 'live' && b.status !== 'live') return -1;
        if (b.status === 'live' && a.status !== 'live') return 1;
        // Then by start time
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });

      console.log(`✅ Loaded ${sorted.length} sports games from ESPN`);
      
      this.cache = sorted;
      this.lastFetch = Date.now();
      
      return sorted;
    } catch (error: any) {
      console.error('❌ Error fetching sports games:', error);
      // Return cache on error
      if (this.cache.length > 0) {
        return this.cache;
      }
      throw new Error(`Failed to fetch sports data: ${error.message}`);
    }
  }

  private transformESPNEvents(data: any, sport: string): SportsGame[] {
    if (!data?.events || !Array.isArray(data.events)) {
      return [];
    }

    return data.events.map((event: any) => {
      const competition = event.competitions?.[0];
      if (!competition) return null;

      const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home');
      const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away');

      if (!homeTeam || !awayTeam) return null;

      // Determine status
      let status: 'scheduled' | 'live' | 'final' = 'scheduled';
      const state = event.status?.type?.state;
      if (state === 'in') {
        status = 'live';
      } else if (state === 'post') {
        status = 'final';
      }

      // Get broadcast info
      const broadcasts = competition.broadcasts?.[0]?.names || [];
      const network = broadcasts.join(', ') || event.status?.type?.shortDetail || '';

      // Get game detail (quarter, period, inning)
      const detail = event.status?.type?.shortDetail || '';

      return {
        id: event.id,
        sport,
        homeTeam: homeTeam.team?.shortDisplayName || homeTeam.team?.displayName || 'TBD',
        awayTeam: awayTeam.team?.shortDisplayName || awayTeam.team?.displayName || 'TBD',
        homeScore: parseInt(homeTeam.score) || 0,
        awayScore: parseInt(awayTeam.score) || 0,
        status,
        startTime: event.date || new Date().toISOString(),
        network: status === 'live' ? detail : network,
        // Extra data for enhanced display
        homeRecord: homeTeam.records?.[0]?.summary || '',
        awayRecord: awayTeam.records?.[0]?.summary || '',
        venue: competition.venue?.fullName || '',
        headline: event.name || `${awayTeam.team?.displayName} @ ${homeTeam.team?.displayName}`,
      };
    }).filter(Boolean) as SportsGame[];
  }

  /**
   * Get only today's games
   */
  async getTodaysGames(): Promise<SportsGame[]> {
    const games = await this.getGames();
    const today = new Date().toDateString();
    
    return games.filter(game => {
      const gameDate = new Date(game.startTime).toDateString();
      return gameDate === today;
    });
  }

  /**
   * Get live games only
   */
  async getLiveGames(): Promise<SportsGame[]> {
    const games = await this.getGames();
    return games.filter(game => game.status === 'live');
  }

  /**
   * Check if there are any big games today
   */
  async hasBigGamesToday(): Promise<boolean> {
    const games = await this.getTodaysGames();
    // Check for playoff/championship indicators in game names
    const bigGameKeywords = ['playoff', 'championship', 'finals', 'bowl', 'wild card', 'division'];
    return games.some(game => 
      bigGameKeywords.some(keyword => 
        game.headline?.toLowerCase().includes(keyword)
      )
    );
  }
}

export default new SportsService();
