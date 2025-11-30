# 🚀 MASTER VENUE SETUP GUIDE
## Complete Step-by-Step Guide for Adding New Venues to Pulse Dashboard

**📌 BOOKMARK THIS FILE - Everything you need is here!**

---

## 📋 Overview: What This Guide Does

This guide walks you through the complete process of adding a new venue client to your Pulse Dashboard system. After following these steps, the venue owner will be able to:
- ✅ Login to their personalized dashboard
- ✅ See real-time sensor data from their Raspberry Pi
- ✅ View charts, metrics, and AI insights
- ✅ Export data and generate reports

**Time Required:** 15-20 minutes per venue (once you get the hang of it!)

---

## 🎯 Prerequisites (One-Time Setup)

Before adding your first venue, make sure you have:
- [ ] AWS Account with admin access
- [ ] Pulse Admin Dashboard login credentials
- [ ] Raspberry Pi device ready for the venue
- [ ] Venue owner's email address

---

## 📦 What You'll Need for Each New Venue

1. **Venue Information:**
   - Venue name (e.g., "Joe's Bar & Grill")
   - Owner's email address
   - Owner's name
   - Location name (e.g., "Main Floor", "Rooftop")

2. **Equipment:**
   - Raspberry Pi (any model with WiFi)
   - MicroSD card (16GB minimum)
   - Power supply for Pi
   - Sensors (or will use mock data for testing)

---

# 🎬 PART 1: CREATE VENUE IN ADMIN PORTAL

## Step 1: Login to Admin Portal

1. **Open your web browser** (Chrome, Safari, Firefox, Edge)
2. **Go to your Pulse Admin Dashboard URL**
   - Example: `https://main.xxxxx.amplifyapp.com/admin`
3. **Enter your admin credentials:**
   - Email: Your admin email
   - Password: Your admin password
4. **Click "Login"**
5. **You should see the Admin Portal** with sidebar navigation

**✅ Success Check:** You see "Admin Dashboard" at the top

---

## Step 2: Navigate to Venues Management

1. **Look at the left sidebar**
2. **Click on "Venues"** (🏢 icon)
3. **You should see the "Venues Management" page**

**✅ Success Check:** You see a page titled "🏢 Venues Management"

---

## Step 3: Create New Venue

1. **Click the purple "Create New Venue" button** (top right)
2. **A 3-step modal will appear**

---

### 📝 STEP 1 of 3: Venue Information

**Fill in these fields:**

1. **Venue Name** (Required)
   - What to enter: The business name
   - Example: `"Joe's Bar & Grill"`
   - Example: `"Sunset Lounge Tampa"`
   - ⚠️ This is what the owner will see in their dashboard

2. **Venue ID** (Auto-generated - Don't touch!)
   - This auto-fills when you type the venue name
   - Example: If you type "Joe's Bar", it becomes `joesbar`
   - ✅ Leave it as-is (lowercase, no spaces)

3. **Primary Location Name** (Optional)
   - Default: "Main Floor"
   - Change if needed: "Rooftop", "Outdoor Patio", "Bar Area"
   - This is for venues with multiple locations

4. **Address** (Optional but recommended)
   - Example: `"123 Main Street, Tampa, FL 33602"`

5. **Timezone** (Required)
   - Select from dropdown:
     - Eastern Time (ET)
     - Central Time (CT)  
     - Mountain Time (MT)
     - Pacific Time (PT)

**Click "Next" →**

---

### 👤 STEP 2 of 3: Owner Account

**Fill in these fields:**

1. **Owner Email** (Required)
   - What to enter: The venue owner's email address
   - Example: `joe@joesbar.com`
   - Example: `owner@venue.com`
   - ⚠️ **IMPORTANT:** This email must be UNIQUE (not used before)
   - 📧 Owner will use this to login

2. **Owner Name** (Required)
   - What to enter: Owner's full name
   - Example: `"Joe Smith"`
   - Example: `"Sarah Johnson"`

**💡 Note:** A temporary password will be auto-generated and shown to you after creation.

**Click "Next" →**

---

### ⚙️ STEP 3 of 3: Device Configuration

**Review these auto-generated settings:**

1. **Device ID** (Auto-generated)
   - Format: `rpi-{venueId}-001`
   - Example: `rpi-joesbar-001`
   - ✅ This is unique per venue

2. **MQTT Topic** (Auto-generated)
   - Format: `pulse/sensors/{venueId}`
   - Example: `pulse/sensors/joesbar`
   - ✅ This is where the Raspberry Pi will publish data

3. **Enabled Features** (Toggle on/off as needed)
   - ✅ Song Detection (Shazam integration)
   - ✅ Occupancy Tracking (people counting)
   - ✅ AI Insights (recommendations)
   - ✅ Predictive Analytics (forecasting)
   - ⬜ Revenue Correlation (premium feature)

**Click "Create Venue & Send Invite" →**

---

## Step 4: Save the Credentials

**A popup will appear with:**

```
✅ Venue "Joe's Bar & Grill" created successfully!

Owner: joe@joesbar.com
Temporary Password: Temp542abc8xyz!

⚠️ Save this password! The owner will need it to login.
```

**🔴 CRITICAL - DO THIS NOW:**

1. **Copy the email and password**
2. **Save them somewhere safe:**
   - Text file on your computer
   - Password manager
   - Note-taking app
3. **Send to venue owner via:**
   - Email them manually
   - Text message
   - Phone call
   - In-person

**⚠️ You cannot retrieve this password later! Write it down NOW!**

---

## Step 5: Verify Venue Was Created

**Quick verification:**

1. **Go to AWS Console** → Cognito → User Pools
2. **Click on your user pool**
3. **Click "Users" tab**
4. **Search for the owner's email** (e.g., `joe@joesbar.com`)
5. **You should see the user listed**
6. **Click on the user**
7. **Check attributes:**
   - ✅ `custom:venueId` should equal your venue ID (e.g., `joesbar`)
   - ✅ `custom:venueName` should equal venue name
   - ✅ `custom:role` should equal `owner`

**✅ Success Check:** User exists with correct attributes

---

# 🔧 PART 2: DOWNLOAD CERTIFICATES FROM S3

Now we need to get the security certificates for the Raspberry Pi.

---

## Step 6: Navigate to S3

1. **Open AWS Console**
2. **In the search bar**, type `S3`
3. **Click on S3** service
4. **Find and click the bucket:** `pulse-device-certificates`

**✅ Success Check:** You see a list of folders (one per venue)

---

## Step 7: Download Certificates

1. **Click on the folder** with your venue ID
   - Example: Click `joesbar/`
2. **Click on the subfolder** (device ID)
   - Example: Click `joesbar-mainfloor-001/`
3. **You should see 4 files:**
   - `device.cert.pem` (Device certificate)
   - `device.private.key` (Private key - keep secure!)
   - `device.public.key` (Public key)
   - `AmazonRootCA1.pem` (Amazon root certificate)

4. **Download ALL 4 files:**
   - **Method 1 (One by one):**
     - Check the box next to each file
     - Click "Download" button
   - **Method 2 (Select all):**
     - Click "Actions" dropdown
     - Select "Download"
     - Or check all boxes → Download

5. **Save them to a folder on your computer**
   - Create folder: `pulse-certs-joesbar/`
   - Save all 4 files there

**✅ Success Check:** You have 4 `.pem` and `.key` files downloaded

**⚠️ SECURITY WARNING:** These files are like passwords! Keep them secure!

---

# 🍓 PART 3: SETUP RASPBERRY PI

Now we configure the Raspberry Pi to send sensor data.

---

## Step 8: Prepare Raspberry Pi

**What you need:**
- Raspberry Pi (connected to power and internet)
- Keyboard + monitor OR SSH access to the Pi
- The 4 certificate files you just downloaded

**Connection options:**

**Option A: Direct (with monitor/keyboard)**
1. Connect monitor and keyboard to Pi
2. Power on the Pi
3. Login (default: username `pi`, password `raspberry`)

**Option B: SSH (remote access)**
1. Find Pi's IP address (check your router or use `ping raspberrypi.local`)
2. On your computer, open Terminal (Mac) or Command Prompt (Windows)
3. SSH in: `ssh pi@192.168.1.XXX` (replace with your Pi's IP)
4. Enter password when prompted

**✅ Success Check:** You see the Raspberry Pi command prompt `pi@raspberrypi:~ $`

---

## Step 9: Create Folders on Raspberry Pi

**On the Pi terminal, run these commands ONE BY ONE:**

```bash
# Create directory for certificates
mkdir -p /home/pi/certs

# Create directory for Pulse software
mkdir -p /home/pi/pulse

# Verify folders were created
ls -la /home/pi/
```

**✅ Success Check:** You see `certs/` and `pulse/` folders listed

---

## Step 10: Transfer Certificate Files to Pi

**You need to copy the 4 certificate files from your computer to the Pi.**

### **Option A: Using SCP (if using SSH)**

**On your computer** (NOT on the Pi), open Terminal and run:

```bash
# Navigate to where you saved the certs
cd /path/to/pulse-certs-joesbar/

# Copy all 4 files to Pi (replace 192.168.1.XXX with Pi's IP)
scp device.cert.pem pi@192.168.1.XXX:/home/pi/certs/certificate.pem.crt
scp device.private.key pi@192.168.1.XXX:/home/pi/certs/private.pem.key
scp device.public.key pi@192.168.1.XXX:/home/pi/certs/public.pem.key
scp AmazonRootCA1.pem pi@192.168.1.XXX:/home/pi/certs/root-CA.crt
```

Enter password when prompted.

### **Option B: Using USB Drive**

1. **On your computer:**
   - Copy the 4 cert files to a USB drive
2. **On the Pi:**
   - Plug in USB drive
   - Run: `lsblk` to see drive name (usually `/dev/sda1`)
   - Mount it: `sudo mount /dev/sda1 /mnt`
   - Copy files: `cp /mnt/*.pem /home/pi/certs/`
   - Copy files: `cp /mnt/*.key /home/pi/certs/`
   - Rename to correct names (see below)
   - Unmount: `sudo umount /mnt`

### **Option C: Manual Copy/Paste**

1. On Pi, create files with nano:
```bash
nano /home/pi/certs/certificate.pem.crt
```
2. Open the certificate file on your computer
3. Copy ALL content (including `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----`)
4. Paste into nano
5. Press `Ctrl+X`, then `Y`, then `Enter` to save
6. Repeat for all 4 files

---

**After copying, verify files exist:**

```bash
ls -la /home/pi/certs/
```

**✅ Success Check:** You see 4 files:
- `certificate.pem.crt`
- `private.pem.key`
- `public.pem.key`
- `root-CA.crt`

---

## Step 11: Install Required Python Libraries

**On the Raspberry Pi, run:**

```bash
# Update package list
sudo apt update

# Install pip if not installed
sudo apt install python3-pip -y

# Install AWS IoT SDK
pip3 install awsiotsdk

# Install requests library (for sensor API)
pip3 install requests

# Verify installations
pip3 list | grep -E "awsiotsdk|requests"
```

**✅ Success Check:** You see both libraries listed with version numbers

---

## Step 12: Create the Python Publisher Script

**On the Raspberry Pi, create the script:**

```bash
nano /home/pi/pulse/pulse-publisher.py
```

**Copy and paste this ENTIRE script:**

```python
#!/usr/bin/env python3
"""
Pulse Dashboard - Raspberry Pi Sensor Publisher
This script publishes sensor data to AWS IoT Core for the Pulse Dashboard system.

SETUP INSTRUCTIONS:
1. Update the CONFIGURATION section below with your venue details
2. Ensure certificates are in /home/pi/certs/
3. Run: python3 /home/pi/pulse/pulse-publisher.py
"""

import json
import time
import requests
from datetime import datetime
from awscrt import mqtt
from awsiot import mqtt_connection_builder

# ============================================================================
# ⚙️ CONFIGURATION - UPDATE THESE VALUES FOR YOUR VENUE
# ============================================================================

# STEP 1: Set your venue information (from admin portal)
VENUE_ID = "REPLACE_WITH_YOUR_VENUE_ID"           # Example: "joesbar"
LOCATION_ID = "mainfloor"                          # Example: "mainfloor", "rooftop"
DEVICE_ID = "REPLACE_WITH_YOUR_DEVICE_ID"          # Example: "joesbar-mainfloor-001"

# STEP 2: Set AWS IoT endpoint (DO NOT CHANGE unless told to)
IOT_ENDPOINT = "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"

# STEP 3: Set MQTT topic (format: pulse/sensors/{venueId})
MQTT_TOPIC = "pulse/sensors/REPLACE_WITH_YOUR_VENUE_ID"  # Example: "pulse/sensors/joesbar"

# STEP 4: Certificate file paths (DO NOT CHANGE unless you moved files)
CERT_PATH = "/home/pi/certs/certificate.pem.crt"
PRIVATE_KEY_PATH = "/home/pi/certs/private.pem.key"
ROOT_CA_PATH = "/home/pi/certs/root-CA.crt"

# STEP 5: Publishing settings
PUBLISH_INTERVAL = 15  # Publish every 15 seconds (DO NOT set lower than 5)

# STEP 6: Sensor mode
USE_REAL_SENSORS = False  # Set to True when you have real sensors connected
SENSOR_API_URL = "http://localhost:8080/api/sensors"  # Your local sensor API endpoint

# ============================================================================
# 📊 SENSOR READING FUNCTIONS
# ============================================================================

def read_sensor_data():
    """
    Read sensor data from your local API endpoint at http://localhost:8080/api/sensors
    
    If USE_REAL_SENSORS is False, generates realistic mock data for testing.
    """
    if USE_REAL_SENSORS:
        try:
            # Call your local sensor API
            response = requests.get(SENSOR_API_URL, timeout=5)
            response.raise_for_status()
            api_data = response.json()
            
            # Transform API response to Pulse format
            sensors = {
                "sound_level": api_data.get("noise_db", 0),
                "light_level": api_data.get("light_level", 0),
                "indoor_temperature": api_data.get("temperature_f", 0),
                "outdoor_temperature": api_data.get("temperature_f", 0),
                "humidity": api_data.get("humidity", 0)
            }
            
            # Extract occupancy data
            occupancy = {
                "current": api_data.get("occupancy", 0),
                "entries": api_data.get("entries", 0),
                "exits": api_data.get("exits", 0),
                "capacity": 200
            }
            
            # Extract Spotify data if available
            current_song = api_data.get("current_song", {})
            spotify = None
            if current_song and current_song.get("title") != "Unknown":
                spotify = {
                    "current_song": current_song.get("title", "Unknown"),
                    "artist": current_song.get("artist", "Unknown"),
                    "album_art": None
                }
            
            return sensors, occupancy, spotify
            
        except Exception as e:
            print(f"⚠️  Error reading from sensor API: {e}")
            print(f"   Falling back to mock data...")
            return get_mock_sensor_data(), get_mock_occupancy(), None
    else:
        # Use mock data for testing
        return get_mock_sensor_data(), get_mock_occupancy(), get_mock_spotify()

def get_mock_sensor_data():
    """Generate realistic mock sensor data for testing."""
    import random
    
    # Simulate realistic variations throughout the day
    hour = datetime.now().hour
    is_busy_time = (hour >= 17 and hour <= 23)  # 5 PM to 11 PM
    
    base_sound = 75 if is_busy_time else 60
    base_light = 400 if is_busy_time else 250
    base_temp = 74 if is_busy_time else 72
    
    return {
        "sound_level": round(base_sound + random.uniform(-5, 10), 2),
        "light_level": round(base_light + random.uniform(-50, 100), 2),
        "indoor_temperature": round(base_temp + random.uniform(-2, 3), 2),
        "outdoor_temperature": round(68 + random.uniform(-5, 10), 2),
        "humidity": round(50 + random.uniform(-10, 10), 2)
    }

def get_mock_occupancy():
    """Generate realistic mock occupancy data."""
    import random
    
    hour = datetime.now().hour
    is_busy_time = (hour >= 17 and hour <= 23)
    
    current = random.randint(30, 80) if is_busy_time else random.randint(5, 25)
    
    return {
        "current": current,
        "entries": random.randint(50, 150),
        "exits": random.randint(40, 140),
        "capacity": 200
    }

def get_mock_spotify():
    """Generate mock Spotify data for testing."""
    import random
    
    songs = [
        {"song": "Sweet Child O' Mine", "artist": "Guns N' Roses"},
        {"song": "Billie Jean", "artist": "Michael Jackson"},
        {"song": "Don't Stop Believin'", "artist": "Journey"},
        {"song": "Wonderwall", "artist": "Oasis"},
        {"song": "Mr. Brightside", "artist": "The Killers"}
    ]
    
    song = random.choice(songs)
    return {
        "current_song": song["song"],
        "artist": song["artist"],
        "album_art": None
    }

# ============================================================================
# 🔌 MQTT CONNECTION & PUBLISHING
# ============================================================================

def create_mqtt_connection():
    """Create and return MQTT connection to AWS IoT Core."""
    print("=" * 70)
    print("🔌 CONNECTING TO AWS IOT CORE")
    print("=" * 70)
    print(f"📍 Venue: {VENUE_ID}")
    print(f"📍 Device: {DEVICE_ID}")
    print(f"📍 Endpoint: {IOT_ENDPOINT}")
    print(f"📍 Topic: {MQTT_TOPIC}")
    print(f"📍 Mode: {'🔴 REAL SENSORS' if USE_REAL_SENSORS else '🧪 MOCK DATA (testing)'}")
    print("=" * 70)
    print()
    
    # Verify certificate files exist
    import os
    cert_files = {
        "Certificate": CERT_PATH,
        "Private Key": PRIVATE_KEY_PATH,
        "Root CA": ROOT_CA_PATH
    }
    
    print("🔐 Checking certificate files...")
    for name, path in cert_files.items():
        if os.path.exists(path):
            print(f"   ✅ {name}: {path}")
        else:
            print(f"   ❌ {name} NOT FOUND: {path}")
            raise FileNotFoundError(f"Missing certificate file: {path}")
    print()
    
    # Create MQTT connection
    print("🔗 Establishing MQTT connection...")
    mqtt_connection = mqtt_connection_builder.mtls_from_path(
        endpoint=IOT_ENDPOINT,
        cert_filepath=CERT_PATH,
        pri_key_filepath=PRIVATE_KEY_PATH,
        ca_filepath=ROOT_CA_PATH,
        client_id=DEVICE_ID,
        clean_session=False,
        keep_alive_secs=30
    )
    
    # Connect
    connect_future = mqtt_connection.connect()
    connect_future.result()
    
    print("✅ CONNECTED TO AWS IOT CORE!")
    print()
    
    return mqtt_connection

def publish_sensor_data(mqtt_connection):
    """Read sensors and publish data to AWS IoT Core."""
    try:
        # Read sensor data
        sensors, occupancy, spotify = read_sensor_data()
        
        # Build message payload in Pulse format
        message = {
            "deviceId": DEVICE_ID,
            "venueId": VENUE_ID,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "sensors": {
                "sound_level": sensors["sound_level"],
                "light_level": sensors["light_level"],
                "indoor_temperature": sensors["indoor_temperature"],
                "outdoor_temperature": sensors["outdoor_temperature"],
                "humidity": sensors["humidity"]
            }
        }
        
        # Add occupancy if available
        if occupancy:
            message["occupancy"] = occupancy
        
        # Add Spotify if available
        if spotify:
            message["spotify"] = spotify
        
        # Publish to MQTT
        message_json = json.dumps(message)
        mqtt_connection.publish(
            topic=MQTT_TOPIC,
            payload=message_json,
            qos=mqtt.QoS.AT_LEAST_ONCE
        )
        
        # Print confirmation
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"📤 [{timestamp}] Published sensor data:")
        print(f"   🔊 Sound:        {sensors['sound_level']:.1f} dB")
        print(f"   ☀️  Light:        {sensors['light_level']:.1f} lux")
        print(f"   🌡️  Indoor Temp:  {sensors['indoor_temperature']:.1f}°F")
        print(f"   ☁️  Outdoor Temp: {sensors['outdoor_temperature']:.1f}°F")
        print(f"   💧 Humidity:     {sensors['humidity']:.1f}%")
        if occupancy:
            print(f"   👥 Occupancy:    {occupancy['current']} people")
        if spotify:
            print(f"   🎵 Now Playing:  {spotify['current_song']} - {spotify['artist']}")
        print()
        
        return True
        
    except Exception as e:
        print(f"❌ Error publishing data: {e}")
        return False

# ============================================================================
# 🚀 MAIN PROGRAM
# ============================================================================

def main():
    """Main loop: connect to IoT and continuously publish sensor data."""
    
    print()
    print("=" * 70)
    print("🌟 PULSE DASHBOARD - SENSOR PUBLISHER")
    print("=" * 70)
    print(f"📍 Venue ID:      {VENUE_ID}")
    print(f"📍 Location:      {LOCATION_ID}")
    print(f"📍 Device ID:     {DEVICE_ID}")
    print(f"📡 MQTT Topic:    {MQTT_TOPIC}")
    print(f"⏱️  Interval:      Every {PUBLISH_INTERVAL} seconds")
    print(f"🔴 Sensor Mode:   {'REAL SENSORS (API)' if USE_REAL_SENSORS else 'MOCK DATA (testing)'}")
    if USE_REAL_SENSORS:
        print(f"🌐 Sensor API:    {SENSOR_API_URL}")
    print("=" * 70)
    print()
    
    # Verify configuration
    if "REPLACE" in VENUE_ID or "REPLACE" in DEVICE_ID or "REPLACE" in MQTT_TOPIC:
        print("❌ ERROR: Configuration not updated!")
        print()
        print("Please edit this file and update:")
        print("  - VENUE_ID")
        print("  - DEVICE_ID")
        print("  - MQTT_TOPIC")
        print()
        print("See the CONFIGURATION section at the top of this file.")
        return 1
    
    try:
        # Create MQTT connection
        mqtt_connection = create_mqtt_connection()
        
        # Start publishing loop
        print("🚀 STARTING SENSOR DATA PUBLISHING...")
        print("   Press Ctrl+C to stop")
        print()
        print("-" * 70)
        print()
        
        while True:
            success = publish_sensor_data(mqtt_connection)
            if not success:
                print("⚠️  Failed to publish, will retry in 15 seconds...")
            
            time.sleep(PUBLISH_INTERVAL)
            
    except KeyboardInterrupt:
        print()
        print()
        print("=" * 70)
        print("🛑 STOPPING SENSOR PUBLISHER...")
        print("=" * 70)
        if mqtt_connection:
            mqtt_connection.disconnect()
        print("✅ Disconnected from AWS IoT Core")
        print("👋 Goodbye!")
        print()
        
    except Exception as e:
        print()
        print("=" * 70)
        print("❌ FATAL ERROR")
        print("=" * 70)
        print(f"Error: {e}")
        print()
        print("🔍 TROUBLESHOOTING STEPS:")
        print()
        print("1. Check certificate files exist:")
        print(f"   ls -la /home/pi/certs/")
        print()
        print("2. Verify file paths in CONFIGURATION section:")
        print(f"   CERT_PATH = {CERT_PATH}")
        print(f"   PRIVATE_KEY_PATH = {PRIVATE_KEY_PATH}")
        print(f"   ROOT_CA_PATH = {ROOT_CA_PATH}")
        print()
        print("3. Check AWS IoT Console:")
        print("   - Verify IoT Thing exists")
        print("   - Verify certificate is attached and active")
        print("   - Verify policy allows Publish to topic")
        print()
        print("4. Check network connection:")
        print("   ping google.com")
        print()
        print("5. Check AWS IoT endpoint is correct:")
        print(f"   {IOT_ENDPOINT}")
        print()
        print("=" * 70)
        return 1

if __name__ == "__main__":
    exit(main() or 0)
```

**Save the file:**
- Press `Ctrl+X`
- Press `Y` (yes to save)
- Press `Enter` (confirm filename)

**✅ Success Check:** File saved, you're back at the `$` prompt

---

## Step 13: Configure the Script for Your Venue

**Edit the configuration:**

```bash
nano /home/pi/pulse/pulse-publisher.py
```

**Find these lines (near the top) and UPDATE them:**

```python
# BEFORE (default values):
VENUE_ID = "REPLACE_WITH_YOUR_VENUE_ID"
DEVICE_ID = "REPLACE_WITH_YOUR_DEVICE_ID"
MQTT_TOPIC = "pulse/sensors/REPLACE_WITH_YOUR_VENUE_ID"

# AFTER (your actual values):
VENUE_ID = "joesbar"                                    # ← Your venueId from Step 3
DEVICE_ID = "joesbar-mainfloor-001"                     # ← Device ID shown in admin portal
MQTT_TOPIC = "pulse/sensors/joesbar"                    # ← MQTT topic shown in admin portal
```

**📋 Where to find these values:**
- You saved them when you created the venue (Step 4)
- OR check the success message in admin portal
- OR look in S3 bucket folder name

**Save the file:**
- Press `Ctrl+X`, then `Y`, then `Enter`

**✅ Success Check:** Configuration updated with your venue's values

---

## Step 14: Make Script Executable

```bash
chmod +x /home/pi/pulse/pulse-publisher.py
```

**✅ Success Check:** No error message

---

## Step 15: Test the Publisher (First Run)

**Run the script:**

```bash
python3 /home/pi/pulse/pulse-publisher.py
```

**What you should see:**

```
======================================================================
🌟 PULSE DASHBOARD - SENSOR PUBLISHER
======================================================================
📍 Venue ID:      joesbar
📍 Location:      mainfloor
📍 Device ID:     joesbar-mainfloor-001
📡 MQTT Topic:    pulse/sensors/joesbar
⏱️  Interval:      Every 15 seconds
🔴 Sensor Mode:   MOCK DATA (testing)
======================================================================

🔌 CONNECTING TO AWS IOT CORE
======================================================================
📍 Venue: joesbar
📍 Device: joesbar-mainfloor-001
📍 Endpoint: a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
📍 Topic: pulse/sensors/joesbar
📍 Mode: 🧪 MOCK DATA (testing)
======================================================================

🔐 Checking certificate files...
   ✅ Certificate: /home/pi/certs/certificate.pem.crt
   ✅ Private Key: /home/pi/certs/private.pem.key
   ✅ Root CA: /home/pi/certs/root-CA.crt

🔗 Establishing MQTT connection...
✅ CONNECTED TO AWS IOT CORE!

🚀 STARTING SENSOR DATA PUBLISHING...
   Press Ctrl+C to stop

----------------------------------------------------------------------

📤 [2025-11-28 12:00:00] Published sensor data:
   🔊 Sound:        68.5 dB
   ☀️  Light:        325.8 lux
   🌡️  Indoor Temp:  72.3°F
   ☁️  Outdoor Temp: 65.7°F
   💧 Humidity:     52.1%
   👥 Occupancy:    15 people
   🎵 Now Playing:  Sweet Child O' Mine - Guns N' Roses
```

**✅ Success Check:** You see this output repeating every 15 seconds

---

## Step 16: Verify Data in Dashboard

**While the script is running:**

1. **Open a web browser**
2. **Go to your Pulse Dashboard URL** (NOT admin portal - the regular app)
3. **Login with the VENUE OWNER credentials:**
   - Email: `joe@joesbar.com` (the owner email you created)
   - Password: The temp password from Step 4
4. **You should see the dashboard loading**
5. **Wait 15-30 seconds**
6. **Refresh the page**

**✅ Success Check:** 
- Dashboard shows live sensor data
- Temperature, sound, light metrics are populated
- Data matches what the Pi is publishing
- Charts show data points

---

## Step 17: Stop the Test (Optional)

**On the Raspberry Pi:**
- Press `Ctrl+C` to stop the script

**You should see:**
```
🛑 STOPPING SENSOR PUBLISHER...
✅ Disconnected from AWS IoT Core
👋 Goodbye!
```

---

# 🔄 PART 4: MAKE IT RUN AUTOMATICALLY (Optional but Recommended)

Right now, the script only runs when you manually start it. Let's make it run automatically when the Pi boots up!

---

## Step 18: Create Systemd Service

**This makes the publisher run automatically in the background.**

**On the Raspberry Pi, create service file:**

```bash
sudo nano /etc/systemd/system/pulse-publisher.service
```

**Copy and paste this:**

```ini
[Unit]
Description=Pulse Dashboard Sensor Publisher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/pulse
ExecStart=/usr/bin/python3 /home/pi/pulse/pulse-publisher.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Save:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## Step 19: Enable and Start Service

**Run these commands:**

```bash
# Reload systemd to recognize new service
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable pulse-publisher.service

# Start service now
sudo systemctl start pulse-publisher.service

# Check status
sudo systemctl status pulse-publisher.service
```

**✅ Success Check:** Status shows `Active: active (running)` in green

---

## Step 20: Monitor the Service

**To view live logs:**

```bash
# View live logs (Ctrl+C to stop viewing)
sudo journalctl -u pulse-publisher.service -f

# View last 50 lines of logs
sudo journalctl -u pulse-publisher.service -n 50

# Check if service is running
sudo systemctl is-active pulse-publisher.service
```

**✅ Success Check:** You see sensor data being published every 15 seconds

---

## Step 21: Service Management Commands

**Useful commands for managing the service:**

```bash
# Stop the service
sudo systemctl stop pulse-publisher.service

# Start the service
sudo systemctl start pulse-publisher.service

# Restart the service (after changing config)
sudo systemctl restart pulse-publisher.service

# Disable auto-start on boot
sudo systemctl disable pulse-publisher.service

# View service status
sudo systemctl status pulse-publisher.service
```

---

# 🎓 PART 5: TROUBLESHOOTING

## Common Issues and Solutions

### Issue 1: "Connection refused" or "Connection timeout"

**Possible causes:**
1. Certificate files are incorrect or missing
2. Device isn't registered in AWS IoT Core
3. Network/firewall blocking connection
4. Wrong IoT endpoint

**Solutions:**
```bash
# Check certificate files exist
ls -la /home/pi/certs/

# Check network connectivity
ping google.com

# Try connecting to IoT endpoint
ping a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com

# Check if port 8883 is open (MQTT port)
nc -zv a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com 8883
```

---

### Issue 2: "No data showing in dashboard"

**Possible causes:**
1. VENUE_ID mismatch between Pi and Cognito user
2. MQTT topic incorrect
3. Data not writing to DynamoDB
4. Owner logged in with wrong account

**Solutions:**

**Check 1: Verify MQTT messages are arriving**
1. AWS Console → IoT Core → Test → MQTT test client
2. Subscribe to topic: `pulse/sensors/#`
3. You should see messages when Pi publishes

**Check 2: Verify DynamoDB has data**
1. AWS Console → DynamoDB → Tables → SensorData
2. Click "Explore table items"
3. Look for items with your `venueId`

**Check 3: Verify owner has correct venueId**
1. AWS Console → Cognito → Users
2. Find owner user
3. Check `custom:venueId` attribute matches Pi's VENUE_ID

---

### Issue 3: "Certificate error" or "Unauthorized"

**Possible causes:**
1. Certificate files corrupted during transfer
2. Certificate not activated in AWS
3. IoT policy not attached

**Solutions:**

**Re-download certificates from S3:**
1. AWS Console → S3 → `pulse-device-certificates`
2. Navigate to your venue folder
3. Download all 4 files again
4. Re-transfer to Pi

**Check IoT Thing status:**
1. AWS Console → IoT Core → Manage → Things
2. Find your device (e.g., `joesbar-mainfloor-001`)
3. Click on it
4. Check certificate is attached and ACTIVE

---

### Issue 4: Service won't start

**Check logs for errors:**

```bash
# View service logs
sudo journalctl -u pulse-publisher.service -n 100

# Check if Python script runs manually
cd /home/pi/pulse
python3 pulse-publisher.py

# Check file permissions
ls -la /home/pi/pulse/pulse-publisher.py
```

**Fix permissions if needed:**
```bash
chmod +x /home/pi/pulse/pulse-publisher.py
```

---

### Issue 5: Mock data works but real sensors don't

**If mock data publishes fine, but real sensors fail:**

1. **Check your sensor API is running:**
```bash
curl http://localhost:8080/api/sensors
```

2. **Verify API response format:**
```bash
curl -s http://localhost:8080/api/sensors | python3 -m json.tool
```

3. **Update the transformation logic** in `read_sensor_data()` function to match your API's response format

---

# ✅ QUICK REFERENCE CHECKLIST

Use this checklist every time you add a new venue:

## Admin Portal Setup (5 minutes)
- [ ] Login to admin portal
- [ ] Click "Create New Venue"
- [ ] Fill in venue name (e.g., "Joe's Bar")
- [ ] Fill in owner email (e.g., "joe@joesbar.com")
- [ ] Fill in owner name (e.g., "Joe Smith")
- [ ] Click through 3 steps and submit
- [ ] **SAVE the temporary password shown!**
- [ ] Write down: venueId, deviceId, MQTT topic

## Download Certificates (2 minutes)
- [ ] AWS Console → S3 → `pulse-device-certificates`
- [ ] Navigate to `{venueId}/{venueId}-mainfloor-001/`
- [ ] Download all 4 certificate files
- [ ] Save to folder on your computer

## Raspberry Pi Setup (10 minutes)
- [ ] Connect to Raspberry Pi (SSH or direct)
- [ ] Create folders: `/home/pi/certs` and `/home/pi/pulse`
- [ ] Transfer 4 certificate files to `/home/pi/certs/`
- [ ] Create `pulse-publisher.py` script in `/home/pi/pulse/`
- [ ] Update VENUE_ID, DEVICE_ID, MQTT_TOPIC in script
- [ ] Install Python libraries: `pip3 install awsiotsdk requests`
- [ ] Test run: `python3 /home/pi/pulse/pulse-publisher.py`
- [ ] Verify data publishing (see console output)
- [ ] Stop test (Ctrl+C)

## Make it Permanent (3 minutes)
- [ ] Create systemd service file
- [ ] Enable service: `sudo systemctl enable pulse-publisher.service`
- [ ] Start service: `sudo systemctl start pulse-publisher.service`
- [ ] Check status: `sudo systemctl status pulse-publisher.service`

## Verify Everything Works (2 minutes)
- [ ] Check service is running: `sudo systemctl is-active pulse-publisher.service`
- [ ] Owner logs into dashboard with their credentials
- [ ] Dashboard shows live data
- [ ] Data updates every 15 seconds
- [ ] Charts populate with data points

---

# 📞 SUPPORT & RESOURCES

## File Locations Reference

| Item | Location | Purpose |
|------|----------|---------|
| Certificates | `/home/pi/certs/` | IoT authentication |
| Publisher Script | `/home/pi/pulse/pulse-publisher.py` | Sends sensor data |
| Service File | `/etc/systemd/system/pulse-publisher.service` | Auto-start config |
| Logs | `sudo journalctl -u pulse-publisher.service` | Troubleshooting |

## Configuration Values Reference

**For venue "Joe's Bar" (venueId: `joesbar`):**

| Setting | Value | Where to Find |
|---------|-------|---------------|
| VENUE_ID | `joesbar` | Admin portal creation screen |
| DEVICE_ID | `joesbar-mainfloor-001` | Auto-generated (shown in creation) |
| MQTT_TOPIC | `pulse/sensors/joesbar` | Auto-generated (shown in creation) |
| IOT_ENDPOINT | `a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com` | Never changes |

## Important AWS Locations

| Resource | How to Find |
|----------|-------------|
| Certificates | S3 → `pulse-device-certificates` → `{venueId}/{deviceId}/` |
| IoT Thing | IoT Core → Manage → Things → Search for device ID |
| Cognito User | Cognito → User Pools → Users → Search by email |
| VenueConfig | DynamoDB → Tables → VenueConfig → Search by venueId |
| Sensor Data | DynamoDB → Tables → SensorData → Search by venueId |

---

# 🎉 SUCCESS CRITERIA

**You know it's working when:**

✅ Raspberry Pi console shows "Published sensor data" every 15 seconds  
✅ No error messages in Pi logs  
✅ Owner can login to dashboard  
✅ Dashboard shows live metrics (temperature, sound, etc.)  
✅ Charts populate with data  
✅ Data updates automatically every 15 seconds  
✅ Comfort gauge shows a score (0-100)  
✅ "Now Playing" widget shows songs (if mock mode)  

---

# 🚨 EMERGENCY CONTACTS

**If something goes wrong:**

1. **Check service status:**
   ```bash
   sudo systemctl status pulse-publisher.service
   ```

2. **View recent errors:**
   ```bash
   sudo journalctl -u pulse-publisher.service -n 100
   ```

3. **Restart everything:**
   ```bash
   sudo systemctl restart pulse-publisher.service
   ```

4. **Test manually:**
   ```bash
   sudo systemctl stop pulse-publisher.service
   python3 /home/pi/pulse/pulse-publisher.py
   ```

---

# 📚 NEXT STEPS AFTER SETUP

## Switch from Mock Data to Real Sensors

When you have real sensors connected:

1. Edit the script:
   ```bash
   nano /home/pi/pulse/pulse-publisher.py
   ```

2. Change this line:
   ```python
   USE_REAL_SENSORS = True  # Change False to True
   ```

3. Set your sensor API URL:
   ```python
   SENSOR_API_URL = "http://localhost:8080/api/sensors"
   ```

4. Restart service:
   ```bash
   sudo systemctl restart pulse-publisher.service
   ```

---

## Add Additional Locations

If a venue has multiple locations (bar, rooftop, patio):

1. **Repeat this entire process** with:
   - Same venueId
   - Different locationId (e.g., "rooftop" instead of "mainfloor")
   - Different deviceId (e.g., "joesbar-rooftop-001")
   - Different MQTT topic (e.g., "pulse/sensors/joesbar/rooftop")

2. **Use a separate Raspberry Pi** for each location

3. **Owner will see a location dropdown** in their dashboard to switch between locations

---

## Share Credentials with Venue Owner

**What to send the owner:**

```
Subject: Your Pulse Dashboard Access

Hi [Owner Name],

Your Pulse Dashboard account is ready! Here are your login details:

Dashboard URL: https://your-pulse-app-url.com
Email: joe@joesbar.com
Temporary Password: Temp542abc8xyz!

You'll be asked to change your password on first login.

The dashboard will show live data from your venue once we install the sensor device.

Questions? Reply to this email or call [your phone].

Best regards,
[Your Name]
```

---

# 🎓 APPENDIX: Understanding the System

## How Data Flows

```
Raspberry Pi (in venue)
    ↓
Publishes sensor data via MQTT every 15 seconds
    ↓
AWS IoT Core receives message on topic: pulse/sensors/{venueId}
    ↓
IoT Rule "PulseSensorDataRule" catches it
    ↓
Writes to DynamoDB SensorData table with venueId
    ↓
Owner logs into dashboard
    ↓
Dashboard queries DynamoDB for their venueId only
    ↓
Owner sees their data in real-time charts
```

## Security & Data Isolation

**Each venue is completely isolated:**
- ✅ Each venue has unique `venueId`
- ✅ Owner's Cognito account has `custom:venueId` attribute
- ✅ Dashboard only queries data matching their `venueId`
- ✅ No venue can see another venue's data
- ✅ Admin can see all venues

---

**🎉 CONGRATULATIONS! You've successfully added a new venue to Pulse Dashboard!**

---

**Questions? Issues?** Refer to the Troubleshooting section or contact support.

**Last Updated:** November 28, 2025  
**Version:** 2.0
