import type { SportsGame } from '../types';

// TheSportsDB Free API - No API key required for public tier
const SPORTS_DB_API = 'https://www.thesportsdb.com/api/v1/json/3';

class SportsService {
  async getGames(): Promise<SportsGame[]> {
    try {
      console.log('🏈 Fetching live sports data from TheSportsDB...');
      
      // Fetch live games from multiple leagues
      const leagues = [
        { id: '4391', name: 'NFL' },      // NFL
        { id: '4380', name: 'NHL' },      // NHL  
        { id: '4424', name: 'MLB' },      // MLB
        { id: '4387', name: 'NBA' },      // NBA
        { id: '4346', name: 'MLS' }       // MLS
      ];

      const allGames: SportsGame[] = [];

      // Fetch events for each league
      for (const league of leagues) {
        try {
          const response = await fetch(`${SPORTS_DB_API}/eventsseason.php?id=${league.id}&s=2024-2025`);
          if (!response.ok) continue;
          
          const data = await response.json();
          if (data.events) {
            const games = this.transformSportsDBEvents(data.events, league.name);
            allGames.push(...games);
          }
        } catch (err) {
          console.warn(`Failed to fetch ${league.name} games:`, err);
        }
      }

      if (allGames.length === 0) {
        throw new Error('No sports data available');
      }

      // Sort by start time and filter to recent/upcoming games
      const now = new Date();
      const relevantGames = allGames
        .filter(game => {
          const gameTime = new Date(game.startTime);
          const hoursDiff = (now.getTime() - gameTime.getTime()) / (1000 * 60 * 60);
          // Show games from last 6 hours or future games
          return hoursDiff < 6 || gameTime > now;
        })
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .slice(0, 10); // Limit to 10 games

      console.log(`✅ Loaded ${relevantGames.length} sports games`);
      return relevantGames;
    } catch (error: any) {
      console.error('❌ Error fetching sports games:', error);
      throw new Error(`Failed to fetch sports data: ${error.message}`);
    }
  }

  private transformSportsDBEvents(events: any[], sport: string): SportsGame[] {
    const now = new Date();
    
    return events.map(event => {
      const gameTime = new Date(event.strTimestamp || event.dateEvent);
      const hasStarted = gameTime < now;
      const isFinished = event.intHomeScore !== null && event.intAwayScore !== null;
      
      let status: 'scheduled' | 'live' | 'final' = 'scheduled';
      if (isFinished) {
        status = 'final';
      } else if (hasStarted && !isFinished) {
        status = 'live';
      }

      return {
        id: event.idEvent,
        sport,
        homeTeam: event.strHomeTeam || 'TBD',
        awayTeam: event.strAwayTeam || 'TBD',
        homeScore: parseInt(event.intHomeScore) || 0,
        awayScore: parseInt(event.intAwayScore) || 0,
        status,
        startTime: gameTime.toISOString(),
        network: event.strStatus || 'TBD'
      };
    }).filter(game => game.homeTeam !== 'TBD' && game.awayTeam !== 'TBD');
  }
}

export default new SportsService();
