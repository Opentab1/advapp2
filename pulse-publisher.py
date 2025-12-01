#!/usr/bin/env python3
"""
Pulse Dashboard - Raspberry Pi Sensor Publisher
Venue: parlaylp
Device: parlaylp-mainfloor-001

This script reads sensor data from /home/pi/shared_data.json and publishes to AWS IoT Core.
"""

import json
import time
from datetime import datetime
from awscrt import mqtt
from awsiot import mqtt_connection_builder

# ============================================================================
# ⚙️ CONFIGURATION - VENUE: parlaylp
# ============================================================================

# Venue Information
VENUE_ID = "parlaylp"
LOCATION_ID = "mainfloor"
DEVICE_ID = "parlaylp-mainfloor-001"
VENUE_CAPACITY = 400

# AWS IoT Configuration
IOT_ENDPOINT = "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"
MQTT_TOPIC = "pulse/sensors/parlaylp"

# Certificate file paths (in Downloads folder)
CERT_PATH = "/home/pi/Downloads/device.cert.pem"
PRIVATE_KEY_PATH = "/home/pi/Downloads/device.private.key"
ROOT_CA_PATH = "/home/pi/Downloads/AmazonRootCA1.pem"

# Data source
SENSOR_DATA_FILE = "/home/pi/shared_data.json"

# Publishing settings
PUBLISH_INTERVAL = 15  # Publish every 15 seconds

# ============================================================================
# 📊 SENSOR DATA READING
# ============================================================================

def read_sensor_data():
    """
    Read sensor data from /home/pi/shared_data.json
    
    Your JSON structure:
    {
      "entries": 1,
      "exits": 2,
      "lux": 499.9,
      "avg_db": -51.6,
      "peak_db": -39.0,
      "temperature_c": 26.5,
      "temperature_f": 79.7,
      "humidity": 20.8,
      "pressure": 1001.4,
      "current_song": "...",
      "last_updated": "2025-12-01 16:05:19"
    }
    """
    try:
        # Read the JSON file
        with open(SENSOR_DATA_FILE, 'r') as f:
            data = json.load(f)
        
        # Extract sensor values
        sensors = {
            "sound_level": data.get("avg_db", 0),  # Using avg_db for sound level
            "light_level": data.get("lux", 0),
            "indoor_temperature": data.get("temperature_f", 0),
            "outdoor_temperature": data.get("temperature_f", 0),  # Using same as indoor (no outdoor sensor)
            "humidity": data.get("humidity", 0),
            "pressure": data.get("pressure", 0)  # Extra field - included in case you want it
        }
        
        # Extract occupancy data
        occupancy = {
            "current": data.get("entries", 0) - data.get("exits", 0),  # Calculate current occupancy
            "entries": data.get("entries", 0),
            "exits": data.get("exits", 0),
            "capacity": VENUE_CAPACITY
        }
        
        # Extract Spotify data (if available and not an error)
        current_song = data.get("current_song", "")
        spotify = None
        if current_song and not current_song.startswith("Error"):
            # If your system provides song data in format "Title - Artist"
            if " - " in current_song:
                parts = current_song.split(" - ", 1)
                spotify = {
                    "current_song": parts[0].strip(),
                    "artist": parts[1].strip(),
                    "album_art": None
                }
            else:
                spotify = {
                    "current_song": current_song,
                    "artist": "Unknown",
                    "album_art": None
                }
        
        return sensors, occupancy, spotify
        
    except FileNotFoundError:
        print(f"⚠️  File not found: {SENSOR_DATA_FILE}")
        print(f"   Make sure the file exists and is readable")
        return None, None, None
        
    except json.JSONDecodeError as e:
        print(f"⚠️  Invalid JSON in {SENSOR_DATA_FILE}: {e}")
        return None, None, None
        
    except Exception as e:
        print(f"⚠️  Error reading sensor data: {e}")
        return None, None, None

# ============================================================================
# 🔌 MQTT CONNECTION & PUBLISHING
# ============================================================================

def create_mqtt_connection():
    """Create and return MQTT connection to AWS IoT Core."""
    print("=" * 70)
    print("🔌 CONNECTING TO AWS IOT CORE")
    print("=" * 70)
    print(f"📍 Venue:     {VENUE_ID}")
    print(f"📍 Device:    {DEVICE_ID}")
    print(f"📍 Endpoint:  {IOT_ENDPOINT}")
    print(f"📍 Topic:     {MQTT_TOPIC}")
    print(f"📍 Data File: {SENSOR_DATA_FILE}")
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
        
        if sensors is None:
            print("❌ Failed to read sensor data, skipping this publish cycle")
            return False
        
        # Build message payload in Pulse format
        message = {
            "deviceId": DEVICE_ID,
            "venueId": VENUE_ID,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "sensors": sensors
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
        print(f"   💧 Humidity:     {sensors['humidity']:.1f}%")
        print(f"   📊 Pressure:     {sensors['pressure']:.1f} hPa")
        if occupancy:
            print(f"   👥 Occupancy:    {occupancy['current']} people ({occupancy['current']/VENUE_CAPACITY*100:.1f}% full)")
            print(f"   🚪 Entries:      {occupancy['entries']}")
            print(f"   🚪 Exits:        {occupancy['exits']}")
        if spotify:
            print(f"   🎵 Now Playing:  {spotify['current_song']} - {spotify['artist']}")
        print()
        
        return True
        
    except Exception as e:
        print(f"❌ Error publishing data: {e}")
        import traceback
        traceback.print_exc()
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
    print(f"🏢 Capacity:      {VENUE_CAPACITY} people")
    print(f"📁 Data Source:   {SENSOR_DATA_FILE}")
    print("=" * 70)
    print()
    
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
        import traceback
        traceback.print_exc()
        print()
        print("🔍 TROUBLESHOOTING STEPS:")
        print()
        print("1. Check certificate files exist:")
        print(f"   ls -la /home/pi/Downloads/")
        print()
        print("2. Check sensor data file exists:")
        print(f"   cat {SENSOR_DATA_FILE}")
        print()
        print("3. Check network connection:")
        print("   ping google.com")
        print()
        print("4. Check AWS IoT endpoint is correct:")
        print(f"   {IOT_ENDPOINT}")
        print()
        print("5. Verify certificates are valid in AWS IoT Console")
        print()
        print("=" * 70)
        return 1

if __name__ == "__main__":
    exit(main() or 0)
