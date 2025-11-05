# 🔌 RASPBERRY PI CONNECTION GUIDE
## Connect Your IoT Sensors to the Dashboard

This guide shows you **EXACTLY** how to connect a Raspberry Pi with sensors to your Pulse Dashboard. Your data will flow: **Raspberry Pi → DynamoDB → Dashboard**

---

## 🎯 WHAT YOU'RE BUILDING

```
┌─────────────────┐      ┌──────────────┐      ┌─────────────┐
│  Raspberry Pi   │ ───> │  DynamoDB    │ ───> │  Dashboard  │
│  with Sensors   │      │  SensorData  │      │  (Browser)  │
└─────────────────┘      └──────────────┘      └─────────────┘
     Every 5s              Stored data           Live updates
```

**Data Flow:**
1. Raspberry Pi reads sensors (sound, light, temp, humidity)
2. Python script publishes to DynamoDB every 5 seconds
3. Dashboard queries DynamoDB and displays data
4. User sees live updates on their screen

---

## 📋 WHAT YOU NEED

### Hardware:
- [ ] Raspberry Pi (any model with GPIO pins)
- [ ] Sound sensor (e.g., MAX4466 or MAX9814)
- [ ] Light sensor (e.g., BH1750 or TSL2561)
- [ ] Temperature sensor (e.g., DHT22 or BME280)
- [ ] Humidity sensor (usually built into temp sensor)
- [ ] (Optional) PIR motion sensor for occupancy
- [ ] Power supply for Raspberry Pi
- [ ] Internet connection (WiFi or Ethernet)

### Software:
- [ ] Raspberry Pi OS (formerly Raspbian)
- [ ] Python 3.7+
- [ ] AWS account with credentials
- [ ] Venue ID from Cognito setup

---

## 🚀 STEP 1: Prepare Raspberry Pi

### 1.1 Update System

```bash
sudo apt-get update
sudo apt-get upgrade -y
```

### 1.2 Install Python Dependencies

```bash
# Install pip if not already installed
sudo apt-get install python3-pip -y

# Install required Python libraries
pip3 install boto3 RPi.GPIO adafruit-circuitpython-dht smbus2

# For sound sensor (if using analog)
pip3 install spidev

# For AWS IoT (optional - for MQTT)
pip3 install AWSIoTPythonSDK
```

### 1.3 Enable I2C and SPI (for sensors)

```bash
sudo raspi-config
# Navigate to: Interface Options → I2C → Enable
# Navigate to: Interface Options → SPI → Enable
# Reboot when prompted
```

---

## 🔌 STEP 2: Wire Up Sensors

### Sound Sensor (MAX4466 - Analog)
```
MAX4466 VCC → Raspberry Pi 3.3V (Pin 1)
MAX4466 GND → Raspberry Pi GND (Pin 6)
MAX4466 OUT → Raspberry Pi GPIO (Pin 18) via ADC
```
*Note: Raspberry Pi doesn't have analog pins, so you'll need an ADC like MCP3008*

### Light Sensor (BH1750 - I2C)
```
BH1750 VCC → Raspberry Pi 3.3V (Pin 1)
BH1750 GND → Raspberry Pi GND (Pin 6)
BH1750 SDA → Raspberry Pi SDA (Pin 3)
BH1750 SCL → Raspberry Pi SCL (Pin 5)
```

### Temperature/Humidity Sensor (DHT22)
```
DHT22 VCC → Raspberry Pi 3.3V (Pin 1)
DHT22 GND → Raspberry Pi GND (Pin 6)
DHT22 DATA → Raspberry Pi GPIO 4 (Pin 7)
```

### Wiring Diagram:
```
Raspberry Pi GPIO Layout:
     3.3V  [ 1] [ 2]  5V
      SDA  [ 3] [ 4]  5V
      SCL  [ 5] [ 6]  GND
    GPIO4  [ 7] [ 8]  GPIO14
      GND  [ 9] [10]  GPIO15
   GPIO17  [11] [12]  GPIO18
   GPIO27  [13] [14]  GND
   GPIO22  [15] [16]  GPIO23
     3.3V  [17] [18]  GPIO24
    GPIO10 [19] [20]  GND
```

---

## 🔑 STEP 3: Configure AWS Credentials

### 3.1 Get AWS Access Keys

1. Go to AWS Console → IAM
2. Create new user or use existing
3. Attach policy: `AmazonDynamoDBFullAccess`
4. Create access keys
5. Download credentials

### 3.2 Configure on Raspberry Pi

```bash
# Install AWS CLI
pip3 install awscli

# Configure credentials
aws configure
```

**Enter:**
- AWS Access Key ID: `YOUR_ACCESS_KEY`
- AWS Secret Access Key: `YOUR_SECRET_KEY`
- Default region: `us-east-2`
- Default output format: `json`

### 3.3 Test AWS Connection

```bash
# Test DynamoDB access
aws dynamodb list-tables --region us-east-2
```

Should show: `SensorData`, `VenueConfig`, `OccupancyMetrics`

---

## 📝 STEP 4: Create Sensor Reading Script

Save this as `/home/pi/sensor_publisher.py`:

```python
#!/usr/bin/env python3
"""
Pulse Dashboard - Raspberry Pi Sensor Publisher
Reads sensors and publishes to AWS DynamoDB
"""

import time
import json
import sys
from datetime import datetime
import boto3
from botocore.exceptions import ClientError

# ============================================================================
# CONFIGURATION - UPDATE THESE VALUES FOR YOUR VENUE
# ============================================================================
VENUE_ID = "FergData"  # CHANGE THIS to your venue's ID
DEVICE_ID = "rpi-001"  # Unique identifier for this Raspberry Pi
AWS_REGION = "us-east-2"
PUBLISH_INTERVAL = 5  # Seconds between readings

# ============================================================================
# AWS DynamoDB Setup
# ============================================================================
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
sensor_table = dynamodb.Table('SensorData')

# ============================================================================
# SENSOR IMPORT - Uncomment the ones you're using
# ============================================================================
try:
    # For DHT22 temperature/humidity sensor
    import adafruit_dht
    import board
    DHT_SENSOR = adafruit_dht.DHT22(board.D4)
except ImportError:
    print("⚠️ DHT22 library not available, using mock data")
    DHT_SENSOR = None

try:
    # For BH1750 light sensor
    import smbus2
    BH1750_ADDR = 0x23
    bus = smbus2.SMBus(1)
except ImportError:
    print("⚠️ I2C library not available, using mock data")
    bus = None

# ============================================================================
# SENSOR READING FUNCTIONS
# ============================================================================

def read_sound_level():
    """
    Read sound level in decibels
    TODO: Replace with actual sound sensor code
    For now, returns simulated data
    """
    # If you have a sound sensor connected, read it here
    # Example: return read_adc_channel(0) * conversion_factor
    
    # Simulated data for testing:
    import random
    return round(random.uniform(60, 85), 1)

def read_light_level():
    """
    Read light level in lux using BH1750 sensor
    """
    if bus is None:
        # Simulated data
        import random
        return round(random.uniform(200, 600), 1)
    
    try:
        # BH1750 I2C reading
        data = bus.read_i2c_block_data(BH1750_ADDR, 0x20, 2)
        light_level = (data[1] + (256 * data[0])) / 1.2
        return round(light_level, 1)
    except Exception as e:
        print(f"❌ Error reading light sensor: {e}")
        return 300.0

def read_temperature_humidity():
    """
    Read temperature and humidity using DHT22 sensor
    Returns: (temperature_F, humidity_percent)
    """
    if DHT_SENSOR is None:
        # Simulated data
        import random
        temp_f = round(random.uniform(68, 76), 1)
        humidity = round(random.uniform(40, 70), 1)
        return temp_f, humidity
    
    try:
        # Read DHT22 sensor
        temp_c = DHT_SENSOR.temperature
        humidity = DHT_SENSOR.humidity
        
        # Convert to Fahrenheit
        temp_f = (temp_c * 9/5) + 32
        
        return round(temp_f, 1), round(humidity, 1)
    except RuntimeError as e:
        # DHT sensors can be finicky, retry on error
        print(f"⚠️ DHT22 read error: {e}")
        time.sleep(2)
        return read_temperature_humidity()
    except Exception as e:
        print(f"❌ Error reading DHT22: {e}")
        return 72.0, 50.0

def get_outdoor_temperature():
    """
    Get outdoor temperature from weather API
    TODO: Implement weather API call (OpenWeatherMap, etc.)
    """
    # For now, return simulated data
    import random
    return round(random.uniform(65, 80), 1)

def get_current_song():
    """
    Get currently playing song from Spotify API
    TODO: Implement Spotify API integration
    """
    # For now, return None (no song playing)
    return None, None, None

# ============================================================================
# PUBLISHING FUNCTION
# ============================================================================

def publish_sensor_data():
    """
    Read all sensors and publish to DynamoDB
    """
    try:
        # Read all sensors
        sound = read_sound_level()
        light = read_light_level()
        indoor_temp, humidity = read_temperature_humidity()
        outdoor_temp = get_outdoor_temperature()
        song, artist, album_art = get_current_song()
        
        # Create timestamp in ISO 8601 format
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Create DynamoDB item
        item = {
            'venueId': VENUE_ID,
            'timestamp': timestamp,
            'decibels': sound,
            'light': light,
            'indoorTemp': indoor_temp,
            'outdoorTemp': outdoor_temp,
            'humidity': humidity,
        }
        
        # Add optional fields if available
        if song:
            item['currentSong'] = song
            item['artist'] = artist or 'Unknown Artist'
            if album_art:
                item['albumArt'] = album_art
        
        # Publish to DynamoDB
        sensor_table.put_item(Item=item)
        
        # Print success message
        print(f"✅ [{timestamp}] Published: 🔊{sound}dB | 💡{light}lux | "
              f"🌡️{indoor_temp}°F | 💧{humidity}%")
        
        return True
        
    except ClientError as e:
        print(f"❌ DynamoDB Error: {e.response['Error']['Message']}")
        return False
    except Exception as e:
        print(f"❌ Unexpected Error: {e}")
        return False

# ============================================================================
# MAIN LOOP
# ============================================================================

def main():
    """
    Main loop - read sensors and publish to DynamoDB
    """
    print("=" * 70)
    print("🚀 PULSE DASHBOARD - SENSOR PUBLISHER")
    print("=" * 70)
    print(f"📍 Venue ID: {VENUE_ID}")
    print(f"🤖 Device ID: {DEVICE_ID}")
    print(f"📡 Publishing to DynamoDB: SensorData")
    print(f"⏱️  Interval: {PUBLISH_INTERVAL} seconds")
    print(f"🌍 Region: {AWS_REGION}")
    print("=" * 70)
    print()
    
    # Test AWS connection
    try:
        sensor_table.load()
        print("✅ Connected to DynamoDB table: SensorData")
    except Exception as e:
        print(f"❌ Failed to connect to DynamoDB: {e}")
        print("   Check your AWS credentials and table name")
        sys.exit(1)
    
    print()
    print("📊 Starting sensor readings...")
    print()
    
    # Main loop
    failure_count = 0
    max_failures = 10
    
    try:
        while True:
            success = publish_sensor_data()
            
            if success:
                failure_count = 0
            else:
                failure_count += 1
                if failure_count >= max_failures:
                    print(f"❌ Too many failures ({max_failures}), exiting...")
                    sys.exit(1)
            
            # Wait before next reading
            time.sleep(PUBLISH_INTERVAL)
            
    except KeyboardInterrupt:
        print()
        print("=" * 70)
        print("👋 Shutting down sensor publisher...")
        print("=" * 70)
        sys.exit(0)
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        sys.exit(1)

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    main()
```

---

## ▶️ STEP 5: Run the Script

### 5.1 Make Script Executable

```bash
chmod +x /home/pi/sensor_publisher.py
```

### 5.2 Test Run

```bash
cd /home/pi
python3 sensor_publisher.py
```

**Expected Output:**
```
======================================================================
🚀 PULSE DASHBOARD - SENSOR PUBLISHER
======================================================================
📍 Venue ID: FergData
🤖 Device ID: rpi-001
📡 Publishing to DynamoDB: SensorData
⏱️  Interval: 5 seconds
🌍 Region: us-east-2
======================================================================

✅ Connected to DynamoDB table: SensorData

📊 Starting sensor readings...

✅ [2025-11-04T15:30:05.123Z] Published: 🔊72.3dB | 💡354.2lux | 🌡️71.5°F | 💧52.3%
✅ [2025-11-04T15:30:10.456Z] Published: 🔊74.1dB | 💡362.7lux | 🌡️71.8°F | 💧52.1%
✅ [2025-11-04T15:30:15.789Z] Published: 🔊68.5dB | 💡348.9lux | 🌡️71.6°F | 💧52.5%
```

### 5.3 Stop Script

Press `Ctrl+C` to stop

---

## 🔄 STEP 6: Auto-Start on Boot

Make the script run automatically when Raspberry Pi starts.

### 6.1 Create Systemd Service

```bash
sudo nano /etc/systemd/system/pulse-sensor.service
```

**Add this content:**
```ini
[Unit]
Description=Pulse Dashboard Sensor Publisher
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi
ExecStart=/usr/bin/python3 /home/pi/sensor_publisher.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 6.2 Enable and Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable pulse-sensor.service

# Start service now
sudo systemctl start pulse-sensor.service

# Check status
sudo systemctl status pulse-sensor.service
```

**Expected Output:**
```
● pulse-sensor.service - Pulse Dashboard Sensor Publisher
   Loaded: loaded (/etc/systemd/system/pulse-sensor.service; enabled)
   Active: active (running) since Mon 2025-11-04 15:30:00 UTC; 10s ago
 Main PID: 1234 (python3)
   CGroup: /system.slice/pulse-sensor.service
           └─1234 /usr/bin/python3 /home/pi/sensor_publisher.py
```

### 6.3 Useful Service Commands

```bash
# Stop service
sudo systemctl stop pulse-sensor.service

# Restart service
sudo systemctl restart pulse-sensor.service

# View logs
sudo journalctl -u pulse-sensor.service -f

# Disable auto-start
sudo systemctl disable pulse-sensor.service
```

---

## 📊 STEP 7: Verify Data in Dashboard

### 7.1 Check DynamoDB Has Data

```bash
# Query recent data for your venue
aws dynamodb query \
  --table-name SensorData \
  --key-condition-expression "venueId = :v" \
  --expression-attribute-values '{":v":{"S":"FergData"}}' \
  --scan-index-forward false \
  --limit 5
```

Should return 5 most recent sensor readings.

### 7.2 Login to Dashboard

1. Open: https://your-app-url.com
2. Login with your venue credentials
3. You should see:
   - ✅ Live sensor data updating
   - ✅ Sound, light, temperature, humidity metrics
   - ✅ Comfort level gauge
   - ✅ Historical charts

### 7.3 Check Browser Console

Open browser console (F12) and look for:
```
✅ Fetching live data from DynamoDB for venue: FergData
✅ Live data received from DynamoDB
```

---

## 🔧 ADVANCED: Real Sensor Integration

### Sound Sensor (MAX9814 with MCP3008 ADC)

```python
import spidev

# Initialize SPI
spi = spidev.SpiDev()
spi.open(0, 0)
spi.max_speed_hz = 1350000

def read_adc(channel):
    """Read from MCP3008 ADC"""
    adc = spi.xfer2([1, (8 + channel) << 4, 0])
    data = ((adc[1] & 3) << 8) + adc[2]
    return data

def read_sound_level():
    """Read sound sensor and convert to decibels"""
    # Read from ADC channel 0
    raw_value = read_adc(0)
    
    # Convert to voltage (0-3.3V)
    voltage = (raw_value / 1023.0) * 3.3
    
    # Convert to decibels (calibrate this formula for your sensor)
    # This is a simplified conversion - adjust based on your sensor's datasheet
    decibels = 20 * math.log10(voltage / 0.001) if voltage > 0 else 0
    
    # Clamp to reasonable range
    decibels = max(30, min(120, decibels))
    
    return round(decibels, 1)
```

### Light Sensor (BH1750 - Production Ready)

```python
import smbus2
import time

BH1750_ADDR = 0x23
CONTINUOUS_HIGH_RES_MODE = 0x10

def read_light_level():
    """Read light level from BH1750 sensor"""
    try:
        # Send measurement command
        bus.write_byte(BH1750_ADDR, CONTINUOUS_HIGH_RES_MODE)
        time.sleep(0.2)  # Wait for measurement
        
        # Read 2 bytes of data
        data = bus.read_i2c_block_data(BH1750_ADDR, CONTINUOUS_HIGH_RES_MODE, 2)
        
        # Convert to lux
        light_level = (data[1] + (256 * data[0])) / 1.2
        
        return round(light_level, 1)
    except Exception as e:
        print(f"Error reading BH1750: {e}")
        return 300.0  # Return default value on error
```

### Temperature/Humidity (DHT22 - Production Ready)

```python
import adafruit_dht
import board

# Initialize DHT22 sensor on GPIO 4
dht_sensor = adafruit_dht.DHT22(board.D4)

def read_temperature_humidity():
    """Read DHT22 sensor with error handling"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            temperature_c = dht_sensor.temperature
            humidity = dht_sensor.humidity
            
            if temperature_c is not None and humidity is not None:
                # Convert to Fahrenheit
                temperature_f = (temperature_c * 9/5) + 32
                return round(temperature_f, 1), round(humidity, 1)
            
        except RuntimeError as e:
            # DHT sensors occasionally fail to read
            print(f"DHT22 read attempt {attempt + 1} failed: {e}")
            time.sleep(2)
            continue
    
    # Return default values if all retries fail
    return 72.0, 50.0
```

---

## 🎵 BONUS: Spotify Integration

Add current playing song to your dashboard:

```python
import spotipy
from spotipy.oauth2 import SpotifyOAuth

# Spotify API credentials
SPOTIPY_CLIENT_ID = 'your_client_id'
SPOTIPY_CLIENT_SECRET = 'your_client_secret'
SPOTIPY_REDIRECT_URI = 'http://localhost:8888/callback'

sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
    client_id=SPOTIPY_CLIENT_ID,
    client_secret=SPOTIPY_CLIENT_SECRET,
    redirect_uri=SPOTIPY_REDIRECT_URI,
    scope="user-read-currently-playing"
))

def get_current_song():
    """Get currently playing song from Spotify"""
    try:
        current = sp.current_user_playing_track()
        
        if current and current['is_playing']:
            song = current['item']['name']
            artist = current['item']['artists'][0]['name']
            album_art = current['item']['album']['images'][0]['url']
            return song, artist, album_art
        
        return None, None, None
    except Exception as e:
        print(f"Spotify API error: {e}")
        return None, None, None
```

---

## 🐛 TROUBLESHOOTING

### Script Won't Start
```bash
# Check Python errors
python3 /home/pi/sensor_publisher.py

# Check systemd logs
sudo journalctl -u pulse-sensor.service -n 50
```

### No Data in DynamoDB
```bash
# Test AWS credentials
aws dynamodb list-tables --region us-east-2

# Test manual write
aws dynamodb put-item --table-name SensorData --item '{"venueId":{"S":"FergData"},"timestamp":{"S":"2025-11-04T00:00:00.000Z"},"decibels":{"N":"70"}}'
```

### Sensors Not Reading
```bash
# Check I2C devices
sudo i2cdetect -y 1

# Check GPIO pins
gpio readall
```

### High CPU Usage
- Increase `PUBLISH_INTERVAL` to 10 or 15 seconds
- Add delays in sensor reading functions
- Optimize sensor libraries

---

## 📈 MONITORING & MAINTENANCE

### View Live Logs
```bash
# Follow service logs
sudo journalctl -u pulse-sensor.service -f
```

### Check System Health
```bash
# CPU temperature (should be < 80°C)
vcgencmd measure_temp

# Memory usage
free -h

# Disk space
df -h
```

### Update Script
```bash
# Edit script
nano /home/pi/sensor_publisher.py

# Restart service to apply changes
sudo systemctl restart pulse-sensor.service
```

---

## ✅ FINAL CHECKLIST

- [ ] Raspberry Pi powered on and connected to internet
- [ ] All sensors wired correctly
- [ ] AWS credentials configured
- [ ] Venue ID set in script
- [ ] Script runs without errors
- [ ] Service starts on boot
- [ ] Data appears in DynamoDB
- [ ] Dashboard shows live data
- [ ] No errors in browser console

---

## 🎉 YOU'RE LIVE!

Your Raspberry Pi is now publishing sensor data every 5 seconds to DynamoDB, and your dashboard is displaying it in real-time!

**Next Steps:**
- Calibrate sensors for accuracy
- Add more sensors (occupancy, air quality, etc.)
- Integrate Spotify for music tracking
- Set up alerts for abnormal readings
- Create automated reports

**Need help?** Check the other guides:
- `COMPLETE_SETUP_GUIDE.md` - Main setup
- `VENUE_SETUP_COMPLETE_GUIDE.md` - Adding venues
- `DYNAMODB_SETUP.md` - Database configuration
