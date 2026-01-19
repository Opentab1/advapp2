/**
 * Lambda Function: sendWeeklyReports
 * 
 * Triggered by EventBridge on a schedule (e.g., every Monday at 9am)
 * Generates and sends weekly email reports to venue owners
 * 
 * Environment Variables Required:
 * - SENDER_EMAIL: Verified SES sender email (e.g., reports@yourdomain.com)
 * - DASHBOARD_URL: URL to the dashboard (e.g., https://app.yourdomain.com)
 * - AWS_REGION: AWS region for SES (e.g., us-east-2)
 */

const { DynamoDBClient, ScanCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamodb = new DynamoDBClient({});
const ses = new SESClient({});

const SENDER_EMAIL = process.env.SENDER_EMAIL || 'reports@pulse-dashboard.com';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://app.pulse-dashboard.com';

exports.handler = async (event) => {
  console.log('📧 Starting weekly report generation...');
  
  try {
    // Get all venues with email reporting enabled
    const venues = await getVenuesWithEmailEnabled();
    console.log(`📧 Found ${venues.length} venues with email reporting enabled`);
    
    const results = {
      success: [],
      failed: [],
      skipped: []
    };
    
    for (const venue of venues) {
      try {
        // Check if email settings are valid
        if (!venue.emailConfig?.recipients?.length) {
          results.skipped.push({ venueId: venue.venueId, reason: 'No recipients configured' });
          continue;
        }
        
        // Generate report data
        const reportData = await generateReportData(venue.venueId, venue.venueName);
        
        if (!reportData) {
          results.skipped.push({ venueId: venue.venueId, reason: 'No data available' });
          continue;
        }
        
        // Generate email content
        const emailHtml = generateEmailHTML(reportData, DASHBOARD_URL);
        const emailText = generateEmailText(reportData, DASHBOARD_URL);
        
        // Send email
        await sendEmail(
          venue.emailConfig.recipients,
          `Your Week at ${venue.venueName} — ${reportData.reportPeriod.label}`,
          emailHtml,
          emailText
        );
        
        results.success.push({ venueId: venue.venueId, recipients: venue.emailConfig.recipients });
        console.log(`✅ Sent report for ${venue.venueName} to ${venue.emailConfig.recipients.join(', ')}`);
        
      } catch (error) {
        console.error(`❌ Failed to send report for ${venue.venueId}:`, error);
        results.failed.push({ venueId: venue.venueId, error: error.message });
      }
    }
    
    console.log('📧 Weekly report generation complete:', results);
    
    return {
      statusCode: 200,
      body: JSON.stringify(results)
    };
    
  } catch (error) {
    console.error('📧 Fatal error in weekly report generation:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Get all venues with email reporting enabled
 */
async function getVenuesWithEmailEnabled() {
  const command = new ScanCommand({
    TableName: 'VenueConfig',
    FilterExpression: 'emailConfig.enabled = :enabled',
    ExpressionAttributeValues: {
      ':enabled': { BOOL: true }
    }
  });
  
  const response = await dynamodb.send(command);
  return (response.Items || []).map(item => unmarshall(item));
}

/**
 * Generate report data for a venue
 */
async function generateReportData(venueId, venueName) {
  // Get this week's data (last 7 days)
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  
  // Query sensor data for this week
  const thisWeekData = await querySensorData(venueId, weekAgo, now);
  if (!thisWeekData.length) return null;
  
  // Query previous week for comparison
  const prevWeekData = await querySensorData(venueId, twoWeeksAgo, weekAgo);
  
  // Calculate metrics
  const highlights = calculateHighlights(thisWeekData, prevWeekData);
  const dailyScores = calculateDailyScores(thisWeekData);
  const music = await getMusicData(venueId, thisWeekData);
  
  const weeklyAvgScore = dailyScores.length > 0
    ? Math.round(dailyScores.reduce((sum, d) => sum + d.score, 0) / dailyScores.length)
    : 0;
  
  const prevDailyScores = calculateDailyScores(prevWeekData);
  const prevWeeklyAvgScore = prevDailyScores.length > 0
    ? Math.round(prevDailyScores.reduce((sum, d) => sum + d.score, 0) / prevDailyScores.length)
    : weeklyAvgScore;
  
  return {
    venueName,
    venueId,
    reportPeriod: {
      start: weekAgo.toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
      label: formatDateRange(weekAgo, now)
    },
    highlights,
    music,
    dailyScores,
    weeklyAvgScore,
    weeklyScoreDelta: weeklyAvgScore - prevWeeklyAvgScore,
    insights: generateInsights(highlights, music, dailyScores),
    suggestedActions: generateSuggestedActions(highlights, music, dailyScores)
  };
}

/**
 * Query sensor data from DynamoDB
 */
async function querySensorData(venueId, startTime, endTime) {
  const command = new QueryCommand({
    TableName: 'SensorData',
    KeyConditionExpression: 'venueId = :venueId AND #ts BETWEEN :start AND :end',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':venueId': { S: venueId },
      ':start': { S: startTime.toISOString() },
      ':end': { S: endTime.toISOString() }
    },
    Limit: 10000
  });
  
  const response = await dynamodb.send(command);
  return (response.Items || []).map(item => unmarshall(item));
}

/**
 * Calculate highlight metrics
 */
function calculateHighlights(thisWeekData, prevWeekData) {
  const sorted = [...thisWeekData].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Total guests
  const withEntries = sorted.filter(d => d.occupancy?.entries !== undefined);
  let totalGuests = 0;
  if (withEntries.length >= 2) {
    totalGuests = Math.max(0, 
      (withEntries[withEntries.length - 1].occupancy?.entries || 0) - 
      (withEntries[0].occupancy?.entries || 0)
    );
  }
  
  // Previous week guests
  let prevGuests = 0;
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
  
  const guestsDelta = prevGuests > 0 
    ? Math.round(((totalGuests - prevGuests) / prevGuests) * 100) 
    : 0;
  
  // Peak night
  const dailyGuests = calculateDailyGuests(sorted);
  const peakDay = dailyGuests.reduce((max, day) => 
    day.guests > max.guests ? day : max,
    { day: 'N/A', guests: 0 }
  );
  
  // Best hour
  const hourlyOcc = calculateHourlyOccupancy(sorted);
  const bestHour = hourlyOcc.reduce((max, h) => 
    h.avgOccupancy > max.avgOccupancy ? h : max,
    { hour: 0, avgOccupancy: 0 }
  );
  
  // Avg stay (simplified calculation)
  let avgStayMinutes = null;
  if (totalGuests > 0 && sorted.length > 0) {
    const avgOccupancy = sorted.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / sorted.length;
    const totalHours = (new Date(sorted[sorted.length - 1].timestamp).getTime() - new Date(sorted[0].timestamp).getTime()) / (1000 * 60 * 60);
    if (totalHours > 0 && totalGuests > 0) {
      avgStayMinutes = Math.round((avgOccupancy * totalHours * 60) / totalGuests);
    }
  }
  
  return {
    totalGuests,
    guestsDelta,
    peakNight: peakDay.day,
    peakNightGuests: peakDay.guests,
    avgStayMinutes,
    avgStayDelta: null, // Simplified for Lambda
    bestHour: formatHour(bestHour.hour)
  };
}

/**
 * Calculate daily guests
 */
function calculateDailyGuests(data) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const byDay = new Map();
  
  data.forEach(d => {
    const date = new Date(d.timestamp);
    const dayKey = date.toISOString().split('T')[0];
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(d);
  });
  
  const result = [];
  byDay.forEach((dayData, dateKey) => {
    const date = new Date(dateKey);
    const dayName = days[date.getDay()];
    const sorted = dayData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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
 * Calculate hourly occupancy
 */
function calculateHourlyOccupancy(data) {
  const hourlyData = new Map();
  
  data.forEach(d => {
    const hour = new Date(d.timestamp).getHours();
    const occupancy = d.occupancy?.current || 0;
    if (!hourlyData.has(hour)) hourlyData.set(hour, []);
    hourlyData.get(hour).push(occupancy);
  });
  
  const result = [];
  hourlyData.forEach((occupancies, hour) => {
    const avg = occupancies.reduce((sum, o) => sum + o, 0) / occupancies.length;
    result.push({ hour, avgOccupancy: Math.round(avg) });
  });
  
  return result;
}

/**
 * Calculate daily scores
 */
function calculateDailyScores(data) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDay = new Map();
  
  data.forEach(d => {
    const date = new Date(d.timestamp);
    const dayKey = date.toISOString().split('T')[0];
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push(d);
  });
  
  const result = [];
  byDay.forEach((dayData, dateKey) => {
    const date = new Date(dateKey);
    const dayIndex = date.getDay();
    
    const avgOcc = dayData.reduce((sum, d) => sum + (d.occupancy?.current || 0), 0) / dayData.length;
    const maxOcc = Math.max(...dayData.map(d => d.occupancy?.current || 0));
    const score = maxOcc > 0 ? Math.round((avgOcc / maxOcc) * 100) : 0;
    
    const sorted = dayData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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
  
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return result.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
}

/**
 * Get music data (simplified - just extract from sensor data)
 */
async function getMusicData(venueId, sensorData) {
  // Extract songs from sensor data
  const songPlays = new Map();
  let lastSong = '';
  
  const sorted = [...sensorData].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  for (let i = 0; i < sorted.length; i++) {
    const reading = sorted[i];
    if (!reading.currentSong) continue;
    
    const key = `${reading.currentSong}|${reading.artist || 'Unknown'}`;
    if (key === lastSong) continue;
    
    lastSong = key;
    
    // Calculate retention for this song play
    const startCrowd = reading.occupancy?.current || 0;
    let endCrowd = startCrowd;
    
    // Find end of this song (when it changes)
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].currentSong !== reading.currentSong) {
        endCrowd = sorted[j - 1]?.occupancy?.current || startCrowd;
        break;
      }
    }
    
    const retention = startCrowd > 0 ? (endCrowd / startCrowd) * 100 : 100;
    
    if (!songPlays.has(key)) {
      songPlays.set(key, {
        song: reading.currentSong,
        artist: reading.artist || 'Unknown',
        retentionRates: [],
        plays: 0
      });
    }
    
    const data = songPlays.get(key);
    data.plays++;
    data.retentionRates.push(retention);
  }
  
  // Calculate top retention songs
  const songList = Array.from(songPlays.values()).map(s => ({
    song: s.song,
    artist: s.artist,
    retentionRate: s.retentionRates.length > 0
      ? Math.round(s.retentionRates.reduce((a, b) => a + b, 0) / s.retentionRates.length * 10) / 10
      : 100,
    plays: s.plays
  }));
  
  songList.sort((a, b) => b.retentionRate - a.retentionRate);
  
  return {
    topRetentionSongs: songList.slice(0, 3),
    topGenre: 'N/A', // Would need genre detection logic
    topGenrePlayCount: 0,
    topGenreRetention: 100
  };
}

/**
 * Generate insights
 */
function generateInsights(highlights, music, dailyScores) {
  const insights = [];
  
  if (dailyScores.length > 0) {
    const bestDay = dailyScores.reduce((max, d) => d.score > max.score ? d : max, dailyScores[0]);
    insights.push(`${bestDay.day} was your best performing day with a ${bestDay.score} Pulse Score`);
  }
  
  if (highlights.guestsDelta !== 0) {
    const direction = highlights.guestsDelta > 0 ? 'up' : 'down';
    insights.push(`Guest count ${direction} ${Math.abs(highlights.guestsDelta)}% compared to last week`);
  }
  
  if (music.topRetentionSongs.length > 0 && music.topRetentionSongs[0].retentionRate > 100) {
    insights.push(`"${music.topRetentionSongs[0].song}" had the best crowd retention this week`);
  }
  
  return insights;
}

/**
 * Generate suggested actions
 */
function generateSuggestedActions(highlights, music, dailyScores) {
  const actions = [];
  
  if (music.topRetentionSongs.length > 0) {
    actions.push(`Keep "${music.topRetentionSongs[0].song}" in your rotation — crowds love it`);
  }
  
  if (dailyScores.length > 0) {
    const slowestDay = dailyScores.reduce((min, d) => d.guests < min.guests ? d : min, dailyScores[0]);
    if (slowestDay.guests < highlights.peakNightGuests * 0.3) {
      actions.push(`${slowestDay.day} was quiet — consider a promotion or themed night`);
    }
  }
  
  return actions;
}

/**
 * Format hour for display
 */
function formatHour(hour) {
  const h = hour % 12 || 12;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const nextH = (hour + 1) % 12 || 12;
  const nextSuffix = (hour + 1) >= 12 ? 'pm' : 'am';
  return `${h}${suffix}-${nextH}${nextSuffix}`;
}

/**
 * Format date range for display
 */
function formatDateRange(start, end) {
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}, ${end.getFullYear()}`;
}

/**
 * Send email via SES
 */
async function sendEmail(recipients, subject, htmlBody, textBody) {
  const command = new SendEmailCommand({
    Source: SENDER_EMAIL,
    Destination: {
      ToAddresses: recipients
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8'
      },
      Body: {
        Html: {
          Data: htmlBody,
          Charset: 'UTF-8'
        },
        Text: {
          Data: textBody,
          Charset: 'UTF-8'
        }
      }
    }
  });
  
  return ses.send(command);
}

/**
 * Generate HTML email content
 */
function generateEmailHTML(report, dashboardUrl) {
  const scoreBar = (score) => '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
  const retentionDisplay = (rate) => {
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
    .section-title { font-size: 16px; color: #00d9ff; margin: 0 0 15px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
    .metric { background: #1a2744; padding: 15px; border-radius: 8px; }
    .metric-value { font-size: 28px; font-weight: bold; color: #00d9ff; }
    .metric-label { font-size: 12px; color: #8b9dc3; margin-top: 5px; }
    .metric-delta { font-size: 12px; margin-top: 5px; }
    .delta-up { color: #10b981; }
    .delta-down { color: #ef4444; }
    .song-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #2a3f5f; }
    .score-row { display: flex; justify-content: space-between; padding: 8px 0; font-family: monospace; }
    .insight { padding: 10px 0; border-bottom: 1px solid #2a3f5f; font-size: 14px; }
    .action { background: #1a2744; padding: 12px 15px; border-radius: 8px; margin-bottom: 10px; font-size: 14px; border-left: 3px solid #00d9ff; }
    .cta-button { display: inline-block; background: #00d9ff; color: #16213e; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; }
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
          ${report.highlights.guestsDelta !== 0 ? `<div class="metric-delta ${report.highlights.guestsDelta > 0 ? 'delta-up' : 'delta-down'}">${report.highlights.guestsDelta > 0 ? '↑' : '↓'} ${Math.abs(report.highlights.guestsDelta)}%</div>` : ''}
        </div>
        <div class="metric">
          <div class="metric-value">${report.highlights.peakNight}</div>
          <div class="metric-label">Peak Night (${report.highlights.peakNightGuests} guests)</div>
        </div>
        <div class="metric">
          <div class="metric-value">${report.highlights.avgStayMinutes !== null ? report.highlights.avgStayMinutes + ' min' : 'N/A'}</div>
          <div class="metric-label">Avg Stay</div>
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
      ${report.music.topRetentionSongs.map((song, i) => `
        <div class="song-item">
          <div><strong>${i + 1}. "${song.song}"</strong><br><span style="color:#8b9dc3;font-size:12px">${song.artist}</span></div>
          <div style="color:#10b981;font-weight:bold">${retentionDisplay(song.retentionRate)}</div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <div class="section">
      <h2 class="section-title">📈 Pulse Score Trend</h2>
      ${report.dailyScores.map(day => `
        <div class="score-row">
          <span>${day.shortDay}</span>
          <span style="color:#00d9ff">${scoreBar(day.score)}</span>
          <span style="color:#8b9dc3">${day.score}</span>
        </div>
      `).join('')}
      <p style="text-align:center;margin-top:15px"><strong>Weekly Average: ${report.weeklyAvgScore}</strong> ${report.weeklyScoreDelta !== 0 ? `<span class="${report.weeklyScoreDelta > 0 ? 'delta-up' : 'delta-down'}">(${report.weeklyScoreDelta > 0 ? '↑' : '↓'}${Math.abs(report.weeklyScoreDelta)})</span>` : ''}</p>
    </div>

    ${report.insights.length > 0 ? `
    <div class="section">
      <h2 class="section-title">💡 Insights</h2>
      ${report.insights.map(i => `<div class="insight">• ${i}</div>`).join('')}
    </div>
    ` : ''}

    ${report.suggestedActions.length > 0 ? `
    <div class="section">
      <h2 class="section-title">🎯 Suggested Actions</h2>
      ${report.suggestedActions.map((a, i) => `<div class="action">${i + 1}. ${a}</div>`).join('')}
    </div>
    ` : ''}

    <div class="section" style="text-align:center;border-bottom:none">
      <a href="${dashboardUrl}" class="cta-button">View Full Dashboard →</a>
    </div>

    <div class="footer">
      <p>Generated from your venue's sensor data. Manage preferences in Settings.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate plain text email content
 */
function generateEmailText(report, dashboardUrl) {
  const lines = [
    `📊 WEEKLY REPORT - ${report.venueName}`,
    report.reportPeriod.label,
    '',
    '🎯 HIGHLIGHTS',
    `Total Guests: ${report.highlights.totalGuests}${report.highlights.guestsDelta !== 0 ? ` (${report.highlights.guestsDelta > 0 ? '+' : ''}${report.highlights.guestsDelta}%)` : ''}`,
    `Peak Night: ${report.highlights.peakNight} (${report.highlights.peakNightGuests} guests)`,
    `Avg Stay: ${report.highlights.avgStayMinutes || 'N/A'} min`,
    `Best Hour: ${report.highlights.bestHour}`,
    ''
  ];

  if (report.music.topRetentionSongs.length > 0) {
    lines.push('🎵 MUSIC THAT WORKED');
    report.music.topRetentionSongs.forEach((s, i) => {
      const d = s.retentionRate - 100;
      lines.push(`${i + 1}. "${s.song}" - ${s.artist} (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)`);
    });
    lines.push('');
  }

  lines.push('📈 WEEKLY SCORE');
  report.dailyScores.forEach(d => {
    lines.push(`${d.shortDay}: ${'█'.repeat(Math.round(d.score / 10))}${'░'.repeat(10 - Math.round(d.score / 10))} ${d.score}`);
  });
  lines.push(`\nWeekly Average: ${report.weeklyAvgScore}`, '');

  if (report.insights.length) {
    lines.push('💡 INSIGHTS');
    report.insights.forEach(i => lines.push(`• ${i}`));
    lines.push('');
  }

  lines.push(`View Dashboard: ${dashboardUrl}`);
  return lines.join('\n');
}
