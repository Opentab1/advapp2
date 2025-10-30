# Quick Start - AWS IoT MQTT Integration

## 🚀 Get Started in 3 Steps

### 1. Start the Dashboard

```bash
npm install
npm run dev
```

The dashboard will open at `http://localhost:5173` and automatically:
- ✅ Connect to AWS IoT Core
- ✅ Subscribe to `pulse/fergs-stpete/main-floor`
- ✅ Display real-time data as it arrives

### 2. Test the Connection

Open the test publisher in another browser tab:

```bash
# In /workspace directory
python3 -m http.server 8000

# Then open: http://localhost:8000/test-mqtt-publisher.html
```

Click **"Connect to AWS IoT"** → Then **"Send Realistic Venue Data"**

### 3. Watch Real-Time Updates

Switch back to the dashboard tab. You should see:
- 🟢 **Connection Status**: "AWS IoT Live"
- 📊 **Metrics updating** in real-time
- 🎵 **Now Playing** widget (if Spotify data included)
- 👥 **Occupancy metrics** (if occupancy data included)

---

## 📡 Connection Details

| Parameter | Value |
|-----------|-------|
| **Endpoint** | `wss://a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com/mqtt` |
| **Topic** | `pulse/fergs-stpete/main-floor` |
| **Protocol** | MQTT 5.0 over WebSocket |
| **Auth** | None (unauthenticated) |
| **Port** | 443 (HTTPS/WSS) |

---

## 📨 Send Test Message

### Option A: Web Test Client

1. Open `test-mqtt-publisher.html`
2. Click "Connect to AWS IoT"
3. Click any test button:
   - 📊 Send Test Sensor Data
   - 🎵 Send with Spotify Data
   - 🏢 Send Realistic Venue Data

### Option B: AWS IoT Console

1. Go to [AWS IoT Console](https://console.aws.amazon.com/iot)
2. Navigate: **Test** → **MQTT test client**
3. **Publish to topic**: `pulse/fergs-stpete/main-floor`
4. **Message**:

```json
{
  "timestamp": "2025-10-30T12:00:00Z",
  "sensors": {
    "sound_level": 75,
    "light_level": 350,
    "indoor_temperature": 72,
    "outdoor_temperature": 68,
    "humidity": 45
  }
}
```

5. Click **Publish**

### Option C: curl (requires auth)

```bash
# This requires AWS credentials configured
aws iot-data publish \
  --topic "pulse/fergs-stpete/main-floor" \
  --payload '{"timestamp":"2025-10-30T12:00:00Z","sensors":{"sound_level":75,"light_level":350,"indoor_temperature":72,"outdoor_temperature":68,"humidity":45}}' \
  --region us-east-2
```

---

## 🎯 What to Expect

### Dashboard Display

When messages arrive, you'll see:

#### Sensor Metrics
- 🔊 **Sound Level**: Displays in decibels (dB)
- ☀️ **Light Level**: Displays in lux
- 🌡️ **Indoor Temperature**: Displays in °F
- ☁️ **Outdoor Temperature**: Displays in °F
- 💧 **Humidity**: Displays as percentage

#### Comfort Score
- **0-100 scale** based on optimal ranges
- Color coded: 🟢 Excellent, 🟡 Good, 🟠 Fair, 🔴 Poor
- Breakdown by category (temp, humidity, sound, light)

#### Optional Features
- 🎵 **Now Playing**: Shows current song if Spotify data present
- 👥 **Occupancy**: Shows people count if occupancy data present
- 📈 **Charts**: Historical data visualization

### Connection Indicators

| Indicator | Meaning |
|-----------|---------|
| 🟢 **AWS IoT Live** | Connected via MQTT, receiving real-time data |
| 🟡 **Polling Mode** | MQTT unavailable, using HTTP polling fallback |
| 🔴 **Disconnected** | No connection to data source |

---

## 🔧 Troubleshooting

### "Disconnected" Status

**Problem**: Dashboard shows red disconnected status

**Solutions**:
1. Check browser console (F12) for error messages
2. Verify internet connection
3. Try disabling browser extensions
4. Check if WebSocket port 443 is accessible
5. Ensure AWS IoT endpoint is correct

### No Data Appearing

**Problem**: Connected but no metrics showing

**Solutions**:
1. Verify you're publishing to the correct topic
2. Check message format matches expected schema
3. Look for JSON parsing errors in console
4. Test with the included test publisher
5. Subscribe to topic in AWS IoT Console to verify messages

### Test Publisher Won't Connect

**Problem**: Test client shows connection error

**Solutions**:
1. Check AWS IoT Core endpoint is accessible
2. Verify WebSocket support in browser
3. Check for firewall/proxy blocking port 443
4. Try from a different network
5. Review AWS IoT Core policies and authorizers

### Build Errors

**Problem**: npm run dev or npm run build fails

**Solutions**:
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Verify MQTT library
npm list mqtt

# Type check
npm run type-check

# Rebuild
npm run build
```

---

## 📖 Message Format Reference

### Minimum Required

```json
{
  "timestamp": "2025-10-30T12:00:00Z",
  "sensors": {
    "sound_level": 75,
    "light_level": 350,
    "indoor_temperature": 72,
    "outdoor_temperature": 68,
    "humidity": 45
  }
}
```

### With Spotify

```json
{
  "timestamp": "2025-10-30T12:00:00Z",
  "sensors": { ... },
  "spotify": {
    "current_song": "Song Name",
    "artist": "Artist Name",
    "album_art": "https://..."
  }
}
```

### With Occupancy

```json
{
  "timestamp": "2025-10-30T12:00:00Z",
  "sensors": { ... },
  "occupancy": {
    "current": 65,
    "entries": 150,
    "exits": 85,
    "capacity": 150
  }
}
```

### Complete Example

```json
{
  "timestamp": "2025-10-30T15:30:00Z",
  "deviceId": "fergs-main-floor-001",
  "sensors": {
    "sound_level": 82.3,
    "light_level": 420,
    "indoor_temperature": 73,
    "outdoor_temperature": 70,
    "humidity": 48
  },
  "spotify": {
    "current_song": "Welcome to the Jungle",
    "artist": "Guns N' Roses",
    "album_art": "https://i.scdn.co/image/ab67616d0000b273ae7f8a57d8cbc28e9b6cef99"
  },
  "occupancy": {
    "current": 65,
    "entries": 150,
    "exits": 85,
    "capacity": 150
  }
}
```

---

## 🎓 Learn More

- **[Complete Integration Guide](./MQTT_INTEGRATION_GUIDE.md)** - Detailed documentation
- **[Implementation Summary](./MQTT_IMPLEMENTATION_SUMMARY.md)** - Technical overview
- **[Main README](./README.md)** - Full project documentation

---

## ✅ Verification Checklist

Use this to verify your setup is working:

- [ ] Dashboard loads at `http://localhost:5173`
- [ ] No login required
- [ ] Connection status shows in top right
- [ ] Test publisher connects successfully
- [ ] Published messages appear on dashboard within 1 second
- [ ] All sensor metrics display correctly
- [ ] Comfort score calculates properly
- [ ] Optional features (Spotify/Occupancy) work if included
- [ ] Connection survives page refresh
- [ ] Auto-reconnection works after network interruption

---

**Need Help?** Check the browser console (F12) for detailed logs and error messages.
