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
    if (metrics.avgComfort === 0 && metrics.avgTemperature === 0 && !metrics.totalEntries) {
      return 'Insufficient historical data available to generate a comprehensive weekly summary. Continue collecting sensor data to enable detailed AI insights and recommendations.';
    }

    const comfortStatus = metrics.avgComfort >= 80 ? 'excellent' : 
                         metrics.avgComfort >= 65 ? 'good' : 'needs improvement';
    
    // Occupancy summary (using bar day calculation)
    const occupancyText = metrics.totalEntries && metrics.totalEntries > 0
      ? `Recorded ${metrics.totalEntries.toLocaleString()} customer entries (${metrics.avgDailyEntries?.toLocaleString() || 0} daily average, calculated using 3am-3am bar days)`
      : 'Customer entry data not yet available';
    
    const revenueText = metrics.totalRevenue > 0 
      ? `. Total revenue reached $${metrics.totalRevenue.toLocaleString()}`
      : '';
    
    const peakText = metrics.peakHours.length > 0
      ? `, with peak activity during ${metrics.peakHours.join(', ')}`
      : '';

    const envText = metrics.avgTemperature > 0 
      ? `This period showed ${comfortStatus} environmental conditions with an average temperature of ${metrics.avgTemperature.toFixed(1)}°F. `
      : '';

    return `${envText}${occupancyText}${revenueText}${peakText}.`;
  }

  private generateInsights(metrics: WeeklyMetrics): ReportInsight[] {
    const insights: ReportInsight[] = [];

    // Comfort Insight
    insights.push({
      category: 'Comfort',
      title: 'Overall Comfort Level',
      description: metrics.avgComfort > 0 
        ? `Average comfort score of ${metrics.avgComfort.toFixed(1)} indicates ${
            metrics.avgComfort >= 80 ? 'optimal' : metrics.avgComfort >= 65 ? 'good' : 'suboptimal'
          } environmental conditions.`
        : 'No comfort data available for this period.',
      trend: metrics.avgComfort > 0 ? (metrics.avgComfort >= 75 ? 'up' : metrics.avgComfort >= 60 ? 'stable' : 'down') : 'stable',
      value: metrics.avgComfort > 0 ? `${metrics.avgComfort.toFixed(1)}` : 'N/A'
    });

    // Temperature Insight
    insights.push({
      category: 'Temperature',
      title: 'Temperature Management',
      description: metrics.avgTemperature > 0
        ? `Average temperature of ${metrics.avgTemperature.toFixed(1)}°F maintained throughout the week.`
        : 'No temperature data available for this period.',
      trend: metrics.avgTemperature > 0 ? (metrics.avgTemperature >= 68 && metrics.avgTemperature <= 74 ? 'stable' : 'down') : 'stable',
      value: metrics.avgTemperature > 0 ? `${metrics.avgTemperature.toFixed(1)}°F` : 'N/A'
    });

    // Sound Level Insight
    insights.push({
      category: 'Atmosphere',
      title: 'Sound Environment',
      description: metrics.avgDecibels > 0
        ? `Average sound level of ${metrics.avgDecibels.toFixed(1)} dB creates ${
            metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85 ? 'an energetic' : 
            metrics.avgDecibels < 70 ? 'a relaxed' : 'a very lively'
          } atmosphere.`
        : 'No sound level data available for this period.',
      trend: 'stable',
      value: metrics.avgDecibels > 0 ? `${metrics.avgDecibels.toFixed(1)} dB` : 'N/A'
    });

    // Revenue Insight
    insights.push({
      category: 'Revenue',
      title: 'Sales Performance',
      description: metrics.totalRevenue > 0
        ? `Generated $${metrics.totalRevenue.toLocaleString()} in revenue with an average of $${(metrics.totalRevenue / metrics.totalCustomers).toFixed(2)} per customer.`
        : 'Revenue tracking not yet available. Requires POS integration.',
      trend: metrics.totalRevenue > 0 ? 'up' : 'stable',
      value: metrics.totalRevenue > 0 ? `$${metrics.totalRevenue.toLocaleString()}` : 'N/A'
    });

    // Music Insight
    if (metrics.topSongs.length > 0) {
      insights.push({
        category: 'Entertainment',
        title: 'Popular Music',
        description: `"${metrics.topSongs[0].song}" was the most played track with ${metrics.topSongs[0].plays} plays.`,
        trend: 'up',
        value: `${metrics.topSongs[0].plays} plays`
      });
    } else {
      insights.push({
        category: 'Entertainment',
        title: 'Popular Music',
        description: 'Music analytics not yet available. Requires song detection history.',
        trend: 'stable',
        value: 'N/A'
      });
    }

    // Occupancy Insight (using bar day 3am-3am calculation)
    if (metrics.totalEntries && metrics.totalEntries > 0) {
      const avgDaily = metrics.avgDailyEntries || 0;
      insights.push({
        category: 'Occupancy',
        title: 'Customer Traffic',
        description: `Total of ${metrics.totalEntries.toLocaleString()} entries recorded (bar days: 3am-3am). Average of ${avgDaily.toLocaleString()} customers per day.`,
        trend: 'up',
        value: `${metrics.totalEntries.toLocaleString()} entries`
      });
    } else {
      insights.push({
        category: 'Occupancy',
        title: 'Customer Traffic',
        description: 'Occupancy tracking data not yet available. Ensure sensors are reporting entries/exits.',
        trend: 'stable',
        value: 'N/A'
      });
    }

    return insights;
  }

  private generateRecommendations(metrics: WeeklyMetrics): string[] {
    const recommendations: string[] = [];

    // If no data available, provide setup recommendations
    if (metrics.avgComfort === 0 && metrics.avgTemperature === 0 && metrics.avgDecibels === 0) {
      recommendations.push('Continue collecting sensor data for at least 7 days to enable AI-powered insights and recommendations.');
      recommendations.push('Ensure your Pulse devices are properly connected and publishing data regularly.');
      recommendations.push('Once sufficient data is collected, you will receive personalized recommendations for comfort, atmosphere, and revenue optimization.');
      return recommendations;
    }

    // Comfort recommendations (only if data available)
    if (metrics.avgComfort > 0 && metrics.avgComfort < 70) {
      recommendations.push('Consider adjusting HVAC settings during peak hours to improve customer comfort levels.');
    } else if (metrics.avgComfort >= 80) {
      recommendations.push('Excellent comfort levels maintained! Continue current environmental management practices.');
    }

    // Temperature recommendations (only if data available)
    if (metrics.avgTemperature > 75) {
      recommendations.push('Lower temperature setpoint by 2-3°F during busy periods to enhance comfort.');
    } else if (metrics.avgTemperature > 0 && metrics.avgTemperature < 68) {
      recommendations.push('Increase temperature slightly to create a warmer, more inviting atmosphere.');
    } else if (metrics.avgTemperature >= 68 && metrics.avgTemperature <= 75) {
      recommendations.push('Temperature levels are optimal. Maintain current HVAC settings.');
    }

    // Sound recommendations (only if data available)
    if (metrics.avgDecibels > 85) {
      recommendations.push('High sound levels detected. Consider reducing music volume slightly during peak hours.');
    } else if (metrics.avgDecibels > 0 && metrics.avgDecibels < 65) {
      recommendations.push('Sound levels are low. Increasing music energy could create a more vibrant atmosphere.');
    } else if (metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85) {
      recommendations.push('Sound levels create an energetic atmosphere. Current audio settings are effective.');
    }

    // Peak hours recommendations
    if (metrics.peakHours.length > 0) {
      recommendations.push(`Optimize staffing for peak hours: ${metrics.peakHours.join(', ')}. Consider special promotions during slower periods.`);
    }

    // Revenue optimization (only if data available)
    if (metrics.totalRevenue > 0 && metrics.totalCustomers > 0) {
      const avgPerCustomer = metrics.totalRevenue / metrics.totalCustomers;
      if (avgPerCustomer < 40) {
        recommendations.push('Average spend per customer is below target. Promote higher-margin items and upsell opportunities.');
      } else if (avgPerCustomer >= 60) {
        recommendations.push('Strong per-customer spend! Continue promoting high-value items and excellent service.');
      }
    }

    // Music recommendations (only if data available)
    if (metrics.topSongs.length >= 3) {
      recommendations.push(`Top songs (${metrics.topSongs.slice(0, 3).map(s => s.song).join(', ')}) resonate well. Create similar playlists for consistent atmosphere.`);
    }

    // Occupancy recommendations (using bar day data)
    if (metrics.totalEntries && metrics.avgDailyEntries) {
      if (metrics.avgDailyEntries > 200) {
        recommendations.push(`Strong customer traffic with ${metrics.avgDailyEntries} average daily entries. Consider expanding capacity during peak hours.`);
      } else if (metrics.avgDailyEntries > 100) {
        recommendations.push(`Healthy customer flow with ${metrics.avgDailyEntries} average daily entries. Focus on retention and repeat visits.`);
      } else if (metrics.avgDailyEntries > 0) {
        recommendations.push(`Customer traffic averaging ${metrics.avgDailyEntries} daily entries. Consider promotions or events to boost foot traffic.`);
      }
      
      // Entry/exit ratio insight
      if (metrics.totalExits && metrics.totalEntries > 0) {
        const ratio = metrics.totalExits / metrics.totalEntries;
        if (ratio < 0.9) {
          recommendations.push('Entry/exit ratio suggests some customers may be staying overnight or exits not fully captured. Verify sensor accuracy.');
        }
      }
    }

    // If we have some recommendations, return them
    if (recommendations.length > 0) {
      return recommendations;
    }

    // Fallback if data is partial
    return ['Continue collecting data for more detailed recommendations.'];
  }
}

export default new AIReportService();
