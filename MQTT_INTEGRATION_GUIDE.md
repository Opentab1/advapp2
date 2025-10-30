# AWS IoT Core MQTT Integration Guide

## Overview

The Pulse Dashboard now integrates **real-time AWS IoT data** via **direct MQTT over WebSocket**. No authentication, no AppSync, no DynamoDB—just pure, real-time sensor data streaming to your dashboard.

---

## Configuration

### AWS IoT Endpoint
- **WebSocket URL**: `wss://a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com/mqtt`
- **Region**: `us-east-2`
- **Protocol**: MQTT over WebSocket (WSS)

### MQTT Topic
- **Topic Pattern**: `pulse/{venueId}/{locationId}`
- **Current Topic**: `pulse/fergs-stpete/main-floor`

These values are configured in `/src/config/amplify.ts`:

```typescript
export const VENUE_CONFIG = {
  venueId: 'fergs-stpete',
  locationId: 'main-floor',
  venueName: "Ferg's Sports Bar",
  locationName: 'Main Floor',
  region: 'us-east-2',
  iotEndpoint: 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com'
};
```

---

## How It Works

### 1. Connection Flow

When the dashboard loads:
1. The `useRealTimeData` hook initializes
2. `iotService.connect()` is called
3. MQTT client connects to AWS IoT Core via WebSocket
4. Subscribes to `pulse/fergs-stpete/main-floor` topic
5. Dashboard displays connection status with green "AWS IoT Live" indicator

### 2. Data Reception

When IoT devices publish sensor data:
1. Message arrives on MQTT topic
2. `iotService` receives and parses the message
3. Data is transformed to `SensorData` format
4. All registered handlers are notified
5. Dashboard UI updates in real-time

### 3. Automatic Reconnection

The MQTT client handles reconnection automatically:
- **Max Attempts**: 10
- **Reconnect Period**: 5 seconds
- **Connection Timeout**: 30 seconds
- **Keepalive**: 60 seconds

---

## Message Format

### Required Fields

```json
{
  "timestamp": "2025-10-30T12:00:00Z",
  "sensors": {
    "sound_level": 75.5,
    "light_level": 350,
    "indoor_temperature": 72,
    "outdoor_temperature": 68,
    "humidity": 45
  }
}
```

### Optional Fields

#### Spotify Integration
```json
{
  "spotify": {
    "current_song": "Thunder Struck",
    "artist": "AC/DC",
    "album_art": "https://i.scdn.co/image/..."
  }
}
```

#### Occupancy Tracking
```json
{
  "occupancy": {
    "current": 65,
    "entries": 150,
    "exits": 85,
    "capacity": 150
  }
}
```

#### Device Information
```json
{
  "deviceId": "fergs-main-floor-001"
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

## Testing the Integration

### Option 1: Web-Based Test Publisher

Open `test-mqtt-publisher.html` in your browser:

```bash
# Serve the test file
python3 -m http.server 8000
# Then open: http://localhost:8000/test-mqtt-publisher.html
```

Features:
- ✅ Connect/disconnect from AWS IoT
- 📊 Send test sensor data
- 🎵 Send data with Spotify info
- 🏢 Send realistic venue data
- 📝 Custom JSON message support
- 📋 Real-time connection logs

### Option 2: AWS IoT Console

1. Go to [AWS IoT Console](https://console.aws.amazon.com/iot)
2. Navigate to **Test** → **MQTT test client**
3. Publish to topic: `pulse/fergs-stpete/main-floor`
4. Use the message format above

### Option 3: Command Line (mosquitto_pub)

```bash
mosquitto_pub -h a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com \
  -p 8883 \
  -t "pulse/fergs-stpete/main-floor" \
  -m '{"timestamp":"2025-10-30T12:00:00Z","sensors":{"sound_level":75,"light_level":350,"indoor_temperature":72,"outdoor_temperature":68,"humidity":45}}' \
  --cert path/to/cert.pem \
  --key path/to/private.key \
  --cafile path/to/AmazonRootCA1.pem
```

### Option 4: AWS IoT Device SDK

Python example:
```python
from awscrt import mqtt
from awsiot import mqtt_connection_builder
import json
import time

# Configure connection
mqtt_connection = mqtt_connection_builder.mtls_from_path(
    endpoint="a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com",
    cert_filepath="path/to/cert.pem",
    pri_key_filepath="path/to/private.key",
    ca_filepath="path/to/AmazonRootCA1.pem",
    client_id="pulse-sensor-001"
)

# Connect
mqtt_connection.connect().result()

# Publish sensor data
topic = "pulse/fergs-stpete/main-floor"
message = {
    "timestamp": "2025-10-30T12:00:00Z",
    "deviceId": "sensor-001",
    "sensors": {
        "sound_level": 75.5,
        "light_level": 350,
        "indoor_temperature": 72,
        "outdoor_temperature": 68,
        "humidity": 45
    }
}

mqtt_connection.publish(
    topic=topic,
    payload=json.dumps(message),
    qos=mqtt.QoS.AT_LEAST_ONCE
)
```

---

## Authentication Configuration

### Current Setup: Unauthenticated Access

The dashboard connects without credentials. This requires AWS IoT Core to be configured with:

1. **Custom Authorizer** (recommended for production)
2. **Public access policy** (for testing only)

### AWS IoT Policy Example

If using certificate-based auth for IoT devices, apply this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iot:Connect",
        "iot:Publish",
        "iot:Subscribe",
        "iot:Receive"
      ],
      "Resource": [
        "arn:aws:iot:us-east-2:*:topic/pulse/*",
        "arn:aws:iot:us-east-2:*:topicfilter/pulse/*",
        "arn:aws:iot:us-east-2:*:client/*"
      ]
    }
  ]
}
```

### Production Recommendations

For production deployments:

1. **Use AWS IoT Custom Authorizer**
   - Implement token-based authentication
   - Validate requests via Lambda function
   - Control access per client

2. **Enable TLS**
   - Already enabled via WSS protocol
   - Ensures encrypted communication

3. **Rate Limiting**
   - Configure throttling in AWS IoT
   - Protect against DDoS

4. **Monitoring**
   - Enable CloudWatch metrics
   - Set up alarms for connection failures
   - Track message throughput

---

## Dashboard Features

### Connection Status Indicator

The dashboard shows connection status in real-time:

- 🟢 **AWS IoT Live** - Connected to MQTT, receiving real-time data
- 🟡 **Polling Mode** - MQTT unavailable, using HTTP fallback
- 🔴 **Disconnected** - No connection

### Real-Time Metrics

When connected via MQTT, these metrics update instantly:

- 🔊 **Sound Level** (decibels)
- ☀️ **Light Level** (lux)
- 🌡️ **Indoor Temperature** (°F)
- ☁️ **Outdoor Temperature** (°F)
- 💧 **Humidity** (%)
- 👥 **Occupancy** (current, entries, exits)
- 🎵 **Now Playing** (Spotify integration)

### Comfort Score

Real-time comfort analysis based on:
- Temperature range (68-76°F optimal)
- Humidity range (30-60% optimal)
- Sound level (60-80 dB optimal)
- Light level (300-500 lux optimal)

---

## Troubleshooting

### Connection Issues

**Symptom**: Dashboard shows "Disconnected"

**Solutions**:
1. Check browser console for MQTT errors
2. Verify IoT endpoint is reachable
3. Check AWS IoT Core policies
4. Ensure WebSocket port (443) is not blocked
5. Try disabling browser extensions
6. Check browser supports WebSocket

### No Data Received

**Symptom**: Connected but no sensor data

**Solutions**:
1. Verify IoT devices are publishing to correct topic
2. Check message format matches expected schema
3. Use AWS IoT Console to monitor topic activity
4. Check CloudWatch logs for device errors
5. Test with the included `test-mqtt-publisher.html`

### Message Format Errors

**Symptom**: Data appears but values are wrong

**Solutions**:
1. Ensure `timestamp` is valid ISO 8601 format
2. Verify sensor field names match exactly
3. Check numeric values are not strings
4. Validate JSON structure
5. Review browser console for parsing errors

### Performance Issues

**Symptom**: Dashboard is slow or laggy

**Solutions**:
1. Check message publishing frequency (recommended: 1-5 seconds)
2. Reduce chart data retention
3. Optimize message payload size
4. Monitor browser memory usage
5. Check for multiple tabs open

---

## File Structure

```
/workspace/
├── src/
│   ├── services/
│   │   └── iot.service.ts        # MQTT connection & message handling
│   ├── hooks/
│   │   └── useRealTimeData.ts    # React hook for real-time data
│   ├── config/
│   │   └── amplify.ts            # IoT endpoint & topic config
│   ├── components/
│   │   └── ConnectionStatus.tsx  # Connection status indicator
│   └── pages/
│       └── Dashboard.tsx         # Main dashboard with real-time metrics
├── test-mqtt-publisher.html      # Web-based MQTT test tool
└── MQTT_INTEGRATION_GUIDE.md     # This file
```

---

## API Reference

### IoTService

Main service for MQTT communication.

#### Methods

```typescript
// Connect to AWS IoT Core
iotService.connect(venueId: string): Promise<void>

// Subscribe to incoming messages
iotService.onMessage(handler: (data: SensorData) => void): () => void

// Disconnect from AWS IoT Core
iotService.disconnect(): void

// Check connection status
iotService.isConnected(): boolean

// Publish a message (for testing/commands)
iotService.publish(topic: string, message: any): void
```

#### Example Usage

```typescript
import iotService from './services/iot.service';

// Connect
await iotService.connect('fergs-stpete');

// Listen for messages
const unsubscribe = iotService.onMessage((data) => {
  console.log('Received sensor data:', data);
});

// Clean up
unsubscribe();
iotService.disconnect();
```

### useRealTimeData Hook

React hook for consuming real-time IoT data.

```typescript
const { 
  data,        // Current sensor data
  loading,     // Loading state
  error,       // Error message
  refetch,     // Manual refresh function
  usingIoT     // True if connected via MQTT
} = useRealTimeData({
  venueId: 'fergs-stpete',
  interval: 15000,  // Polling fallback interval (ms)
  enabled: true     // Enable/disable data fetching
});
```

---

## Next Steps

### For Developers

1. **Customize message format** - Modify `IoTMessage` interface in `iot.service.ts`
2. **Add new metrics** - Extend `SensorData` type and dashboard components
3. **Implement commands** - Use `iotService.publish()` for device control
4. **Add analytics** - Store messages in DynamoDB via Lambda function

### For IoT Devices

1. **Configure device certificates** - Set up AWS IoT Core thing
2. **Implement MQTT client** - Use AWS IoT Device SDK
3. **Publish sensor data** - Send messages every 1-5 seconds
4. **Add error handling** - Implement retry logic and health checks

### For Operations

1. **Set up monitoring** - CloudWatch metrics and alarms
2. **Configure backups** - Archive messages to S3 via IoT Rules
3. **Enable logging** - CloudWatch Logs for debugging
4. **Review security** - Audit policies and implement custom authorizer

---

## Support

For issues or questions:
- Check browser console logs
- Review AWS IoT Core logs in CloudWatch
- Test with `test-mqtt-publisher.html`
- Verify message format matches schema

---

**Last Updated**: 2025-10-30  
**Version**: 1.0.0  
**Maintained by**: Pulse Dashboard Team
