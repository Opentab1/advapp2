/**
 * Email Report Service
 * Generates weekly venue performance reports for email delivery
 * All data is 100% based on real sensor data - no fabrication
 */

import dynamoDBService from './dynamodb.service';
import songLogService from './song-log.service';
import { calculateDwellTimeFromHistory } from '../utils/dwellTime';
import type { SensorData } from '../types';

export interface WeeklyReportData {
  venueName: string;
  venueId: string;
  reportPeriod: {
    start: string;
    end: string;
    label: string;
  };
  highlights: {
    totalGuests: number;
    guestsDelta: number; // % change vs previous week
    peakNight: string;
    peakNightGuests: number;
    avgStayMinutes: number | null;
    avgStayDelta: number | null; // minutes change vs previous week
    bestHour: string;
  };
  music: {
    topRetentionSongs: Array<{
      song: string;
      artist: string;
      retentionRate: number;
    }>;
    topGenre: string;
    topGenrePlayCount: number;
    topGenreRetention: number;
  };
  dailyScores: Array<{
    day: string;
    shortDay: string;
    score: number;
    guests: number;
  }>;
  weeklyAvgScore: number;
  weeklyScoreDelta: number;
  insights: string[];
  suggestedActions: string[];
}

export interface EmailReportConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  reportType: 'full' | 'summary' | 'alerts';
  lastSentAt?: string;
}

class EmailReportService {
  /**
   * Generate weekly report data for a venue
   * All calculations use real sensor data
   */
  async generateWeeklyReport(venueId: string, venueName: string): Promise<WeeklyReportData | null> {
    try {
      console.log(`📧 Generating weekly report for ${venueName} (${venueId})`);

      // Get this week's data (last 7 days)
      const thisWeekData = await dynamoDBService.getHistoricalSensorData(venueId, '7d');
      if (!thisWeekData?.data || thisWeekData.data.length === 0) {
        console.log(`📧 No data available for ${venueId}`);
        return null;
      }

      // Get previous week's data for comparison (8-14 days ago)
      const prevWeekData = await this.getPreviousWeekData(venueId);

      // Calculate report period
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 7);
      
      const reportPeriod = {
        start: weekStart.toISOString().split('T')[0],
        end: now.toISOString().split('T')[0],
        label: `${this.formatDate(weekStart)} - ${this.formatDate(now)}`
      };

      // Calculate highlights
      const highlights = await this.calculateHighlights(thisWeekData.data, prevWeekData);

      // Get music data
      const music = await this.getMusicData(venueId);

      // Calculate daily scores
      const dailyScores = this.calculateDailyScores(thisWeekData.data);

      // Calculate weekly average score
      const weeklyAvgScore = dailyScores.length > 0
        ? Math.round(dailyScores.reduce((sum, d) => sum + d.score, 0) / dailyScores.length)
        : 0;

      // Calculate previous week's average for comparison
      const prevWeeklyAvgScore = prevWeekData.length > 0
        ? Math.round(this.calculateDailyScores(prevWeekData).reduce((sum, d) => sum + d.score, 0) / 7)
        : weeklyAvgScore;

      const weeklyScoreDelta = weeklyAvgScore - prevWeeklyAvgScore;

      // Generate insights based on real data
      const insights = this.generateInsights(highlights, music, dailyScores);

      // Generate suggested actions based on real data
      const suggestedActions = this.generateSuggestedActions(highlights, music, dailyScores);

      return {
        venueName,
        venueId,
        reportPeriod,
        highlights,
        music,
        dailyScores,
        weeklyAvgScore,
        weeklyScoreDelta,
        insights,
        suggestedActions
      };
    } catch (error) {
      console.error(`📧 Error generating report for ${venueId}:`, error);
      return null;
    }
  }

  /**
   * Get previous week's data (8-14 days ago)
   */
  private async getPreviousWeekData(venueId: string): Promise<SensorData[]> {
    try {
      const data = await dynamoDBService.getHistoricalSensorData(venueId, '14d');
      if (!data?.data) return [];

      const now = new Date();
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

      return data.data.filter(d => {
        const timestamp = new Date(d.timestamp);
        return timestamp >= fourteenDaysAgo && timestamp < eightDaysAgo;
      });
    } catch {
      return [];
    }
  }

  /**
   * Calculate highlight metrics
   */
  private async calculateHighlights(
    thisWeekData: SensorData[],
    prevWeekData: SensorData[]
  ): Promise<WeeklyReportData['highlights']> {
    // Sort by timestamp
    const sorted = [...thisWeekData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Calculate total guests using cumulative counter logic
    const withEntries = sorted.filter(d => d.occupancy?.entries !== undefined);
    let totalGuests = 0;
    if (withEntries.length >= 2) {
      const earliest = withEntries[0];
      const latest = withEntries[withEntries.length - 1];
      totalGuests = Math.max(0, (latest.occupancy?.entries || 0) - (earliest.occupancy?.entries || 0));
    }

    // Calculate previous week's guests for comparison
    let prevGuests = 0;
    if (prevWeekData.length >= 2) {
      const prevSorted = [...prevWeekData].sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const prevWithEntries = prevSorted.filter(d => d.occupancy?.entries !== undefined);
      if (prevWithEntries.length >= 2) {
        prevGuests = Math.max(0, 
          (prevWithEntries[prevWithEntries.length - 1].occupancy?.entries || 0) - 
          (prevWithEntries[0].occupancy?.entries || 0)
        );
      }
    }

    const guestsDelta = prevGuests > 0 
      ? Math.round(((totalGuests - prevGuests) / prevGuests) * 100) 
      : 0;

    // Find peak night
    const dailyGuests = this.calculateDailyGuests(sorted);
    const peakDay = dailyGuests.reduce((max, day) => 
      day.guests > max.guests ? day : max, 
      { day: 'N/A', guests: 0 }
    );

    // Calculate average stay time
    const avgStayMinutes = calculateDwellTimeFromHistory(sorted, 7 * 24);

    // Calculate previous week's avg stay for comparison
    const prevAvgStay = prevWeekData.length > 0 
      ? calculateDwellTimeFromHistory(prevWeekData, 7 * 24)
      : null;
    
    const avgStayDelta = avgStayMinutes !== null && prevAvgStay !== null
      ? Math.round(avgStayMinutes - prevAvgStay)
      : null;

    // Find best hour (highest average occupancy)
    const hourlyOccupancy = this.calculateHourlyOccupancy(sorted);
    const bestHour = hourlyOccupancy.reduce((max, hour) => 
      hour.avgOccupancy > max.avgOccupancy ? hour : max,
      { hour: 0, avgOccupancy: 0 }
    );

    return {
      totalGuests,
      guestsDelta,
      peakNight: peakDay.day,
      peakNightGuests: peakDay.guests,
      avgStayMinutes,
      avgStayDelta,
      bestHour: `${bestHour.hour % 12 || 12}${bestHour.hour >= 12 ? 'pm' : 'am'}-${(bestHour.hour + 1) % 12 || 12}${(bestHour.hour + 1) >= 12 ? 'pm' : 'am'}`
    };
  }

  /**
   * Calculate guests per day
   */
  private calculateDailyGuests(data: SensorData[]): Array<{ day: string; guests: number }> {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const result: Array<{ day: string; guests: number }> = [];

    // Group by day
    const byDay = new Map<string, SensorData[]>();
    data.forEach(d => {
      const date = new Date(d.timestamp);
      const dayKey = date.toISOString().split('T')[0];
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey)!.push(d);
    });

    // Calculate guests for each day
    byDay.forEach((dayData, dateKey) => {
      const date = new Date(dateKey);
      const dayName = days[date.getDay()];
      
      const sorted = dayData.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      const withEntries = sorted.filter(d => d.occupancy?.entries !== undefined);
      let guests = 0;
      if (withEntries.length >= 2) {
        guests = Math.max(0,
          (withEntries[withEntries.length - 1].occupancy?.entries || 0) -
          (withEntries[0].occupancy?.entries || 0)
        );
      }
      
      result.push({ day: dayName, guests });
    });

    return result;
  }

  /**
   * Calculate hourly occupancy averages
   */
  private calculateHourlyOccupancy(data: SensorData[]): Array<{ hour: number; avgOccupancy: number }> {
    const hourlyData = new Map<number, number[]>();

    data.forEach(d => {
      const hour = new Date(d.timestamp).getHours();
      const occupancy = d.occupancy?.current || 0;
      
      if (!hourlyData.has(hour)) hourlyData.set(hour, []);
      hourlyData.get(hour)!.push(occupancy);
    });

    const result: Array<{ hour: number; avgOccupancy: number }> = [];
    hourlyData.forEach((occupancies, hour) => {
      const avg = occupancies.reduce((sum, o) => sum + o, 0) / occupancies.length;
      result.push({ hour, avgOccupancy: Math.round(avg) });
    });

    return result.sort((a, b) => a.hour - b.hour);
  }

  /**
   * Get music performance data
   */
  private async getMusicData(_venueId: string): Promise<WeeklyReportData['music']> {
    try {
      // Get highest performing songs
      const topSongs = await songLogService.getHighestPerformingSongs(3, '7d');
      
      // Get genre stats
      const genreStats = await songLogService.getGenreStats(1, '7d');

      return {
        topRetentionSongs: topSongs.map(s => ({
          song: s.song,
          artist: s.artist,
          retentionRate: s.retentionRate
        })),
        topGenre: genreStats[0]?.genre || 'N/A',
        topGenrePlayCount: genreStats[0]?.plays || 0,
        topGenreRetention: genreStats[0]?.avgRetention || 100
      };
    } catch {
      return {
        topRetentionSongs: [],
        topGenre: 'N/A',
        topGenrePlayCount: 0,
        topGenreRetention: 100
      };
    }
  }

  /**
   * Calculate daily Pulse scores
   */
  private calculateDailyScores(data: SensorData[]): WeeklyReportData['dailyScores'] {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    // Group by day
    const byDay = new Map<string, SensorData[]>();
    data.forEach(d => {
      const date = new Date(d.timestamp);
      const dayKey = date.toISOString().split('T')[0];
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey)!.push(d);
    });

    const result: WeeklyReportData['dailyScores'] = [];

    // Calculate score and guests for each day
    byDay.forEach((dayData, dateKey) => {
      const date = new Date(dateKey);
      const dayIndex = date.getDay();
      
      // Calculate average score for the day (simplified - based on occupancy performance)
      const avgOccupancy = dayData.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / dayData.length;
      const maxOccupancy = Math.max(...dayData.map(d => d.occupancy?.current || 0));
      
      // Score based on how full the venue was relative to its peak
      const score = maxOccupancy > 0 ? Math.round((avgOccupancy / maxOccupancy) * 100) : 0;
      
      // Calculate guests
      const sorted = dayData.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const withEntries = sorted.filter(d => d.occupancy?.entries !== undefined);
      let guests = 0;
      if (withEntries.length >= 2) {
        guests = Math.max(0,
          (withEntries[withEntries.length - 1].occupancy?.entries || 0) -
          (withEntries[0].occupancy?.entries || 0)
        );
      }

      result.push({
        day: days[dayIndex],
        shortDay: shortDays[dayIndex],
        score: Math.min(100, Math.max(0, score)),
        guests
      });
    });

    // Sort by day of week (Mon-Sun)
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return result.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
  }

  /**
   * Generate insights based on real data
   */
  private generateInsights(
    highlights: WeeklyReportData['highlights'],
    music: WeeklyReportData['music'],
    dailyScores: WeeklyReportData['dailyScores']
  ): string[] {
    const insights: string[] = [];

    // Find best performing day
    const bestDay = dailyScores.reduce((max, d) => d.score > max.score ? d : max, dailyScores[0]);
    if (bestDay) {
      insights.push(
        `${bestDay.day} ${highlights.bestHour} was your best performing hour — ` +
        `peaked at ${highlights.peakNightGuests} guests with ${bestDay.score} Pulse Score`
      );
    }

    // Music insight
    if (music.topGenre !== 'N/A' && music.topGenreRetention > 100) {
      insights.push(
        `${music.topGenre} music correlated with best crowd retention this week ` +
        `(+${(music.topGenreRetention - 100).toFixed(1)}% avg)`
      );
    }

    // Guest trend insight
    if (highlights.guestsDelta !== 0) {
      const direction = highlights.guestsDelta > 0 ? 'up' : 'down';
      insights.push(
        `Guest count ${direction} ${Math.abs(highlights.guestsDelta)}% compared to last week`
      );
    }

    // Stay time insight
    if (highlights.avgStayDelta !== null && highlights.avgStayDelta !== 0) {
      const direction = highlights.avgStayDelta > 0 ? 'improved' : 'decreased';
      insights.push(
        `Average stay time ${direction} by ${Math.abs(highlights.avgStayDelta)} minutes vs last week`
      );
    }

    return insights.slice(0, 4); // Max 4 insights
  }

  /**
   * Generate suggested actions based on real data
   */
  private generateSuggestedActions(
    highlights: WeeklyReportData['highlights'],
    music: WeeklyReportData['music'],
    dailyScores: WeeklyReportData['dailyScores']
  ): string[] {
    const actions: string[] = [];

    // Music suggestion
    if (music.topGenre !== 'N/A' && music.topGenreRetention > 100) {
      actions.push(
        `Play more ${music.topGenre} during peak hours (${highlights.bestHour})`
      );
    }

    // Top song suggestion
    if (music.topRetentionSongs.length > 0) {
      const topSong = music.topRetentionSongs[0];
      actions.push(
        `"${topSong.song}" is your crowd favorite — keep it in rotation`
      );
    }

    // Slowest day suggestion
    const slowestDay = dailyScores.reduce((min, d) => d.guests < min.guests ? d : min, dailyScores[0]);
    if (slowestDay && slowestDay.guests < highlights.peakNightGuests * 0.3) {
      actions.push(
        `Your quietest night was ${slowestDay.day} — consider a promotion or event`
      );
    }

    // Stay time suggestion
    if (highlights.avgStayMinutes !== null && highlights.avgStayMinutes < 30) {
      actions.push(
        `Average stay is ${highlights.avgStayMinutes} min — consider ways to increase engagement`
      );
    }

    return actions.slice(0, 3); // Max 3 actions
  }

  /**
   * Generate HTML email content
   */
  generateEmailHTML(report: WeeklyReportData, dashboardUrl: string): string {
    const scoreBar = (score: number) => {
      const filled = Math.round(score / 10);
      return '█'.repeat(filled) + '░'.repeat(10 - filled);
    };

    const retentionDisplay = (rate: number) => {
      const delta = rate - 100;
      return delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
    };

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Report - ${report.venueName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #ffffff; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #16213e; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #0f3460 0%, #16213e 100%); padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; color: #00d9ff; }
    .header p { margin: 10px 0 0; color: #8b9dc3; font-size: 14px; }
    .section { padding: 20px 30px; border-bottom: 1px solid #2a3f5f; }
    .section-title { font-size: 16px; color: #00d9ff; margin: 0 0 15px; display: flex; align-items: center; gap: 8px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
    .metric { background: #1a2744; padding: 15px; border-radius: 8px; }
    .metric-value { font-size: 28px; font-weight: bold; color: #00d9ff; }
    .metric-label { font-size: 12px; color: #8b9dc3; margin-top: 5px; }
    .metric-delta { font-size: 12px; margin-top: 5px; }
    .delta-up { color: #10b981; }
    .delta-down { color: #ef4444; }
    .song-list { list-style: none; padding: 0; margin: 0; }
    .song-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #2a3f5f; }
    .song-item:last-child { border-bottom: none; }
    .song-name { font-weight: 500; }
    .song-artist { font-size: 12px; color: #8b9dc3; }
    .song-retention { color: #10b981; font-weight: bold; }
    .score-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-family: monospace; }
    .score-bar { color: #00d9ff; letter-spacing: 2px; }
    .score-value { color: #8b9dc3; min-width: 30px; text-align: right; }
    .insight { padding: 10px 0; border-bottom: 1px solid #2a3f5f; font-size: 14px; }
    .insight:last-child { border-bottom: none; }
    .action { background: #1a2744; padding: 12px 15px; border-radius: 8px; margin-bottom: 10px; font-size: 14px; border-left: 3px solid #00d9ff; }
    .cta-button { display: inline-block; background: #00d9ff; color: #16213e; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 10px; }
    .footer { text-align: center; padding: 20px; color: #8b9dc3; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Report</h1>
      <p>${report.venueName} — ${report.reportPeriod.label}</p>
    </div>

    <div class="section">
      <h2 class="section-title">🎯 This Week's Highlights</h2>
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-value">${report.highlights.totalGuests.toLocaleString()}</div>
          <div class="metric-label">Total Guests</div>
          ${report.highlights.guestsDelta !== 0 ? `
            <div class="metric-delta ${report.highlights.guestsDelta > 0 ? 'delta-up' : 'delta-down'}">
              ${report.highlights.guestsDelta > 0 ? '↑' : '↓'} ${Math.abs(report.highlights.guestsDelta)}% vs last week
            </div>
          ` : ''}
        </div>
        <div class="metric">
          <div class="metric-value">${report.highlights.peakNight}</div>
          <div class="metric-label">Peak Night</div>
          <div class="metric-delta" style="color: #8b9dc3;">${report.highlights.peakNightGuests} guests</div>
        </div>
        <div class="metric">
          <div class="metric-value">${report.highlights.avgStayMinutes !== null ? `${report.highlights.avgStayMinutes} min` : 'N/A'}</div>
          <div class="metric-label">Avg Stay Time</div>
          ${report.highlights.avgStayDelta !== null && report.highlights.avgStayDelta !== 0 ? `
            <div class="metric-delta ${report.highlights.avgStayDelta > 0 ? 'delta-up' : 'delta-down'}">
              ${report.highlights.avgStayDelta > 0 ? '↑' : '↓'} ${Math.abs(report.highlights.avgStayDelta)} min
            </div>
          ` : ''}
        </div>
        <div class="metric">
          <div class="metric-value">${report.highlights.bestHour}</div>
          <div class="metric-label">Best Hour</div>
        </div>
      </div>
    </div>

    ${report.music.topRetentionSongs.length > 0 ? `
    <div class="section">
      <h2 class="section-title">🎵 Music That Worked</h2>
      <ul class="song-list">
        ${report.music.topRetentionSongs.map((song, i) => `
          <li class="song-item">
            <div>
              <div class="song-name">${i + 1}. "${song.song}"</div>
              <div class="song-artist">${song.artist}</div>
            </div>
            <div class="song-retention">${retentionDisplay(song.retentionRate)} retention</div>
          </li>
        `).join('')}
      </ul>
      ${report.music.topGenre !== 'N/A' ? `
        <p style="margin: 15px 0 0; font-size: 14px; color: #8b9dc3;">
          <strong style="color: #a855f7;">Top Genre:</strong> ${report.music.topGenre} 
          (${report.music.topGenrePlayCount} plays, ${retentionDisplay(report.music.topGenreRetention)} avg retention)
        </p>
      ` : ''}
    </div>
    ` : ''}

    <div class="section">
      <h2 class="section-title">📈 Pulse Score Trend</h2>
      ${report.dailyScores.map(day => `
        <div class="score-row">
          <span style="min-width: 40px;">${day.shortDay}</span>
          <span class="score-bar">${scoreBar(day.score)}</span>
          <span class="score-value">${day.score}</span>
        </div>
      `).join('')}
      <p style="margin: 15px 0 0; text-align: center; font-size: 14px;">
        <strong>Weekly Average: ${report.weeklyAvgScore}</strong>
        ${report.weeklyScoreDelta !== 0 ? `
          <span class="${report.weeklyScoreDelta > 0 ? 'delta-up' : 'delta-down'}">
            (${report.weeklyScoreDelta > 0 ? '↑' : '↓'} ${Math.abs(report.weeklyScoreDelta)} points)
          </span>
        ` : ''}
      </p>
    </div>

    ${report.insights.length > 0 ? `
    <div class="section">
      <h2 class="section-title">💡 Insights</h2>
      ${report.insights.map(insight => `
        <div class="insight">• ${insight}</div>
      `).join('')}
    </div>
    ` : ''}

    ${report.suggestedActions.length > 0 ? `
    <div class="section">
      <h2 class="section-title">🎯 Suggested Actions</h2>
      ${report.suggestedActions.map((action, i) => `
        <div class="action">${i + 1}. ${action}</div>
      `).join('')}
    </div>
    ` : ''}

    <div class="section" style="text-align: center; border-bottom: none;">
      <a href="${dashboardUrl}" class="cta-button">View Full Dashboard →</a>
    </div>

    <div class="footer">
      <p>This report was generated automatically based on your venue's sensor data.</p>
      <p>To adjust your email preferences, visit the Settings page in your dashboard.</p>
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generate plain text email content (fallback)
   */
  generateEmailText(report: WeeklyReportData, dashboardUrl: string): string {
    const lines: string[] = [
      `📊 WEEKLY REPORT - ${report.venueName}`,
      `${report.reportPeriod.label}`,
      '',
      '═══════════════════════════════════════',
      '',
      '🎯 THIS WEEK\'S HIGHLIGHTS',
      '',
      `Total Guests: ${report.highlights.totalGuests.toLocaleString()}${report.highlights.guestsDelta !== 0 ? ` (${report.highlights.guestsDelta > 0 ? '↑' : '↓'}${Math.abs(report.highlights.guestsDelta)}%)` : ''}`,
      `Peak Night: ${report.highlights.peakNight} (${report.highlights.peakNightGuests} guests)`,
      `Avg Stay: ${report.highlights.avgStayMinutes !== null ? `${report.highlights.avgStayMinutes} min` : 'N/A'}`,
      `Best Hour: ${report.highlights.bestHour}`,
      '',
    ];

    if (report.music.topRetentionSongs.length > 0) {
      lines.push('🎵 MUSIC THAT WORKED', '');
      report.music.topRetentionSongs.forEach((song, i) => {
        const delta = song.retentionRate - 100;
        lines.push(`${i + 1}. "${song.song}" - ${song.artist} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% retention)`);
      });
      lines.push('');
    }

    lines.push('📈 PULSE SCORE TREND', '');
    report.dailyScores.forEach(day => {
      const bar = '█'.repeat(Math.round(day.score / 10)) + '░'.repeat(10 - Math.round(day.score / 10));
      lines.push(`${day.shortDay}: ${bar} ${day.score}`);
    });
    lines.push('', `Weekly Average: ${report.weeklyAvgScore}`, '');

    if (report.insights.length > 0) {
      lines.push('💡 INSIGHTS', '');
      report.insights.forEach(insight => lines.push(`• ${insight}`));
      lines.push('');
    }

    if (report.suggestedActions.length > 0) {
      lines.push('🎯 SUGGESTED ACTIONS', '');
      report.suggestedActions.forEach((action, i) => lines.push(`${i + 1}. ${action}`));
      lines.push('');
    }

    lines.push('═══════════════════════════════════════', '');
    lines.push(`View Full Dashboard: ${dashboardUrl}`);

    return lines.join('\n');
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

export default new EmailReportService();
