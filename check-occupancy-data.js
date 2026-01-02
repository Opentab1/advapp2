/**
 * Occupancy Data Diagnostic Script
 * 
 * Run this in your browser console (F12 → Console) while logged into the dashboard
 * to check if occupancy data is flowing correctly.
 */

async function checkOccupancyData() {
  console.log('🔍 Checking Occupancy Data Flow...\n');
  
  // Get stored user
  const userStr = localStorage.getItem('user');
  if (!userStr) {
    console.error('❌ Not logged in. Please log in first.');
    return;
  }
  
  const user = JSON.parse(userStr);
  console.log(`✅ Logged in as: ${user.venueName} (${user.venueId})\n`);
  
  console.log('=' .repeat(50));
  console.log('STEP 1: Checking Live Sensor Data');
  console.log('=' .repeat(50));
  
  // This would require importing the API service, so just show what to look for
  console.log(`
To check live sensor data, open Network tab and look for GraphQL requests.

Look for a request with:
  Query: listSensorData
  
In the response, check if items include:
  {
    "venueId": "${user.venueId}",
    "timestamp": "...",
    "decibels": 74,
    "occupancy": {        ← THIS SHOULD EXIST
      "current": 32,
      "entries": 120,
      "exits": 88
    }
  }

If "occupancy" is null or missing:
  → The IoT device isn't sending occupancy data
  → OR the IoT Rule isn't including it
  → OR the DynamoDB table doesn't have it
`);

  console.log('\n' + '=' .repeat(50));
  console.log('STEP 2: What to Check in AWS Console');
  console.log('=' .repeat(50));
  
  console.log(`
1. DynamoDB → Tables → Your sensor table → Explore items
   Look for "occupancy" field in recent records

2. IoT Core → Rules → Your rule → SQL Statement
   Should include: occupancy

3. AppSync → Schema
   Should have:
   
   type OccupancyData {
     current: Int
     entries: Int
     exits: Int
   }
   
   type SensorData {
     ...
     occupancy: OccupancyData
   }
`);

  console.log('\n' + '=' .repeat(50));
  console.log('STEP 3: Test Publish (on Raspberry Pi)');
  console.log('=' .repeat(50));
  
  console.log(`
SSH into your Pi and run:

  curl http://localhost:8080/api/sensors

Response should include:
  "occupancy": 32,
  "entries": 120,
  "exits": 88

If missing, your people counter software needs to expose these values.
`);

  console.log('\n✅ Diagnostic complete. Check the steps above.');
}

// Run it
checkOccupancyData();
