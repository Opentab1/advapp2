import type { WeeklyReport, WeeklyMetrics, ReportInsight } from '../types';
import { isDemoAccount, generateDemoWeeklyReport, generateDemoReportHistory } from '../utils/demoData';
import authService from './auth.service';

class AIReportService {
  async generateWeeklyReport(
    weekStart: Date,
    weekEnd: Date,
    metrics: WeeklyMetrics
  ): Promise<WeeklyReport> {
    // ✨ DEMO MODE: Return realistic demo report
    const user = authService.getStoredUser();
    if (isDemoAccount(user?.venueId)) {
      console.log('🎭 Demo mode detected - returning generated AI report');
      await new Promise(resolve => setTimeout(resolve, 800)); // Simulate AI processing delay
      return generateDemoWeeklyReport(weekStart, weekEnd);
    }
    
    // In production, call OpenAI/Claude API with metrics data
    // For now, generate a template-based report
    
    const insights = this.generateInsights(metrics);
    const recommendations = this.generateRecommendations(metrics);
    const summary = this.generateSummary(metrics);

    return {
      id: `report-${Date.now()}`,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      summary,
      insights,
      metrics,
      recommendations
    };
  }

  // In-memory cache for reports (source of truth is generated on-demand or from DynamoDB)
  private reportsCache: WeeklyReport[] = [];

  async getRecentReports(limit: number = 10): Promise<WeeklyReport[]> {
    // ✨ DEMO MODE: Return demo report history
    const user = authService.getStoredUser();
    if (isDemoAccount(user?.venueId)) {
      console.log('🎭 Demo mode detected - returning demo report history');
      await new Promise(resolve => setTimeout(resolve, 300)); // Simulate loading delay
      return generateDemoReportHistory(Math.min(limit, 8));
    }
    
    // Return from in-memory cache (reports are generated on-demand)
    return this.reportsCache.slice(0, limit);
  }

  async saveReport(report: WeeklyReport): Promise<void> {
    // ✨ DEMO MODE: Don't persist demo reports
    const user = authService.getStoredUser();
    if (isDemoAccount(user?.venueId)) {
      console.log('🎭 Demo mode - skipping report save (demo reports are generated on-demand)');
      return;
    }
    
    // Save to in-memory cache only
    // Reports are generated on-demand from historical DynamoDB data
    this.reportsCache.unshift(report);
    
    // Keep only last 52 weeks (1 year)
    if (this.reportsCache.length > 52) {
      this.reportsCache = this.reportsCache.slice(0, 52);
    }
    
    console.log('📊 Report cached in memory');
  }

  private generateSummary(metrics: WeeklyMetrics): string {
    // Check if we have any meaningful data
    const hasData = (metrics.totalEntries && metrics.totalEntries > 0) || 
                   metrics.avgDecibels > 0 || 
                   (metrics.avgLight && metrics.avgLight > 0);
    
    if (!hasData) {
      return 'Insufficient historical data available to generate a comprehensive summary. Continue collecting sensor data to enable detailed AI insights and recommendations.';
    }

    const parts: string[] = [];
    
    // Occupancy summary (using bar day calculation)
    if (metrics.totalEntries && metrics.totalEntries > 0) {
      parts.push(`Recorded ${metrics.totalEntries.toLocaleString()} customer entries (${metrics.avgDailyEntries?.toLocaleString() || 0} daily average)`);
    }
    
    // Sound environment
    if (metrics.avgDecibels > 0) {
      const soundVibe = metrics.avgDecibels >= 75 && metrics.avgDecibels <= 85 
        ? 'an energetic' 
        : metrics.avgDecibels < 70 ? 'a relaxed' : 'a lively';
      parts.push(`${soundVibe} atmosphere with ${metrics.avgDecibels.toFixed(0)} dB average sound level`);
    }
    
    // Peak hours
    if (metrics.peakHours.length > 0) {
      parts.push(`peak activity during ${metrics.peakHours.slice(0, 2).join(' and ')}`);
    }
    
    // Peak occupancy
    if (metrics.peakOccupancy && metrics.peakOccupancy > 0) {
      parts.push(`peak occupancy of ${metrics.peakOccupancy} people`);
    }

    return parts.length > 0 ? parts.join('. ') + '.' : 'Report generated successfully.';
  }

  private generateInsights(metrics: WeeklyMetrics): ReportInsight[] {
    const insights: ReportInsight[] = [];

    // Occupancy Insight (most important for a bar)
    if (metrics.totalEntries && metrics.totalEntries > 0) {
      const avgDaily = metrics.avgDailyEntries || 0;
      insights.push({
        category: 'Traffic',
        title: 'Customer Entries',
        description: `Total of ${metrics.totalEntries.toLocaleString()} entries recorded. Average of ${avgDaily.toLocaleString()} customers per day.`,
        trend: avgDaily > 100 ? 'up' : avgDaily > 50 ? 'stable' : 'down',
        value: `${metrics.totalEntries.toLocaleString()}`
      });
    }

    // Peak Occupancy
    if (metrics.peakOccupancy && metrics.peakOccupancy > 0) {
      insights.push({
        category: 'Capacity',
        title: 'Peak Occupancy',
        description: `Maximum of ${metrics.peakOccupancy} people at once during this period.`,
        trend: 'up',
        value: `${metrics.peakOccupancy} max`
      });
    }

    // Sound Level Insight
    if (metrics.avgDecibels > 0) {
      const soundQuality = metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85 ? 'optimal' : 
                          metrics.avgDecibels < 70 ? 'quiet' : 'loud';
      insights.push({
        category: 'Atmosphere',
        title: 'Sound Environment',
        description: `Average sound level of ${metrics.avgDecibels.toFixed(1)} dB creates ${
            metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85 ? 'an energetic' : 
            metrics.avgDecibels < 70 ? 'a relaxed' : 'a very lively'
          } atmosphere.`,
        trend: soundQuality === 'optimal' ? 'up' : 'stable',
        value: `${metrics.avgDecibels.toFixed(0)} dB`
      });
    }

    // Light Level Insight
    if (metrics.avgLight && metrics.avgLight > 0) {
      const lightQuality = metrics.avgLight >= 50 && metrics.avgLight <= 300 ? 'optimal' : 
                          metrics.avgLight < 50 ? 'dim' : 'bright';
      insights.push({
        category: 'Ambiance',
        title: 'Lighting',
        description: `Average light level of ${metrics.avgLight.toFixed(0)} lux. ${
          lightQuality === 'optimal' ? 'Good bar ambiance.' : 
          lightQuality === 'dim' ? 'Very dim - may be too dark.' : 
          'Quite bright for a bar setting.'
        }`,
        trend: lightQuality === 'optimal' ? 'up' : 'down',
        value: `${metrics.avgLight.toFixed(0)} lux`
      });
    }

    // Peak Hours Insight
    if (metrics.peakHours.length > 0) {
      insights.push({
        category: 'Operations',
        title: 'Peak Hours',
        description: `Busiest times: ${metrics.peakHours.join(', ')}. Staff up during these hours for best service.`,
        trend: 'up',
        value: metrics.peakHours[0]
      });
    }

    // Average Occupancy
    if (metrics.avgOccupancy && metrics.avgOccupancy > 0) {
      insights.push({
        category: 'Utilization',
        title: 'Average Crowd',
        description: `Average of ${metrics.avgOccupancy} people in venue at any given time during operating hours.`,
        trend: 'stable',
        value: `${metrics.avgOccupancy} avg`
      });
    }

    // If no insights generated, add a placeholder
    if (insights.length === 0) {
      insights.push({
        category: 'Data',
        title: 'Collecting Data',
        description: 'Not enough sensor data for this period. Insights will appear as more data is collected.',
        trend: 'stable',
        value: 'N/A'
      });
    }

    return insights;
  }

  private generateRecommendations(metrics: WeeklyMetrics): string[] {
    const recommendations: string[] = [];

    // Check if we have any data
    const hasData = metrics.avgDecibels > 0 || 
                   (metrics.totalEntries && metrics.totalEntries > 0) ||
                   (metrics.avgLight && metrics.avgLight > 0);

    if (!hasData) {
      recommendations.push('Continue collecting sensor data to enable AI-powered insights and recommendations.');
      recommendations.push('Ensure your Pulse devices are properly connected and publishing data regularly.');
      return recommendations;
    }

    // Sound recommendations
    if (metrics.avgDecibels > 0) {
      if (metrics.avgDecibels > 85) {
        recommendations.push(`Sound levels averaging ${metrics.avgDecibels.toFixed(0)} dB are quite loud. Consider reducing music volume slightly to allow conversation.`);
      } else if (metrics.avgDecibels < 65) {
        recommendations.push(`Sound levels averaging ${metrics.avgDecibels.toFixed(0)} dB are on the quiet side. Increasing music energy could create a more vibrant atmosphere.`);
      } else {
        recommendations.push(`Sound levels at ${metrics.avgDecibels.toFixed(0)} dB are in the optimal range for a bar environment. Keep it up!`);
      }
    }

    // Light recommendations
    if (metrics.avgLight && metrics.avgLight > 0) {
      if (metrics.avgLight > 400) {
        recommendations.push(`Light levels averaging ${metrics.avgLight.toFixed(0)} lux are quite bright. Dimming lights could create better bar ambiance.`);
      } else if (metrics.avgLight < 30) {
        recommendations.push(`Very dim lighting at ${metrics.avgLight.toFixed(0)} lux. While moody, ensure it's not too dark for customers to navigate safely.`);
      } else {
        recommendations.push(`Lighting at ${metrics.avgLight.toFixed(0)} lux creates good bar ambiance.`);
      }
    }

    // Peak hours recommendations
    if (metrics.peakHours.length > 0) {
      recommendations.push(`Peak hours are ${metrics.peakHours.slice(0, 2).join(' and ')}. Ensure adequate staffing and consider promotions during slower periods.`);
    }

    // Occupancy recommendations
    if (metrics.avgDailyEntries && metrics.avgDailyEntries > 0) {
      if (metrics.avgDailyEntries > 200) {
        recommendations.push(`Strong traffic with ${metrics.avgDailyEntries} avg daily entries. Consider expanding capacity or adding events on slower days.`);
      } else if (metrics.avgDailyEntries > 100) {
        recommendations.push(`Healthy traffic at ${metrics.avgDailyEntries} daily entries. Focus on retention and encouraging repeat visits.`);
      } else {
        recommendations.push(`Traffic at ${metrics.avgDailyEntries} daily entries has room to grow. Consider promotions, events, or social media to boost foot traffic.`);
      }
    }

    // Peak vs average
    if (metrics.peakOccupancy && metrics.avgOccupancy && metrics.peakOccupancy > 0) {
      const ratio = metrics.peakOccupancy / Math.max(1, metrics.avgOccupancy);
      if (ratio > 3) {
        recommendations.push(`Peak occupancy (${metrics.peakOccupancy}) is much higher than average (${metrics.avgOccupancy}). Traffic is spiky - consider ways to spread it out.`);
      }
    }

    // Data quality note
    if (metrics.dataPointsAnalyzed && metrics.dataPointsAnalyzed < 100) {
      recommendations.push('Limited data points in this period. Recommendations will become more accurate with more data.');
    }

    return recommendations.length > 0 ? recommendations : ['Data collected successfully. Continue monitoring for trend analysis.'];
  }
}

export default new AIReportService();
