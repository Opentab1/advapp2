/**
 * Revenue Estimation Utilities
 * 
 * Translates venue metrics into estimated revenue impact.
 * Uses industry averages for bar/restaurant spending patterns.
 * 
 * Key assumptions:
 * - Average spend per guest per hour: $18-25 (varies by venue type)
 * - Dwell time directly correlates with spend
 * - Optimal conditions increase retention
 */

// Industry benchmarks (conservative estimates)
export const REVENUE_CONSTANTS = {
  // Average spend per guest per hour
  AVG_SPEND_PER_HOUR: 22, // $22/hour
  
  // Base dwell time (minutes) - what guests stay without optimization
  BASE_DWELL_MINUTES: 45,
  
  // Premium multiplier when conditions are optimal
  OPTIMAL_CONDITION_MULTIPLIER: 1.15,
  
  // Conversion rate from foot traffic to paying customer
  TRAFFIC_TO_CUSTOMER_RATE: 0.85,
  
  // Average transaction size
  AVG_TRANSACTION: 38,
  
  // Revenue per extra minute of dwell time
  REVENUE_PER_DWELL_MINUTE: 0.35,
};

export interface RevenueImpact {
  // Tonight's estimated impact
  tonightImpact: number;
  tonightImpactFormatted: string;
  
  // Impact breakdown
  dwellImpact: number;
  occupancyImpact: number;
  conditionBonus: number;
  
  // Comparison
  vsLastWeek: number;
  vsLastWeekPercent: number;
  
  // Opportunity (money being left on table)
  missedOpportunity: number;
  missedOpportunityReason: string;
  
  // Confidence level (0-1)
  confidence: number;
}

export interface RevenueInsight {
  type: 'positive' | 'negative' | 'neutral';
  headline: string;
  subtext: string;
  actionable: boolean;
  action?: string;
}

/**
 * Calculate estimated revenue impact based on current metrics
 */
export function calculateRevenueImpact(
  currentOccupancy: number,
  dwellTimeMinutes: number,
  pulseScore: number,
  todayEntries: number,
  _todayExits: number,
  previousWeekData?: {
    avgOccupancy: number;
    avgDwell: number;
    totalGuests: number;
  }
): RevenueImpact {
  const { 
    AVG_SPEND_PER_HOUR, 
    BASE_DWELL_MINUTES, 
    OPTIMAL_CONDITION_MULTIPLIER,
    REVENUE_PER_DWELL_MINUTE 
  } = REVENUE_CONSTANTS;
  
  // Calculate dwell time impact (extra revenue from longer stays)
  const extraDwellMinutes = Math.max(0, dwellTimeMinutes - BASE_DWELL_MINUTES);
  const dwellImpact = Math.round(extraDwellMinutes * REVENUE_PER_DWELL_MINUTE * todayEntries);
  
  // Calculate occupancy impact (more guests = more revenue)
  // Base calculation: guests × average spend × time factor
  const hoursFraction = dwellTimeMinutes / 60;
  const occupancyImpact = Math.round(currentOccupancy * AVG_SPEND_PER_HOUR * hoursFraction);
  
  // Condition bonus: optimal Pulse Score increases spending
  const conditionMultiplier = pulseScore >= 75 
    ? OPTIMAL_CONDITION_MULTIPLIER 
    : pulseScore >= 50 
      ? 1.05 
      : 1;
  const conditionBonus = Math.round((occupancyImpact + dwellImpact) * (conditionMultiplier - 1));
  
  // Total tonight's impact
  const tonightImpact = dwellImpact + conditionBonus;
  
  // Calculate vs last week
  let vsLastWeek = 0;
  let vsLastWeekPercent = 0;
  
  if (previousWeekData) {
    const lastWeekDwellImpact = Math.max(0, previousWeekData.avgDwell - BASE_DWELL_MINUTES) 
      * REVENUE_PER_DWELL_MINUTE * previousWeekData.totalGuests;
    vsLastWeek = Math.round(tonightImpact - lastWeekDwellImpact);
    vsLastWeekPercent = lastWeekDwellImpact > 0 
      ? Math.round((vsLastWeek / lastWeekDwellImpact) * 100) 
      : 0;
  }
  
  // Calculate missed opportunity
  let missedOpportunity = 0;
  let missedOpportunityReason = '';
  
  if (pulseScore < 70) {
    // Sub-optimal conditions = leaving money on table
    const optimalScenario = occupancyImpact * OPTIMAL_CONDITION_MULTIPLIER;
    missedOpportunity = Math.round(optimalScenario - occupancyImpact);
    
    if (pulseScore < 50) {
      missedOpportunityReason = 'Poor ambiance is cutting visits short';
    } else {
      missedOpportunityReason = 'Small tweaks could boost spending';
    }
  } else if (currentOccupancy < 20 && todayEntries > 50) {
    // High turnover = missed dwell opportunity
    missedOpportunity = Math.round((todayEntries - currentOccupancy) * 5);
    missedOpportunityReason = 'Guests aren\'t staying long enough';
  }
  
  // Confidence level based on data quality
  const confidence = Math.min(1, (todayEntries / 50) * 0.8 + (pulseScore > 0 ? 0.2 : 0));
  
  return {
    tonightImpact,
    tonightImpactFormatted: formatCurrency(tonightImpact),
    dwellImpact,
    occupancyImpact,
    conditionBonus,
    vsLastWeek,
    vsLastWeekPercent,
    missedOpportunity,
    missedOpportunityReason,
    confidence,
  };
}

/**
 * Generate a human-readable revenue insight
 */
export function getRevenueInsight(
  dwellTimeMinutes: number,
  pulseScore: number,
  currentOccupancy: number
): RevenueInsight {
  const extraMinutes = dwellTimeMinutes - REVENUE_CONSTANTS.BASE_DWELL_MINUTES;
  
  // Great dwell time
  if (extraMinutes > 15 && pulseScore >= 70) {
    const extraRevenue = Math.round(extraMinutes * REVENUE_CONSTANTS.REVENUE_PER_DWELL_MINUTE * currentOccupancy);
    return {
      type: 'positive',
      headline: `Guests staying ${extraMinutes} min longer`,
      subtext: `That's ~$${extraRevenue} in extra orders tonight`,
      actionable: false,
    };
  }
  
  // Good pulse score helping retention
  if (pulseScore >= 80) {
    return {
      type: 'positive',
      headline: 'Your vibe is on point',
      subtext: 'Optimal conditions are keeping guests happy & spending',
      actionable: false,
    };
  }
  
  // Room for improvement
  if (pulseScore < 60) {
    return {
      type: 'negative',
      headline: 'Leaving money on the table',
      subtext: 'Fix the ambiance to boost guest spending',
      actionable: true,
      action: 'See what to adjust',
    };
  }
  
  // Low occupancy
  if (currentOccupancy < 15) {
    return {
      type: 'neutral',
      headline: 'Building momentum',
      subtext: 'Perfect time to dial in the atmosphere',
      actionable: true,
      action: 'Prep for peak hours',
    };
  }
  
  // Default - doing okay
  return {
    type: 'neutral',
    headline: 'Steady night so far',
    subtext: 'Small tweaks could unlock more revenue',
    actionable: true,
    action: 'View opportunities',
  };
}

/**
 * Calculate song's revenue impact
 */
export function calculateSongRevenue(
  avgDwellExtension: number, // extra minutes guests stayed
  timesPlayed: number,
  avgOccupancyDuringPlay: number
): number {
  // Each extra minute = $0.35 per guest on average
  return Math.round(
    avgDwellExtension * 
    REVENUE_CONSTANTS.REVENUE_PER_DWELL_MINUTE * 
    timesPlayed * 
    avgOccupancyDuringPlay
  );
}

/**
 * Calculate weekly revenue summary
 */
export function calculateWeeklyRevenueSummary(
  dailyData: Array<{
    date: Date;
    totalGuests: number;
    avgDwell: number;
    avgPulseScore: number;
  }>
): {
  totalImpact: number;
  bestDay: { name: string; amount: number };
  avgPerDay: number;
  trend: 'up' | 'down' | 'stable';
  trendPercent: number;
} {
  const dailyImpacts = dailyData.map(day => {
    const extraDwell = Math.max(0, day.avgDwell - REVENUE_CONSTANTS.BASE_DWELL_MINUTES);
    return {
      date: day.date,
      impact: Math.round(
        extraDwell * REVENUE_CONSTANTS.REVENUE_PER_DWELL_MINUTE * day.totalGuests
      ),
    };
  });
  
  const totalImpact = dailyImpacts.reduce((sum, d) => sum + d.impact, 0);
  const avgPerDay = Math.round(totalImpact / Math.max(1, dailyData.length));
  
  // Find best day
  const best = dailyImpacts.reduce((max, d) => d.impact > max.impact ? d : max, dailyImpacts[0]);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  // Calculate trend (first half vs second half)
  const mid = Math.floor(dailyImpacts.length / 2);
  const firstHalf = dailyImpacts.slice(0, mid).reduce((s, d) => s + d.impact, 0);
  const secondHalf = dailyImpacts.slice(mid).reduce((s, d) => s + d.impact, 0);
  const trendPercent = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;
  
  return {
    totalImpact,
    bestDay: {
      name: best?.date ? dayNames[best.date.getDay()] : 'N/A',
      amount: best?.impact || 0,
    },
    avgPerDay,
    trend: trendPercent > 5 ? 'up' : trendPercent < -5 ? 'down' : 'stable',
    trendPercent: Math.abs(trendPercent),
  };
}

/**
 * Format currency
 */
export function formatCurrency(amount: number): string {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }
  return `$${amount.toLocaleString()}`;
}

/**
 * Get time-based revenue context
 */
export function getTimeContext(): {
  period: 'early' | 'building' | 'peak' | 'late';
  label: string;
  expectation: string;
} {
  const hour = new Date().getHours();
  
  if (hour < 17) {
    return {
      period: 'early',
      label: 'Pre-Service',
      expectation: 'Prep time - revenue builds later',
    };
  } else if (hour < 20) {
    return {
      period: 'building',
      label: 'Building',
      expectation: 'Crowd is gathering',
    };
  } else if (hour < 24) {
    return {
      period: 'peak',
      label: 'Peak Hours',
      expectation: 'Maximum revenue potential',
    };
  } else {
    return {
      period: 'late',
      label: 'Late Night',
      expectation: 'Capturing last orders',
    };
  }
}
