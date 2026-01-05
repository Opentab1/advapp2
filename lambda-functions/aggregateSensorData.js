/**
 * Lambda: aggregateSensorData
 * 
 * Aggregates raw sensor data into hourly buckets for fast chart queries.
 * 
 * Trigger: CloudWatch Events - runs every hour at :05 (5 minutes past)
 * Or: Can be triggered manually via AWS Console / CLI
 * 
 * What it does:
 * 1. Queries raw SensorData for the last hour
 * 2. Calculates TRUE averages, max, min from ALL readings
 * 3. Writes aggregated data to SensorDataHourly table
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { 
  DynamoDBDocumentClient, 
  QueryCommand, 
  PutCommand 
} = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

// Table names - update these to match your setup
const RAW_TABLE = process.env.RAW_TABLE || 'SensorData';
const HOURLY_TABLE = process.env.HOURLY_TABLE || 'SensorDataHourly';

exports.handler = async (event) => {
  console.log('🚀 Starting hourly aggregation...');
  console.log('📋 Event:', JSON.stringify(event, null, 2));
  
  try {
    // Get list of venues to process
    const venues = event.venues || process.env.VENUES?.split(',') || ['jimmyneutron'];
    
    // ============================================
    // BACKFILL MODE: Process multiple days at once
    // ============================================
    // Trigger with: { "backfill": true, "days": 90, "venues": ["jimmyneutron"] }
    
    if (event.backfill) {
      const days = event.days || 7;
      console.log(`🔄 BACKFILL MODE: Processing ${days} days for ${venues.length} venue(s)`);
      const results = await backfillHistorical(venues, days);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `Backfill complete: ${days} days`,
          venuesProcessed: venues.length,
          hoursProcessed: results.length,
          results: results.slice(0, 10) // Sample of results
        })
      };
    }
    
    // ============================================
    // NORMAL MODE: Process the previous hour
    // ============================================
    const now = new Date();
    const hourEnd = new Date(now);
    hourEnd.setMinutes(0, 0, 0); // Start of current hour
    const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000); // 1 hour before
    
    // Allow override via event for specific time ranges
    const startTime = event.startTime ? new Date(event.startTime) : hourStart;
    const endTime = event.endTime ? new Date(event.endTime) : hourEnd;
    
    console.log(`📅 Aggregating: ${startTime.toISOString()} to ${endTime.toISOString()}`);
    console.log(`🏢 Venues: ${venues.join(', ')}`);
    
    const results = [];
    
    for (const venueId of venues) {
      console.log(`\n📊 Processing venue: ${venueId}`);
      
      try {
        const result = await aggregateVenueHour(venueId, startTime, endTime);
        results.push({ venueId, success: true, ...result });
      } catch (error) {
        console.error(`❌ Error processing ${venueId}:`, error);
        results.push({ venueId, success: false, error: error.message });
      }
    }
    
    console.log('\n✅ Aggregation complete!');
    console.log('Results:', JSON.stringify(results, null, 2));
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Aggregation complete',
        timeRange: { start: startTime.toISOString(), end: endTime.toISOString() },
        results
      })
    };
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Aggregate one hour of data for a single venue
 */
async function aggregateVenueHour(venueId, startTime, endTime) {
  // Fetch ALL raw data for this hour
  const rawData = await fetchRawData(venueId, startTime, endTime);
  
  console.log(`  📥 Fetched ${rawData.length} raw data points`);
  
  if (rawData.length === 0) {
    console.log(`  ⚠️ No data found for this hour`);
    return { dataPoints: 0, skipped: true };
  }
  
  // Calculate aggregates
  const aggregated = calculateAggregates(rawData, startTime);
  
  // Write to hourly table
  await writeHourlyData(venueId, startTime, aggregated);
  
  console.log(`  ✅ Written hourly aggregate: dB=${aggregated.avgDecibels}, occ=${aggregated.maxOccupancy}`);
  
  return { 
    dataPoints: rawData.length, 
    avgDecibels: aggregated.avgDecibels,
    maxOccupancy: aggregated.maxOccupancy
  };
}

/**
 * Fetch all raw sensor data for a time range
 */
async function fetchRawData(venueId, startTime, endTime) {
  const allItems = [];
  let lastEvaluatedKey = null;
  
  do {
    const params = {
      TableName: RAW_TABLE,
      KeyConditionExpression: 'venueId = :venueId AND #ts BETWEEN :start AND :end',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      },
      ExpressionAttributeValues: {
        ':venueId': venueId,
        ':start': startTime.toISOString(),
        ':end': endTime.toISOString()
      },
      Limit: 1000
    };
    
    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }
    
    const response = await docClient.send(new QueryCommand(params));
    allItems.push(...(response.Items || []));
    lastEvaluatedKey = response.LastEvaluatedKey;
    
  } while (lastEvaluatedKey);
  
  return allItems;
}

/**
 * Helper to extract sensor value from either nested or flat structure
 * Handles both formats:
 *   - Nested: { sensors: { sound_level: 75 } }
 *   - Flat: { decibels: 75 }
 */
function getSensorValue(item, nestedPath, flatKey) {
  // Try nested structure first (new RPi publisher format)
  if (item.sensors && item.sensors[nestedPath] !== undefined) {
    return item.sensors[nestedPath];
  }
  // Fall back to flat structure (legacy format)
  if (item[flatKey] !== undefined) {
    return item[flatKey];
  }
  return null;
}

/**
 * Calculate TRUE aggregates from raw data
 * Supports both nested (sensors.sound_level) and flat (decibels) data formats
 */
function calculateAggregates(rawData, hourStart) {
  // Initialize accumulators
  let sumDecibels = 0, countDecibels = 0;
  let sumLight = 0, countLight = 0;
  let sumIndoorTemp = 0, countIndoorTemp = 0;
  let sumOutdoorTemp = 0, countOutdoorTemp = 0;
  let sumHumidity = 0, countHumidity = 0;
  
  let minDecibels = Infinity, maxDecibels = -Infinity;
  let minLight = Infinity, maxLight = -Infinity;
  let maxOccupancy = 0;
  let totalEntries = 0, totalExits = 0;
  
  // Track songs played
  const songCounts = new Map();
  
  for (const item of rawData) {
    // Decibels - check nested sensors.sound_level OR flat decibels
    const decibels = getSensorValue(item, 'sound_level', 'decibels');
    if (decibels !== null && decibels > 0) {
      sumDecibels += decibels;
      countDecibels++;
      if (decibels < minDecibels) minDecibels = decibels;
      if (decibels > maxDecibels) maxDecibels = decibels;
    }
    
    // Light - check nested sensors.light_level OR flat light
    const light = getSensorValue(item, 'light_level', 'light');
    if (light !== null && light >= 0) {
      sumLight += light;
      countLight++;
      if (light < minLight) minLight = light;
      if (light > maxLight) maxLight = light;
    }
    
    // Indoor temp - check nested sensors.indoor_temperature OR flat indoorTemp
    const indoorTemp = getSensorValue(item, 'indoor_temperature', 'indoorTemp');
    if (indoorTemp !== null && indoorTemp > 0) {
      sumIndoorTemp += indoorTemp;
      countIndoorTemp++;
    }
    
    // Outdoor temp - check nested sensors.outdoor_temperature OR flat outdoorTemp
    const outdoorTemp = getSensorValue(item, 'outdoor_temperature', 'outdoorTemp');
    if (outdoorTemp !== null) {
      sumOutdoorTemp += outdoorTemp;
      countOutdoorTemp++;
    }
    
    // Humidity - check nested sensors.humidity OR flat humidity
    const humidity = getSensorValue(item, 'humidity', 'humidity');
    if (humidity !== null && humidity >= 0) {
      sumHumidity += humidity;
      countHumidity++;
    }
    
    // Occupancy (already nested, works the same)
    if (item.occupancy) {
      if (item.occupancy.current > maxOccupancy) {
        maxOccupancy = item.occupancy.current;
      }
      // For entries/exits, we want the max seen (cumulative counter)
      if (item.occupancy.entries) totalEntries = Math.max(totalEntries, item.occupancy.entries);
      if (item.occupancy.exits) totalExits = Math.max(totalExits, item.occupancy.exits);
    }
    
    // Track songs - check nested spotify OR flat currentSong/artist
    let songTitle = null, artistName = null;
    if (item.spotify) {
      songTitle = item.spotify.current_song;
      artistName = item.spotify.artist;
    } else if (item.currentSong && item.artist) {
      songTitle = item.currentSong;
      artistName = item.artist;
    }
    if (songTitle && artistName) {
      const key = `${songTitle}|||${artistName}`;
      songCounts.set(key, (songCounts.get(key) || 0) + 1);
    }
  }
  
  // Find top song
  let topSong = null, topArtist = null, topSongCount = 0;
  for (const [key, count] of songCounts) {
    if (count > topSongCount) {
      topSongCount = count;
      [topSong, topArtist] = key.split('|||');
    }
  }
  
  // Calculate averages (rounded for cleanliness)
  return {
    // Timestamp for this bucket (start of hour)
    timestamp: hourStart.toISOString(),
    
    // Averages
    avgDecibels: countDecibels > 0 ? Math.round((sumDecibels / countDecibels) * 10) / 10 : null,
    avgLight: countLight > 0 ? Math.round(sumLight / countLight) : null,
    avgIndoorTemp: countIndoorTemp > 0 ? Math.round((sumIndoorTemp / countIndoorTemp) * 10) / 10 : null,
    avgOutdoorTemp: countOutdoorTemp > 0 ? Math.round((sumOutdoorTemp / countOutdoorTemp) * 10) / 10 : null,
    avgHumidity: countHumidity > 0 ? Math.round(sumHumidity / countHumidity) : null,
    
    // Min/Max
    minDecibels: minDecibels !== Infinity ? Math.round(minDecibels * 10) / 10 : null,
    maxDecibels: maxDecibels !== -Infinity ? Math.round(maxDecibels * 10) / 10 : null,
    minLight: minLight !== Infinity ? minLight : null,
    maxLight: maxLight !== -Infinity ? maxLight : null,
    
    // Occupancy
    maxOccupancy: maxOccupancy,
    totalEntries: totalEntries,
    totalExits: totalExits,
    
    // Top song
    topSong: topSong,
    topArtist: topArtist,
    topSongPlayCount: topSongCount,
    
    // Metadata
    dataPointCount: rawData.length,
    aggregatedAt: new Date().toISOString()
  };
}

/**
 * Write aggregated data to hourly table
 */
async function writeHourlyData(venueId, hourStart, aggregated) {
  const params = {
    TableName: HOURLY_TABLE,
    Item: {
      venueId: venueId,
      timestamp: hourStart.toISOString(),
      ...aggregated
    }
  };
  
  await docClient.send(new PutCommand(params));
}

/**
 * Utility: Backfill historical data
 * Call with event: { "backfill": true, "days": 7, "venues": ["jimmyneutron"] }
 */
async function backfillHistorical(venues, days) {
  console.log(`🔄 Backfilling ${days} days of data...`);
  
  const now = new Date();
  const results = [];
  
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const hourEnd = new Date(now);
      hourEnd.setDate(hourEnd.getDate() - d);
      hourEnd.setHours(23 - h, 0, 0, 0);
      const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000);
      
      for (const venueId of venues) {
        try {
          const result = await aggregateVenueHour(venueId, hourStart, hourEnd);
          results.push({ day: d, hour: h, venueId, ...result });
        } catch (error) {
          console.error(`Error backfilling ${venueId} day ${d} hour ${h}:`, error.message);
        }
      }
    }
    console.log(`  Day ${d + 1}/${days} complete`);
  }
  
  return results;
}

// Export for testing
module.exports = { 
  handler: exports.handler,
  aggregateVenueHour,
  calculateAggregates,
  backfillHistorical
};
