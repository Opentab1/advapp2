#!/usr/bin/env python3
"""
Pulse Dashboard - RPi Sensor Publisher for Jimmy Neutron Venue
This script publishes sensor data to AWS IoT Core for the jimmyneutron venue.
"""

import json
import time
import requests
from datetime import datetime
from awscrt import mqtt
from awsiot import mqtt_connection_builder

# ============================================================================
# CONFIGURATION - Your Venue Settings
# ============================================================================

VENUE_ID = "jimmyneutron"
LOCATION_ID = "mainfloor"
DEVICE_ID = "jimmyneutron-mainfloor-001"

# AWS IoT Core Settings
IOT_ENDPOINT = "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"
MQTT_TOPIC = "pulse/sensors/jimmyneutron"

# Certificate Paths - UPDATE THESE to where you saved the files
CERT_PATH = "/home/pi/certs/certificate.pem.crt"
PRIVATE_KEY_PATH = "/home/pi/certs/private.pem.key"
ROOT_CA_PATH = "/home/pi/certs/root-CA.crt"

# Publishing interval (seconds)
PUBLISH_INTERVAL = 15

# Set to True when you have real sensors connected
USE_REAL_SENSORS = True

# Your local sensor API endpoint
SENSOR_API_URL = "http://localhost:8080/api/sensors"

# ============================================================================
# SENSOR READING FUNCTIONS
# ============================================================================

def read_sensor_data():
    """
    Read sensor data from your local API endpoint at http://localhost:8080/api/sensors
    """
    if USE_REAL_SENSORS:
        try:
            # Call your local sensor API
            response = requests.get(SENSOR_API_URL, timeout=5)
            response.raise_for_status()
            api_data = response.json()
            
            # Transform API response to AWS format
            sensors = {
                "sound_level": api_data.get("noise_db", 0),
                "light_level": api_data.get("light_level", 0),
                "indoor_temperature": api_data.get("temperature_f", 0),
                "outdoor_temperature": api_data.get("temperature_f", 0),  # Use same temp if no outdoor sensor
                "humidity": api_data.get("humidity", 0)
            }
            
            # Extract occupancy data
            occupancy = {
                "current": api_data.get("occupancy", 0),
                "entries": api_data.get("entries", 0),
                "exits": api_data.get("exits", 0),
                "capacity": 200  # Set your venue capacity
            }
            
            # Extract Spotify data if available
            current_song = api_data.get("current_song", {})
            spotify = None
            if current_song and current_song.get("title") != "Unknown":
                spotify = {
                    "current_song": current_song.get("title", "Unknown"),
                    "artist": current_song.get("artist", "Unknown"),
                    "album_art": None  # Add if your API provides it
                }
            
            return sensors, occupancy, spotify
            
        except Exception as e:
            print(f"⚠️  Error reading from sensor API: {e}")
            print(f"   Falling back to mock data...")
            return get_mock_sensor_data(), None, None
    else:
        return get_mock_sensor_data(), None, None

def get_mock_sensor_data():
    """Fallback mock data if API is unavailable."""
    import random
    base_time = time.time()
    variation = (base_time % 60) / 60
    
    return {
        "sound_level": round(65 + random.uniform(-10, 20) + (variation * 15), 2),
        "light_level": round(300 + random.uniform(-50, 150) + (variation * 100), 2),
        "indoor_temperature": round(70 + random.uniform(-3, 5) + (variation * 4), 2),
        "outdoor_temperature": round(65 + random.uniform(-5, 10), 2),
        "humidity": round(45 + random.uniform(-10, 15) + (variation * 10), 2)
    }

# ============================================================================
# MQTT CONNECTION & PUBLISHING
# ============================================================================

def create_mqtt_connection():
    """Create and return MQTT connection to AWS IoT Core."""
    print("=" * 60)
    print("🔌 Connecting to AWS IoT Core...")
    print(f"   Endpoint: {IOT_ENDPOINT}")
    print(f"   Device: {DEVICE_ID}")
    print(f"   Topic: {MQTT_TOPIC}")
    print("=" * 60)
    
    mqtt_connection = mqtt_connection_builder.mtls_from_path(
        endpoint=IOT_ENDPOINT,
        cert_filepath=CERT_PATH,
        pri_key_filepath=PRIVATE_KEY_PATH,
        ca_filepath=ROOT_CA_PATH,
        client_id=DEVICE_ID,
        clean_session=False,
        keep_alive_secs=30
    )
    
    connect_future = mqtt_connection.connect()
    connect_future.result()
    
    print("✅ Connected successfully!")
    print()
    
    return mqtt_connection

def publish_sensor_data(mqtt_connection):
    """Read sensors and publish data to AWS IoT Core."""
    try:
        # Read sensor data from API
        sensors, occupancy, spotify = read_sensor_data()
        
        # Build message payload in the format your app expects
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
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"📤 Published at {timestamp}")
        print(f"   🔊 Sound: {sensors['sound_level']:.1f} dB")
        print(f"   ☀️  Light: {sensors['light_level']:.1f} lux")
        print(f"   🌡️  Indoor Temp: {sensors['indoor_temperature']:.1f}°F")
        print(f"   ☁️  Outdoor Temp: {sensors['outdoor_temperature']:.1f}°F")
        print(f"   💧 Humidity: {sensors['humidity']:.1f}%")
        if occupancy:
            print(f"   👥 Occupancy: {occupancy['current']} people (Entries: {occupancy['entries']}, Exits: {occupancy['exits']})")
        if spotify:
            print(f"   🎵 Playing: {spotify['current_song']} - {spotify['artist']}")
        print()
        
        return True
        
    except Exception as e:
        print(f"❌ Error publishing data: {e}")
        return False

# ============================================================================
# MAIN LOOP
# ============================================================================

def main():
    """Main loop: connect to IoT and continuously publish sensor data."""
    
    print()
    print("=" * 60)
    print("🌟 Pulse Dashboard - Sensor Publisher")
    print("=" * 60)
    print(f"Venue: {VENUE_ID}")
    print(f"Location: {LOCATION_ID}")
    print(f"Publishing to: {MQTT_TOPIC}")
    print(f"Interval: Every {PUBLISH_INTERVAL} seconds")
    print(f"Mode: {'✅ REAL SENSORS (API)' if USE_REAL_SENSORS else '🧪 MOCK DATA (for testing)'}")
    if USE_REAL_SENSORS:
        print(f"Sensor API: {SENSOR_API_URL}")
    print("=" * 60)
    print()
    
    try:
        # Create MQTT connection
        mqtt_connection = create_mqtt_connection()
        
        # Start publishing loop
        print("📡 Starting to publish sensor data...")
        print("   Press Ctrl+C to stop")
        print()
        
        while True:
            success = publish_sensor_data(mqtt_connection)
            if not success:
                print("⚠️  Failed to publish, will retry in 15 seconds...")
            
            time.sleep(PUBLISH_INTERVAL)
            
    except KeyboardInterrupt:
        print()
        print()
        print("🛑 Stopping sensor publisher...")
        if mqtt_connection:
            mqtt_connection.disconnect()
        print("✅ Disconnected. Goodbye!")
        print()
        
    except Exception as e:
        print()
        print(f"❌ Fatal error: {e}")
        print()
        print("Troubleshooting:")
        print("1. Check certificate files exist at:")
        print(f"   - {CERT_PATH}")
        print(f"   - {PRIVATE_KEY_PATH}")
        print(f"   - {ROOT_CA_PATH}")
        print("2. Verify IoT Thing exists in AWS IoT Console")
        print("3. Ensure IoT policy is attached to certificate")
        print("4. Check network connection")
        print()
        return 1

if __name__ == "__main__":
    exit(main() or 0)
