# Fix: Spotify Field Not Saving to DynamoDB

**Problem**: MQTT messages include `spotify` field, but it's NOT being saved to DynamoDB.

**Root Cause**: IoT Rule SQL statement doesn't map the nested `spotify` object to the flat DynamoDB schema fields (`currentSong`, `artist`, `albumArt`).

---

## 🔍 The Issue

### MQTT Message Format (What the RPi sends):
```json
{
  "deviceId": "jimmyneutron-mainfloor-001",
  "venueId": "jimmyneutron",
  "timestamp": "2025-11-14T07:27:46.013711Z",
  "sensors": {...},
  "occupancy": {...},
  "spotify": {
    "current_song": "Mack the Knife",
    "artist": "Bobby Darin",
    "album_art": null
  }
}
```

### DynamoDB Schema (What it expects):
```json
{
  "venueId": "jimmyneutron",
  "timestamp": "2025-11-14T07:27:46.013711Z",
  "sensors": {...},
  "occupancy": {...},
  "currentSong": "Mack the Knife",
  "artist": "Bobby Darin",
  "albumArt": null
}
```

**The Problem**: The IoT Rule is using `SELECT *` which copies the entire message as-is, but DynamoDB needs the `spotify` fields flattened to `currentSong`, `artist`, and `albumArt`.

---

## ✅ The Solution

Update the IoT Rule SQL statement to extract and rename the spotify fields.

### Option 1: AWS Console (Easiest)

1. **Go to AWS IoT Core Console**:
   ```
   https://console.aws.amazon.com/iot/home?region=us-east-2
   ```

2. **Navigate to Rules**:
   - Click "Message routing" → "Rules"
   - Find and click `PulseSensorDataRule`

3. **Edit the SQL Statement**:
   - Click "Edit" button at the top
   - Replace the SQL statement with:

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

4. **Save the Rule**:
   - Click "Next" → "Next" → "Update"

### Option 2: AWS CLI (For Automation)

Run this command to get the current rule configuration:

```bash
aws iot get-topic-rule --rule-name PulseSensorDataRule --region us-east-2 > /tmp/current-rule.json
```

Create a new rule configuration file (`/tmp/updated-rule.json`):

```json
{
  "sql": "SELECT deviceId, venueId, timestamp, sensors, occupancy, spotify.current_song AS currentSong, spotify.artist AS artist, spotify.album_art AS albumArt FROM 'pulse/sensors/#'",
  "description": "Save Pulse sensor data to DynamoDB with flattened Spotify fields",
  "actions": [
    {
      "dynamoDBv2": {
        "roleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/RPISENSORDATARULE",
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

**⚠️ IMPORTANT**: Replace `YOUR_ACCOUNT_ID` with your actual AWS account ID.

Then update the rule:

```bash
aws iot replace-topic-rule \
  --rule-name PulseSensorDataRule \
  --topic-rule-payload file:///tmp/updated-rule.json \
  --region us-east-2
```

---

## 🧪 Verification Steps

### 1. Verify Rule Update

**Console**:
- Go to IoT Core → Message routing → Rules → PulseSensorDataRule
- Check that SQL statement includes `spotify.current_song AS currentSong`

**CLI**:
```bash
aws iot get-topic-rule --rule-name PulseSensorDataRule --region us-east-2 | grep -A 2 "currentSong"
```

### 2. Check MQTT Messages Still Arriving

**Console**:
- Go to IoT Core → MQTT test client
- Subscribe to: `pulse/sensors/#`
- Verify messages appear with `spotify` field

### 3. Check DynamoDB Gets New Fields

**Console**:
- Go to DynamoDB → Tables → SensorData
- Click "Explore table items"
- Look for newest item (sort by timestamp)
- Verify it has `currentSong`, `artist`, `albumArt` fields

**CLI**:
```bash
aws dynamodb scan \
  --table-name SensorData \
  --limit 1 \
  --region us-east-2 \
  --scan-index-forward false \
  | jq '.Items[0]'
```

### 4. Test Dashboard

1. Wait 10 seconds for dashboard to poll
2. Check if "Now Playing" widget shows song
3. Open browser console (F12) and check for `currentSong` in data

---

## 🚨 Troubleshooting

### Issue: Rule update fails with "Invalid SQL"

**Cause**: SQL syntax error

**Fix**: Make sure to use exact SQL from above, with proper field names:
- `spotify.current_song` (underscore, not camelCase)
- `spotify.artist`
- `spotify.album_art`

### Issue: Still no currentSong in DynamoDB

**Check**:
1. Did the rule update successfully?
   ```bash
   aws iot get-topic-rule --rule-name PulseSensorDataRule --region us-east-2
   ```
2. Are new messages arriving after the update?
3. Check CloudWatch Logs for IoT Rule errors:
   ```
   Log group: /aws/iot/rules/PulseSensorDataRule
   ```

### Issue: Old items still don't have spotify fields

**Expected Behavior**: This is normal! Only NEW items (after the rule update) will have the fields.

**Solution**: Wait for new sensor data to be published (every 5 seconds).

---

## 🎯 Expected Results

### Before Fix:
```json
{
  "venueId": {"S": "jimmyneutron"},
  "timestamp": {"S": "2025-11-14T06:37:00.373066Z"},
  "deviceId": {"S": "jimmyneutron-mainfloor-001"},
  "sensors": {"M": {...}},
  "occupancy": {"M": {...}}
  // ❌ NO currentSong, artist, albumArt
}
```

### After Fix:
```json
{
  "venueId": {"S": "jimmyneutron"},
  "timestamp": {"S": "2025-11-14T06:37:00.373066Z"},
  "deviceId": {"S": "jimmyneutron-mainfloor-001"},
  "sensors": {"M": {...}},
  "occupancy": {"M": {...}},
  "currentSong": {"S": "Mack the Knife"},
  "artist": {"S": "Bobby Darin"},
  "albumArt": {"NULL": true}
  // ✅ Spotify fields present!
}
```

---

## 📋 Quick Reference

| Component | Status | Action Needed |
|-----------|--------|---------------|
| RPi Publisher | ✅ Working | None - sends spotify field |
| MQTT Messages | ✅ Correct | None - spotify field present |
| IoT Rule SQL | ❌ Wrong | **UPDATE THIS** |
| DynamoDB Schema | ✅ Correct | None - supports currentSong |
| Dashboard Code | ✅ Ready | None - already displays songs |

**The ONLY thing that needs fixing is the IoT Rule SQL statement.**

---

## 🎬 Copy-Paste Commands

### Get Current Rule Config:
```bash
aws iot get-topic-rule --rule-name PulseSensorDataRule --region us-east-2
```

### Check Latest DynamoDB Item:
```bash
aws dynamodb scan --table-name SensorData --limit 1 --region us-east-2 | jq '.Items[0]'
```

### Watch MQTT Messages:
```bash
# In AWS Console: IoT Core → MQTT test client → Subscribe to: pulse/sensors/#
```

### Check CloudWatch Logs:
```bash
aws logs tail /aws/iot/rules/PulseSensorDataRule --follow --region us-east-2
```

---

## 🎉 Success Criteria

You'll know it's fixed when:

1. ✅ IoT Rule SQL includes `spotify.current_song AS currentSong`
2. ✅ New DynamoDB items have `currentSong`, `artist`, `albumArt` fields
3. ✅ Dashboard "Now Playing" widget shows song name
4. ✅ Browser console shows `currentSong` in fetched data

---

**Ready to fix?** Use **Option 1 (AWS Console)** above for the quickest solution!

**Time to fix**: 2 minutes  
**Risk level**: Low (only affects new data, old data unchanged)  
**Rollback**: Just revert SQL to `SELECT * FROM 'pulse/sensors/#'`
