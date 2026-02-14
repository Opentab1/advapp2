# 🎵 Spotify Field Fix - Complete Guide

## 🎯 The Problem

Your Raspberry Pi is successfully sending Spotify song data via MQTT:
```json
{
  "spotify": {
    "current_song": "Mack the Knife",
    "artist": "Bobby Darin",
    "album_art": null
  }
}
```

**BUT** this data is NOT being saved to DynamoDB, so your dashboard doesn't show songs.

## 🔍 Root Cause

The AWS IoT Rule `PulseSensorDataRule` has this SQL:
```sql
SELECT * FROM 'pulse/sensors/#'
```

This copies the ENTIRE message structure, including the nested `spotify` object. However, your DynamoDB schema expects FLAT fields:
- `currentSong` (not `spotify.current_song`)
- `artist` (not `spotify.artist`)
- `albumArt` (not `spotify.album_art`)

## ✅ The Solution

Update the IoT Rule SQL to **flatten** the spotify fields:
```sql
SELECT 
  deviceId, 
  venueId, 
  timestamp, 
  sensors, 
  occupancy,
  spotify.current_song AS currentSong,
  spotify.artist AS artist,
  spotify.album_art AS albumArt
FROM 'pulse/sensors/#'
```

---

## 🚀 Quick Fix (Choose One Method)

### Method 1: Automated Script (Recommended)

```bash
# Check current status
./check-spotify-data.sh

# Fix the issue automatically
./fix-iot-rule-spotify.sh
```

### Method 2: AWS Console (Manual)

1. Go to: https://console.aws.amazon.com/iot/home?region=us-east-2
2. Click: **Message routing** → **Rules** → **PulseSensorDataRule**
3. Click: **Edit** button (top right)
4. Replace the SQL statement with:
   ```sql
   SELECT deviceId, venueId, timestamp, sensors, occupancy, spotify.current_song AS currentSong, spotify.artist AS artist, spotify.album_art AS albumArt FROM 'pulse/sensors/#'
   ```
5. Click: **Next** → **Next** → **Update**

### Method 3: AWS CLI (One Command)

First, get your IAM role ARN:
```bash
aws iot get-topic-rule --rule-name PulseSensorDataRule --region us-east-2 | jq -r '.rule.actions[0].dynamoDBv2.roleArn'
```

Then create a file `/tmp/rule.json` with:
```json
{
  "sql": "SELECT deviceId, venueId, timestamp, sensors, occupancy, spotify.current_song AS currentSong, spotify.artist AS artist, spotify.album_art AS albumArt FROM 'pulse/sensors/#'",
  "description": "Save Pulse sensor data to DynamoDB with flattened Spotify fields",
  "actions": [
    {
      "dynamoDBv2": {
        "roleArn": "YOUR_ROLE_ARN_HERE",
        "putItem": {
          "tableName": "SensorData"
        }
      }
    }
  ],
  "ruleDisabled": false,
  "awsIotSqlVersion": "2016-03-23"
}
```

Replace `YOUR_ROLE_ARN_HERE` with the ARN from the previous command, then:
```bash
aws iot replace-topic-rule --rule-name PulseSensorDataRule --topic-rule-payload file:///tmp/rule.json --region us-east-2
```

---

## 🧪 Verification

### Step 1: Check the Rule Updated
```bash
aws iot get-topic-rule --rule-name PulseSensorDataRule --region us-east-2 | grep "currentSong"
```

You should see: `spotify.current_song AS currentSong`

### Step 2: Check MQTT Messages (Should Still Work)
Go to: AWS IoT Console → MQTT test client → Subscribe to `pulse/sensors/#`

Verify messages still have the `spotify` object.

### Step 3: Check DynamoDB Gets the Fields
```bash
# Wait 10 seconds for new data, then:
aws dynamodb scan --table-name SensorData --limit 1 --region us-east-2 | jq '.Items[0]' | grep -E "(currentSong|artist)"
```

You should see:
```json
"currentSong": {
  "S": "Mack the Knife"
},
"artist": {
  "S": "Bobby Darin"
}
```

### Step 4: Check Your Dashboard
1. Open your dashboard at: https://main.d1e8gqczrczr91.amplifyapp.com/
2. Log in as: jn@jn.com
3. Look at the "Now Playing" widget
4. You should see: **"Mack the Knife - Bobby Darin"** 🎵

---

## 📊 Before & After Comparison

### Before Fix (DynamoDB Item):
```json
{
  "venueId": {"S": "jimmyneutron"},
  "timestamp": {"S": "2025-11-14T08:00:00Z"},
  "sensors": {"M": {...}},
  "occupancy": {"M": {...}}
  // ❌ NO currentSong!
}
```

### After Fix (DynamoDB Item):
```json
{
  "venueId": {"S": "jimmyneutron"},
  "timestamp": {"S": "2025-11-14T08:00:00Z"},
  "sensors": {"M": {...}},
  "occupancy": {"M": {...}},
  "currentSong": {"S": "Mack the Knife"},
  "artist": {"S": "Bobby Darin"},
  "albumArt": {"NULL": true}
  // ✅ Spotify fields present!
}
```

---

## 🛠️ Troubleshooting

### "Rule updated but still no currentSong in DynamoDB"

**Solution**: Wait 10 seconds for NEW sensor data. Old data is unchanged.

### "AWS CLI command failed with 'Invalid SQL'"

**Solution**: Make sure field names match exactly:
- `spotify.current_song` (underscore, as sent by RPi)
- `spotify.artist`
- `spotify.album_art`

### "Dashboard still doesn't show songs"

**Checklist**:
1. ✅ IoT Rule SQL updated? Check with: `aws iot get-topic-rule --rule-name PulseSensorDataRule --region us-east-2`
2. ✅ New DynamoDB items have currentSong? Check with: `aws dynamodb scan --table-name SensorData --limit 1`
3. ✅ Dashboard polling? Wait 10 seconds (dashboard polls every 10 seconds)
4. ✅ Browser cache cleared? Try: Ctrl+Shift+R (hard refresh)

### "MQTT messages don't have spotify field"

**Check Raspberry Pi**:
```bash
# SSH to RPi
ssh pi@YOUR_RPI_IP

# Check if service is running
sudo systemctl status pulse-aws-publisher

# Check logs for song detection
sudo tail -f /var/log/pulse/aws-publisher.log | grep "🎵 Song detected"
```

---

## 📋 Files Reference

| File | Purpose |
|------|---------|
| `FIX_SPOTIFY_FIELD_DYNAMODB.md` | Detailed explanation of the issue and fix |
| `fix-iot-rule-spotify.sh` | Automated fix script |
| `check-spotify-data.sh` | Diagnostic script to check status |
| `SPOTIFY_FIX_README.md` | This file - quick reference guide |

---

## 🎉 Success Checklist

- [ ] IoT Rule SQL updated with `currentSong AS` mapping
- [ ] New DynamoDB items have `currentSong`, `artist`, `albumArt` fields
- [ ] Dashboard "Now Playing" widget shows song name
- [ ] Songs update when RPi detects new music

---

## 🚨 Important Notes

1. **Only NEW data** is affected. Old DynamoDB items remain unchanged.
2. **RPi must be running** and publishing every 5 seconds.
3. **Dashboard polls every 10 seconds**, so changes may take up to 10 seconds to appear.
4. **Null values are OK** - if no song is playing, `currentSong` will be `null` or empty.

---

## 📞 Need Help?

Run the diagnostic script:
```bash
./check-spotify-data.sh
```

This will tell you exactly what's working and what's not.

---

**Time to fix**: 2 minutes  
**Risk**: Very low (only affects new data)  
**Rollback**: Change SQL back to `SELECT * FROM 'pulse/sensors/#'`

**Ready? Run: `./fix-iot-rule-spotify.sh`** 🚀
