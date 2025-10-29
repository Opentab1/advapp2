import type { SportsGame } from '../types';

class SportsService {
  async getGames(): Promise<SportsGame[]> {
    try {
      // In production, integrate with ESPN API, The Sports DB, or similar
      // For now, return mock data
      return this.getMockGames();
    } catch (error) {
      console.error('Error fetching sports games:', error);
      return this.getMockGames();
    }
  }

  private getMockGames(): SportsGame[] {
    const now = new Date();
    const games: SportsGame[] = [
      {
        id: '1',
        sport: 'NFL',
        homeTeam: 'Tampa Bay Buccaneers',
        awayTeam: 'New Orleans Saints',
        homeScore: 24,
        awayScore: 21,
        status: 'live',
        startTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        network: 'FOX'
      },
      {
        id: '2',
        sport: 'NHL',
        homeTeam: 'Tampa Bay Lightning',
        awayTeam: 'Florida Panthers',
        homeScore: 3,
        awayScore: 2,
        status: 'live',
        startTime: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
        network: 'ESPN'
      },
      {
        id: '3',
        sport: 'MLB',
        homeTeam: 'Tampa Bay Rays',
        awayTeam: 'Boston Red Sox',
        homeScore: 0,
        awayScore: 0,
        status: 'scheduled',
        startTime: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
        network: 'MLB Network'
      }
    ];

    return games;
  }
}

export default new SportsService();
