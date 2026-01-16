import type { WeeklyReport, WeeklyMetrics, ReportInsight, SensorData } from '../types';
import { isDemoAccount, generateDemoWeeklyReport, generateDemoReportHistory } from '../utils/demoData';
import authService from './auth.service';
import songLogService from './song-log.service';
import type { GenreStats, PerformingSong, AnalyticsTimeRange } from './song-log.service';

export type ReportType = 'weekly' | 'monthly' | 'music' | 'atmosphere' | 'occupancy' | 'custom';

class AIReportService {
  // In-memory cache for reports
  private reportsCache: WeeklyReport[] = [];

  /**
   * Convert days string to AnalyticsTimeRange
   */
  private getAnalyticsTimeRange(weekStart: Date, weekEnd: Date): AnalyticsTimeRange {
    const days = Math.ceil((weekEnd.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 7) return '7d';
    if (days <= 14) return '14d';
    if (days <= 30) return '30d';
    return '90d';
  }

  /**
   * Generate a report based on type
   */
  async generateReport(
    type: ReportType,
    weekStart: Date,
    weekEnd: Date,
    metrics: WeeklyMetrics,
    sensorData?: SensorData[]
  ): Promise<WeeklyReport> {
    // Demo mode
    const user = authService.getStoredUser();
    if (isDemoAccount(user?.venueId)) {
      await new Promise(resolve => setTimeout(resolve, 800));
      return generateDemoWeeklyReport(weekStart, weekEnd);
    }

    // Calculate analytics time range from dates
    const analyticsRange = this.getAnalyticsTimeRange(weekStart, weekEnd);

    switch (type) {
      case 'music':
        return this.generateMusicReport(weekStart, weekEnd, metrics, analyticsRange);
      case 'atmosphere':
        return this.generateAtmosphereReport(weekStart, weekEnd, metrics, sensorData);
      case 'occupancy':
        return this.generateOccupancyReport(weekStart, weekEnd, metrics);
      case 'monthly':
        return this.generateMonthlyReport(weekStart, weekEnd, metrics);
      case 'weekly':
      case 'custom':
      default:
        return this.generateWeeklyReport(weekStart, weekEnd, metrics);
    }
  }

  /**
   * Weekly Summary Report
   */
  async generateWeeklyReport(
    weekStart: Date,
    weekEnd: Date,
    metrics: WeeklyMetrics
  ): Promise<WeeklyReport> {
    const insights = this.generateWeeklyInsights(metrics);
    const recommendations = this.generateWeeklyRecommendations(metrics);
    const summary = this.generateWeeklySummary(metrics);

    return {
      id: `report-weekly-${Date.now()}`,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      summary,
      insights,
      metrics,
      recommendations
    };
  }

  /**
   * Music Analytics Report
   */
  async generateMusicReport(
    weekStart: Date,
    weekEnd: Date,
    metrics: WeeklyMetrics,
    timeRange: AnalyticsTimeRange = '30d'
  ): Promise<WeeklyReport> {
    // Fetch music-specific data for the selected time range
    let topSongs: PerformingSong[] = [];
    let genreStats: GenreStats[] = [];
    
    console.log(`🎵 Generating music report for time range: ${timeRange}`);
    
    try {
      topSongs = await songLogService.getHighestPerformingSongs(10, timeRange);
      genreStats = await songLogService.getGenreStats(10, timeRange);
    } catch (e) {
      console.error('Error fetching music data:', e);
    }

    const insights: ReportInsight[] = [];

    // Top performing songs
    if (topSongs.length > 0) {
      const topSong = topSongs[0];
      insights.push({
        category: 'Top Song',
        title: topSong.song,
        description: `By ${topSong.artist}. Played ${topSong.plays} times with ${topSong.performanceScore.toFixed(0)} performance score.`,
        trend: 'up',
        value: `${topSong.plays} plays`
      });

      // Second and third songs
      if (topSongs.length > 1) {
        insights.push({
          category: '#2 Song',
          title: topSongs[1].song,
          description: `By ${topSongs[1].artist}. ${topSongs[1].plays} plays.`,
          trend: 'up',
          value: `${topSongs[1].plays} plays`
        });
      }
      if (topSongs.length > 2) {
        insights.push({
          category: '#3 Song',
          title: topSongs[2].song,
          description: `By ${topSongs[2].artist}. ${topSongs[2].plays} plays.`,
          trend: 'up',
          value: `${topSongs[2].plays} plays`
        });
      }
    }

    // Top genres
    if (genreStats.length > 0) {
      const topGenre = genreStats[0];
      const topRetentionDisplay = topGenre.avgRetention >= 100 
        ? `+${(topGenre.avgRetention - 100).toFixed(1)}%` 
        : `${(topGenre.avgRetention - 100).toFixed(1)}%`;
      insights.push({
        category: 'Top Genre',
        title: topGenre.genre,
        description: `${topGenre.plays} songs played. Retention: ${topRetentionDisplay}.`,
        trend: 'up',
        value: `${topRetentionDisplay} retention`
      });

      // Genre with best retention (people stay/more come in)
      const bestRetention = [...genreStats].sort((a, b) => b.avgRetention - a.avgRetention)[0];
      if (bestRetention.genre !== topGenre.genre && bestRetention.avgRetention > 0) {
        const retentionDisplay = bestRetention.avgRetention >= 100 
          ? `+${(bestRetention.avgRetention - 100).toFixed(1)}%` 
          : `${(bestRetention.avgRetention - 100).toFixed(1)}%`;
        insights.push({
          category: 'Best Retention',
          title: bestRetention.genre,
          description: `Crowd grows ${retentionDisplay} on average when this genre plays.`,
          trend: 'up',
          value: `${retentionDisplay}`
        });
      }
    }

    // Music variety
    const uniqueGenres = genreStats.length;
    insights.push({
      category: 'Variety',
      title: 'Genre Diversity',
      description: `${uniqueGenres} different genres played this period.`,
      trend: uniqueGenres >= 5 ? 'up' : 'stable',
      value: `${uniqueGenres} genres`
    });

    // Recommendations
    const recommendations: string[] = [];
    
    if (topSongs.length > 0) {
      const bestPerformer = topSongs[0];
      recommendations.push(`"${bestPerformer.song}" by ${bestPerformer.artist} is your top performer. Consider adding similar songs to your rotation.`);
    }
    
    if (genreStats.length > 0) {
      const bestRetentionGenre = [...genreStats].sort((a, b) => b.avgRetention - a.avgRetention)[0];
      if (bestRetentionGenre.avgRetention > 0) {
        const retentionDisplay = bestRetentionGenre.avgRetention >= 100 
          ? `+${(bestRetentionGenre.avgRetention - 100).toFixed(1)}%` 
          : `${(bestRetentionGenre.avgRetention - 100).toFixed(1)}%`;
        recommendations.push(`${bestRetentionGenre.genre} music has best retention (${retentionDisplay}). Play more during peak hours.`);
      }
      
      if (genreStats.length > 3) {
        const lowPerformers = genreStats.filter(g => g.avgRetention > 0 && g.avgRetention < 100).slice(0, 2);
        if (lowPerformers.length > 0) {
          recommendations.push(`Consider adjusting ${lowPerformers.map(g => g.genre).join(' and ')} - crowd decreased during these genres.`);
        }
      }
    }

    if (topSongs.length === 0 && genreStats.length === 0) {
      recommendations.push('No music data available yet. Songs will be tracked automatically when detected by the system.');
      recommendations.push('Play music during operating hours to start building your music analytics profile.');
    }

    // Summary
    let summary = 'Music Analytics Report. ';
    if (topSongs.length > 0) {
      summary += `Analyzed ${topSongs.reduce((sum, s) => sum + s.plays, 0)} song plays across ${genreStats.length} genres. `;
      summary += `"${topSongs[0].song}" was your top performer. `;
    }
    if (genreStats.length > 0) {
      const bestGenre = [...genreStats].sort((a, b) => b.avgRetention - a.avgRetention)[0];
      if (bestGenre.avgRetention > 0) {
        summary += `${bestGenre.genre} music correlates with best crowd retention.`;
      }
    }
    if (topSongs.length === 0) {
      summary = 'Music analytics data not yet available. Continue playing music to build your profile.';
    }

    return {
      id: `report-music-${Date.now()}`,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      summary,
      insights,
      metrics: {
        ...metrics,
        topSongs: topSongs.map(s => ({ song: s.song, plays: s.plays }))
      },
      recommendations
    };
  }

  /**
   * Atmosphere Optimization Report
   */
  async generateAtmosphereReport(
    weekStart: Date,
    weekEnd: Date,
    metrics: WeeklyMetrics,
    sensorData?: SensorData[]
  ): Promise<WeeklyReport> {
    const insights: ReportInsight[] = [];

    // Sound analysis
    if (metrics.avgDecibels > 0) {
      const soundQuality = metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85 ? 'optimal' : 
                          metrics.avgDecibels < 70 ? 'quiet' : 'loud';
      insights.push({
        category: 'Sound',
        title: 'Noise Level Analysis',
        description: `Average ${metrics.avgDecibels.toFixed(1)} dB. ${
          soundQuality === 'optimal' ? 'Perfect for bar atmosphere - energetic but allows conversation.' :
          soundQuality === 'quiet' ? 'Quieter than typical bar. Could increase energy.' :
          'Quite loud. May fatigue guests over time.'
        }`,
        trend: soundQuality === 'optimal' ? 'up' : 'stable',
        value: `${metrics.avgDecibels.toFixed(0)} dB`
      });

      // Sound variability (if we have sensor data)
      if (sensorData && sensorData.length > 0) {
        const soundLevels = sensorData.filter(d => d.decibels > 0).map(d => d.decibels);
        if (soundLevels.length > 10) {
          const min = Math.min(...soundLevels);
          const max = Math.max(...soundLevels);
          const range = max - min;
          insights.push({
            category: 'Sound Range',
            title: 'Volume Variation',
            description: `Sound varied from ${min.toFixed(0)} to ${max.toFixed(0)} dB (${range.toFixed(0)} dB range).`,
            trend: range < 20 ? 'up' : 'down',
            value: `${range.toFixed(0)} dB range`
          });
        }
      }
    }

    // Light analysis
    if (metrics.avgLight && metrics.avgLight > 0) {
      const lightQuality = metrics.avgLight >= 50 && metrics.avgLight <= 300 ? 'optimal' : 
                          metrics.avgLight < 50 ? 'dim' : 'bright';
      insights.push({
        category: 'Lighting',
        title: 'Ambient Light Analysis',
        description: `Average ${metrics.avgLight.toFixed(0)} lux. ${
          lightQuality === 'optimal' ? 'Good bar ambiance - cozy but visible.' :
          lightQuality === 'dim' ? 'Very dim. Intimate but may be too dark.' :
          'Bright environment. Consider dimming for bar mood.'
        }`,
        trend: lightQuality === 'optimal' ? 'up' : 'stable',
        value: `${metrics.avgLight.toFixed(0)} lux`
      });
    }

    // Peak hour conditions
    if (metrics.peakHours.length > 0) {
      insights.push({
        category: 'Peak Conditions',
        title: 'Busiest Hours',
        description: `Peak activity at ${metrics.peakHours.join(', ')}. Monitor atmosphere closely during these times.`,
        trend: 'up',
        value: metrics.peakHours[0]
      });
    }

    // Occupancy impact
    if (metrics.avgOccupancy && metrics.avgOccupancy > 0) {
      insights.push({
        category: 'Crowd',
        title: 'Average Crowd Size',
        description: `Average of ${metrics.avgOccupancy} people. Peak: ${metrics.peakOccupancy || 'N/A'}.`,
        trend: 'stable',
        value: `${metrics.avgOccupancy} avg`
      });
    }

    // Recommendations
    const recommendations: string[] = [];

    if (metrics.avgDecibels > 85) {
      recommendations.push(`Sound levels are high (${metrics.avgDecibels.toFixed(0)} dB). Consider reducing music volume 10-15% during peak hours.`);
    } else if (metrics.avgDecibels > 0 && metrics.avgDecibels < 65) {
      recommendations.push(`Sound is on the quiet side (${metrics.avgDecibels.toFixed(0)} dB). Raise music volume to create more energy.`);
    } else if (metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85) {
      recommendations.push(`Sound levels are optimal at ${metrics.avgDecibels.toFixed(0)} dB. Maintain current audio settings.`);
    }

    if (metrics.avgLight && metrics.avgLight > 400) {
      recommendations.push(`Lighting is bright (${metrics.avgLight.toFixed(0)} lux). Dim lights 30-40% for better bar ambiance.`);
    } else if (metrics.avgLight && metrics.avgLight < 30) {
      recommendations.push(`Very dim lighting (${metrics.avgLight.toFixed(0)} lux). Ensure safety while maintaining mood.`);
    } else if (metrics.avgLight && metrics.avgLight > 0) {
      recommendations.push(`Lighting at ${metrics.avgLight.toFixed(0)} lux creates good ambiance.`);
    }

    if (metrics.peakHours.length > 0) {
      recommendations.push(`Pre-set atmosphere 30 min before peak hours (${metrics.peakHours[0]}). Gradual changes feel more natural.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Continue collecting atmospheric data for more detailed recommendations.');
    }

    // Summary
    let summary = 'Atmosphere Optimization Report. ';
    const conditions: string[] = [];
    if (metrics.avgDecibels > 0) conditions.push(`${metrics.avgDecibels.toFixed(0)} dB sound`);
    if (metrics.avgLight && metrics.avgLight > 0) conditions.push(`${metrics.avgLight.toFixed(0)} lux lighting`);
    if (conditions.length > 0) {
      summary += `Average conditions: ${conditions.join(', ')}. `;
    }
    summary += 'Focus on maintaining consistent atmosphere during peak hours.';

    return {
      id: `report-atmosphere-${Date.now()}`,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      summary,
      insights,
      metrics,
      recommendations
    };
  }

  /**
   * Occupancy Trends Report
   */
  async generateOccupancyReport(
    weekStart: Date,
    weekEnd: Date,
    metrics: WeeklyMetrics
  ): Promise<WeeklyReport> {
    const insights: ReportInsight[] = [];

    // Total entries
    if (metrics.totalEntries && metrics.totalEntries > 0) {
      insights.push({
        category: 'Total Traffic',
        title: 'Customer Entries',
        description: `${metrics.totalEntries.toLocaleString()} people entered your venue during this period.`,
        trend: 'up',
        value: metrics.totalEntries.toLocaleString()
      });
    }

    // Daily average
    if (metrics.avgDailyEntries && metrics.avgDailyEntries > 0) {
      insights.push({
        category: 'Daily Average',
        title: 'Entries Per Day',
        description: `Average of ${metrics.avgDailyEntries} customers per day.`,
        trend: metrics.avgDailyEntries > 100 ? 'up' : 'stable',
        value: `${metrics.avgDailyEntries}/day`
      });
    }

    // Peak occupancy
    if (metrics.peakOccupancy && metrics.peakOccupancy > 0) {
      insights.push({
        category: 'Peak Crowd',
        title: 'Maximum Occupancy',
        description: `Reached ${metrics.peakOccupancy} people at once during peak times.`,
        trend: 'up',
        value: `${metrics.peakOccupancy} max`
      });
    }

    // Average occupancy
    if (metrics.avgOccupancy && metrics.avgOccupancy > 0) {
      insights.push({
        category: 'Average Crowd',
        title: 'Typical Crowd Size',
        description: `Average of ${metrics.avgOccupancy} people in venue at any given time.`,
        trend: 'stable',
        value: `${metrics.avgOccupancy} avg`
      });

      // Capacity utilization
      if (metrics.peakOccupancy && metrics.peakOccupancy > 0) {
        const utilizationRatio = (metrics.avgOccupancy / metrics.peakOccupancy * 100).toFixed(0);
        insights.push({
          category: 'Utilization',
          title: 'Capacity Usage',
          description: `Running at ${utilizationRatio}% of peak capacity on average.`,
          trend: parseInt(utilizationRatio) > 50 ? 'up' : 'down',
          value: `${utilizationRatio}%`
        });
      }
    }

    // Peak hours
    if (metrics.peakHours.length > 0) {
      insights.push({
        category: 'Timing',
        title: 'Peak Hours',
        description: `Busiest times: ${metrics.peakHours.join(', ')}.`,
        trend: 'up',
        value: metrics.peakHours[0]
      });
    }

    // Entry/exit balance
    if (metrics.totalEntries && metrics.totalExits && metrics.totalEntries > 0) {
      const ratio = (metrics.totalExits / metrics.totalEntries * 100).toFixed(0);
      insights.push({
        category: 'Flow',
        title: 'Entry/Exit Balance',
        description: `${ratio}% exit tracking rate. ${parseInt(ratio) < 90 ? 'Some exits may not be captured.' : 'Good sensor coverage.'}`,
        trend: parseInt(ratio) >= 90 ? 'up' : 'stable',
        value: `${ratio}% tracked`
      });
    }

    // Recommendations
    const recommendations: string[] = [];

    if (metrics.avgDailyEntries && metrics.avgDailyEntries > 200) {
      recommendations.push(`Strong traffic (${metrics.avgDailyEntries}/day). Consider expanding capacity or adding overflow areas.`);
    } else if (metrics.avgDailyEntries && metrics.avgDailyEntries > 100) {
      recommendations.push(`Healthy traffic at ${metrics.avgDailyEntries}/day. Focus on increasing average spend per customer.`);
    } else if (metrics.avgDailyEntries && metrics.avgDailyEntries > 0) {
      recommendations.push(`Traffic at ${metrics.avgDailyEntries}/day could be improved. Consider promotions or events.`);
    }

    if (metrics.peakHours.length > 0) {
      recommendations.push(`Staff heavily for ${metrics.peakHours[0]}. Consider happy hour or specials to build traffic before peak.`);
    }

    if (metrics.avgOccupancy && metrics.peakOccupancy) {
      const ratio = metrics.avgOccupancy / metrics.peakOccupancy;
      if (ratio < 0.4) {
        recommendations.push('Large gap between average and peak occupancy. Work on building consistent traffic throughout operating hours.');
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Continue collecting occupancy data for trend analysis.');
    }

    // Summary
    let summary = 'Occupancy Trends Report. ';
    if (metrics.totalEntries && metrics.totalEntries > 0) {
      summary += `${metrics.totalEntries.toLocaleString()} total entries. `;
      if (metrics.avgDailyEntries) {
        summary += `${metrics.avgDailyEntries} avg per day. `;
      }
    }
    if (metrics.peakOccupancy && metrics.peakOccupancy > 0) {
      summary += `Peak crowd: ${metrics.peakOccupancy} people. `;
    }
    if (metrics.peakHours.length > 0) {
      summary += `Busiest: ${metrics.peakHours[0]}.`;
    }

    return {
      id: `report-occupancy-${Date.now()}`,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      summary,
      insights,
      metrics,
      recommendations
    };
  }

  /**
   * Monthly Performance Report
   */
  async generateMonthlyReport(
    weekStart: Date,
    weekEnd: Date,
    metrics: WeeklyMetrics
  ): Promise<WeeklyReport> {
    const insights: ReportInsight[] = [];

    // Traffic overview
    if (metrics.totalEntries && metrics.totalEntries > 0) {
      insights.push({
        category: 'Monthly Traffic',
        title: 'Total Visitors',
        description: `${metrics.totalEntries.toLocaleString()} customers visited this month.`,
        trend: 'up',
        value: metrics.totalEntries.toLocaleString()
      });

      // Weekly average
      const weeklyAvg = Math.round(metrics.totalEntries / 4);
      insights.push({
        category: 'Weekly Average',
        title: 'Visitors Per Week',
        description: `Averaging ${weeklyAvg.toLocaleString()} visitors per week.`,
        trend: 'stable',
        value: `${weeklyAvg.toLocaleString()}/wk`
      });
    }

    // Performance metrics
    if (metrics.avgDecibels > 0) {
      insights.push({
        category: 'Sound',
        title: 'Monthly Sound Average',
        description: `Average sound level of ${metrics.avgDecibels.toFixed(0)} dB maintained.`,
        trend: metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85 ? 'up' : 'stable',
        value: `${metrics.avgDecibels.toFixed(0)} dB`
      });
    }

    if (metrics.avgLight && metrics.avgLight > 0) {
      insights.push({
        category: 'Lighting',
        title: 'Monthly Light Average',
        description: `Average lighting at ${metrics.avgLight.toFixed(0)} lux.`,
        trend: 'stable',
        value: `${metrics.avgLight.toFixed(0)} lux`
      });
    }

    if (metrics.peakOccupancy && metrics.peakOccupancy > 0) {
      insights.push({
        category: 'Peak',
        title: 'Month\'s Peak Crowd',
        description: `Maximum occupancy reached: ${metrics.peakOccupancy} people.`,
        trend: 'up',
        value: `${metrics.peakOccupancy} max`
      });
    }

    // Data quality
    if (metrics.dataPointsAnalyzed && metrics.daysWithData) {
      insights.push({
        category: 'Data',
        title: 'Coverage',
        description: `${metrics.dataPointsAnalyzed.toLocaleString()} readings across ${metrics.daysWithData} days.`,
        trend: metrics.daysWithData >= 25 ? 'up' : 'stable',
        value: `${metrics.daysWithData} days`
      });
    }

    // Recommendations
    const recommendations: string[] = [];

    if (metrics.totalEntries && metrics.totalEntries > 0) {
      const dailyAvg = Math.round(metrics.totalEntries / 30);
      if (dailyAvg > 150) {
        recommendations.push(`Strong monthly performance with ${dailyAvg} avg daily visitors. Set this as your baseline.`);
      } else if (dailyAvg > 75) {
        recommendations.push(`Solid traffic at ${dailyAvg}/day. Focus on converting visitors to regulars.`);
      } else {
        recommendations.push(`Room to grow at ${dailyAvg}/day. Consider monthly events or themed nights.`);
      }
    }

    recommendations.push('Compare next month to identify trends and seasonal patterns.');
    
    if (metrics.peakHours.length > 0) {
      recommendations.push(`Peak hours (${metrics.peakHours.slice(0, 2).join(', ')}) are consistent. Build marketing around these times.`);
    }

    // Summary
    let summary = 'Monthly Performance Report. ';
    if (metrics.totalEntries && metrics.totalEntries > 0) {
      summary += `${metrics.totalEntries.toLocaleString()} total visitors (${Math.round(metrics.totalEntries / 30)}/day avg). `;
    }
    if (metrics.peakOccupancy) {
      summary += `Peak crowd: ${metrics.peakOccupancy}. `;
    }
    summary += 'Use this as your monthly baseline for comparison.';

    return {
      id: `report-monthly-${Date.now()}`,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      summary,
      insights,
      metrics,
      recommendations
    };
  }

  // ============ HELPER METHODS ============

  private generateWeeklySummary(metrics: WeeklyMetrics): string {
    const hasData = (metrics.totalEntries && metrics.totalEntries > 0) || 
                   metrics.avgDecibels > 0 || 
                   (metrics.avgLight && metrics.avgLight > 0);
    
    if (!hasData) {
      return 'Insufficient data for this period. Continue collecting sensor data for insights.';
    }

    const parts: string[] = [];
    
    if (metrics.totalEntries && metrics.totalEntries > 0) {
      parts.push(`${metrics.totalEntries.toLocaleString()} customer entries (${metrics.avgDailyEntries || 0} daily avg)`);
    }
    
    if (metrics.avgDecibels > 0) {
      const soundVibe = metrics.avgDecibels >= 75 && metrics.avgDecibels <= 85 
        ? 'energetic' : metrics.avgDecibels < 70 ? 'relaxed' : 'lively';
      parts.push(`${soundVibe} atmosphere at ${metrics.avgDecibels.toFixed(0)} dB`);
    }
    
    if (metrics.peakHours.length > 0) {
      parts.push(`peak activity at ${metrics.peakHours.slice(0, 2).join(' and ')}`);
    }

    return parts.length > 0 ? parts.join('. ') + '.' : 'Report generated successfully.';
  }

  private generateWeeklyInsights(metrics: WeeklyMetrics): ReportInsight[] {
    const insights: ReportInsight[] = [];

    if (metrics.totalEntries && metrics.totalEntries > 0) {
      insights.push({
        category: 'Traffic',
        title: 'Customer Entries',
        description: `${metrics.totalEntries.toLocaleString()} entries. ${metrics.avgDailyEntries || 0} per day avg.`,
        trend: (metrics.avgDailyEntries || 0) > 100 ? 'up' : 'stable',
        value: metrics.totalEntries.toLocaleString()
      });
    }

    if (metrics.peakOccupancy && metrics.peakOccupancy > 0) {
      insights.push({
        category: 'Capacity',
        title: 'Peak Occupancy',
        description: `Maximum of ${metrics.peakOccupancy} people at once.`,
        trend: 'up',
        value: `${metrics.peakOccupancy} max`
      });
    }

    if (metrics.avgDecibels > 0) {
      insights.push({
        category: 'Atmosphere',
        title: 'Sound Level',
        description: `Average ${metrics.avgDecibels.toFixed(0)} dB.`,
        trend: metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85 ? 'up' : 'stable',
        value: `${metrics.avgDecibels.toFixed(0)} dB`
      });
    }

    if (metrics.avgLight && metrics.avgLight > 0) {
      insights.push({
        category: 'Ambiance',
        title: 'Lighting',
        description: `Average ${metrics.avgLight.toFixed(0)} lux.`,
        trend: 'stable',
        value: `${metrics.avgLight.toFixed(0)} lux`
      });
    }

    if (metrics.peakHours.length > 0) {
      insights.push({
        category: 'Operations',
        title: 'Peak Hours',
        description: `Busiest: ${metrics.peakHours.join(', ')}.`,
        trend: 'up',
        value: metrics.peakHours[0]
      });
    }

    if (insights.length === 0) {
      insights.push({
        category: 'Data',
        title: 'Collecting',
        description: 'Not enough data yet. Insights appear as data accumulates.',
        trend: 'stable',
        value: 'N/A'
      });
    }

    return insights;
  }

  private generateWeeklyRecommendations(metrics: WeeklyMetrics): string[] {
    const recommendations: string[] = [];
    const hasData = metrics.avgDecibels > 0 || (metrics.totalEntries && metrics.totalEntries > 0);

    if (!hasData) {
      return ['Continue collecting sensor data for personalized recommendations.'];
    }

    if (metrics.avgDecibels > 85) {
      recommendations.push(`Sound at ${metrics.avgDecibels.toFixed(0)} dB is high. Consider reducing 10-15%.`);
    } else if (metrics.avgDecibels > 0 && metrics.avgDecibels < 65) {
      recommendations.push(`Sound at ${metrics.avgDecibels.toFixed(0)} dB is quiet. Increase music energy.`);
    } else if (metrics.avgDecibels >= 70 && metrics.avgDecibels <= 85) {
      recommendations.push(`Sound levels optimal at ${metrics.avgDecibels.toFixed(0)} dB.`);
    }

    if (metrics.avgDailyEntries && metrics.avgDailyEntries > 0) {
      if (metrics.avgDailyEntries > 150) {
        recommendations.push(`Strong traffic (${metrics.avgDailyEntries}/day). Consider expanding capacity.`);
      } else if (metrics.avgDailyEntries < 50) {
        recommendations.push(`Traffic at ${metrics.avgDailyEntries}/day. Consider promotions or events.`);
      }
    }

    if (metrics.peakHours.length > 0) {
      recommendations.push(`Optimize staffing for ${metrics.peakHours[0]}.`);
    }

    return recommendations.length > 0 ? recommendations : ['Data collected. Continue monitoring.'];
  }

  async getRecentReports(limit: number = 10): Promise<WeeklyReport[]> {
    const user = authService.getStoredUser();
    if (isDemoAccount(user?.venueId)) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return generateDemoReportHistory(Math.min(limit, 8));
    }
    return this.reportsCache.slice(0, limit);
  }

  async saveReport(report: WeeklyReport): Promise<void> {
    const user = authService.getStoredUser();
    if (isDemoAccount(user?.venueId)) return;
    
    this.reportsCache.unshift(report);
    if (this.reportsCache.length > 52) {
      this.reportsCache = this.reportsCache.slice(0, 52);
    }
  }
}

export default new AIReportService();
