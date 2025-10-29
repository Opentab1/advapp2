import type { WeeklyReport, WeeklyMetrics, ReportInsight } from '../types';

class AIReportService {
  async generateWeeklyReport(
    weekStart: Date,
    weekEnd: Date,
    metrics: WeeklyMetrics
  ): Promise<WeeklyReport> {
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

  async getRecentReports(limit: number = 10): Promise<WeeklyReport[]> {
    try {
      const stored = localStorage.getItem('weeklyReports');
      if (stored) {
        const reports: WeeklyReport[] = JSON.parse(stored);
        return reports.slice(0, limit);
      }
    } catch (error) {
      console.error('Error loading reports:', error);
    }
    return [];
  }

  async saveReport(report: WeeklyReport): Promise<void> {
    try {
      const stored = localStorage.getItem('weeklyReports');
      const reports: WeeklyReport[] = stored ? JSON.parse(stored) : [];
      reports.unshift(report);
      
      // Keep only last 52 weeks (1 year)
      const trimmed = reports.slice(0, 52);
      localStorage.setItem('weeklyReports', JSON.stringify(trimmed));
    } catch (error) {
      console.error('Error saving report:', error);
    }
  }

  private generateSummary(metrics: WeeklyMetrics): string {
    const comfortStatus = metrics.avgComfort >= 80 ? 'excellent' : 
                         metrics.avgComfort >= 65 ? 'good' : 'needs improvement';
    
    return `This week at Ferg's Sports Bar showed ${comfortStatus} environmental conditions with an average comfort score of ${metrics.avgComfort.toFixed(1)}. Total revenue reached $${metrics.totalRevenue.toLocaleString()} across ${metrics.totalCustomers.toLocaleString()} customers, with peak activity during ${metrics.peakHours.join(', ')}.`;
  }

  private generateInsights(metrics: WeeklyMetrics): ReportInsight[] {
    const insights: ReportInsight[] = [];

    // Comfort Insight
    insights.push({
      category: 'Comfort',
      title: 'Overall Comfort Level',
      description: `Average comfort score of ${metrics.avgComfort.toFixed(1)} indicates ${
        metrics.avgComfort >= 80 ? 'optimal' : metrics.avgComfort >= 65 ? 'good' : 'suboptimal'
      } environmental conditions.`,
      trend: metrics.avgComfort >= 75 ? 'up' : metrics.avgComfort >= 60 ? 'stable' : 'down',
      value: `${metrics.avgComfort.toFixed(1)}`
    });

    // Temperature Insight
    insights.push({
      category: 'Temperature',
      title: 'Temperature Management',
      description: `Average temperature of ${metrics.avgTemperature.toFixed(1)}°F maintained throughout the week.`,
      trend: metrics.avgTemperature >= 68 && metrics.avgTemperature <= 74 ? 'stable' : 'down',
      value: `${metrics.avgTemperature.toFixed(1)}°F`
    });

    // Sound Level Insight
    insights.push({
      category: 'Atmosphere',
      title: 'Sound Environment',
      description: `Average sound level of ${metrics.avgDecibels.toFixed(1)} dB creates ${
        metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85 ? 'an energetic' : 
        metrics.avgDecibels < 70 ? 'a relaxed' : 'a very lively'
      } atmosphere.`,
      trend: 'stable',
      value: `${metrics.avgDecibels.toFixed(1)} dB`
    });

    // Revenue Insight
    insights.push({
      category: 'Revenue',
      title: 'Sales Performance',
      description: `Generated $${metrics.totalRevenue.toLocaleString()} in revenue with an average of $${(metrics.totalRevenue / metrics.totalCustomers).toFixed(2)} per customer.`,
      trend: 'up',
      value: `$${metrics.totalRevenue.toLocaleString()}`
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
    }

    return insights;
  }

  private generateRecommendations(metrics: WeeklyMetrics): string[] {
    const recommendations: string[] = [];

    // Comfort recommendations
    if (metrics.avgComfort < 70) {
      recommendations.push('Consider adjusting HVAC settings during peak hours to improve customer comfort levels.');
    }

    // Temperature recommendations
    if (metrics.avgTemperature > 75) {
      recommendations.push('Lower temperature setpoint by 2-3°F during busy periods to enhance comfort.');
    } else if (metrics.avgTemperature < 68) {
      recommendations.push('Increase temperature slightly to create a warmer, more inviting atmosphere.');
    }

    // Sound recommendations
    if (metrics.avgDecibels > 85) {
      recommendations.push('High sound levels detected. Consider reducing music volume slightly during peak hours.');
    } else if (metrics.avgDecibels < 65) {
      recommendations.push('Sound levels are low. Increasing music energy could create a more vibrant atmosphere.');
    }

    // Peak hours recommendations
    if (metrics.peakHours.length > 0) {
      recommendations.push(`Optimize staffing for peak hours: ${metrics.peakHours.join(', ')}. Consider special promotions during slower periods.`);
    }

    // Revenue optimization
    const avgPerCustomer = metrics.totalRevenue / metrics.totalCustomers;
    if (avgPerCustomer < 40) {
      recommendations.push('Average spend per customer is below target. Promote higher-margin items and upsell opportunities.');
    }

    // Music recommendations
    if (metrics.topSongs.length >= 3) {
      recommendations.push(`Top songs (${metrics.topSongs.slice(0, 3).map(s => s.song).join(', ')}) resonate well. Create similar playlists for consistent atmosphere.`);
    }

    return recommendations;
  }
}

export default new AIReportService();
