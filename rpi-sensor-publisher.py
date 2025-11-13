#!/usr/bin/env python3
"""
Pulse Dashboard - RPi Sensor Data Publisher

This script reads sensor data from your Raspberry Pi and publishes it to AWS IoT Core.
The data will then appear in your Pulse Dashboard for the configured venueId.

Required:
- AWS IoT certificates (certificate.pem.crt, private.pem.key, root-CA.crt)
- Python packages: awsiotsdk, adafruit-circuitpython-dht (or your sensor libraries)

Setup:
1. Install dependencies: pip3 install awsiotsdk
2. Download IoT certificates from AWS IoT Console
3. Update VENUE_ID and certificate paths below
4. Run: python3 rpi-sensor-publisher.py
"""

import json
import time
import sys
from datetime import datetime
from awscrt import mqtt
from awsiot import mqtt_connection_builder

# ============================================================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================================================

# Your venue ID (must match custom:venueId in Cognito user)
VENUE_ID = "YOUR_VENUE_ID"  # e.g., "fergs-stpete", "my-bar", "test-venue"

# AWS IoT Core endpoint
IOT_ENDPOINT = "a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com"

# MQTT topic (format: venue/{venueId}/sensors)
MQTT_TOPIC = f"venue/{VENUE_ID}/sensors"

# Path to your AWS IoT certificates
CERT_PATH = "/home/pi/certs/certificate.pem.crt"
PRIVATE_KEY_PATH = "/home/pi/certs/private.pem.key"
ROOT_CA_PATH = "/home/pi/certs/root-CA.crt"

# Device identifier
DEVICE_ID = f"{VENUE_ID}-rpi-001"

# Publishing interval (seconds)
PUBLISH_INTERVAL = 15

# ============================================================================
# SENSOR CONFIGURATION
# ============================================================================

# Set to True if you have actual sensors connected
USE_REAL_SENSORS = False

# If USE_REAL_SENSORS = True, uncomment and configure your sensors:
# import board
# import adafruit_dht
# dht_sensor = adafruit_dht.DHT22(board.D4)

# ============================================================================
# SENSOR READING FUNCTIONS
# ============================================================================

def read_sensor_data():
    """
    Read sensor data from your connected sensors.
    Modify this function based on your actual sensor hardware.
    """
    if USE_REAL_SENSORS:
        # Example: Read from DHT22 temperature/humidity sensor
        try:
            # temperature = dht_sensor.temperature
            # humidity = dht_sensor.humidity
            
            # Replace with your actual sensor reading code
            return {
                "sound_level": read_sound_sensor(),      # Replace with actual function
                "light_level": read_light_sensor(),      # Replace with actual function
                "indoor_temperature": read_temperature_sensor(),  # Replace with actual function
                "outdoor_temperature": read_outdoor_temp(),  # Replace with actual function or API
                "humidity": read_humidity_sensor()       # Replace with actual function
            }
        except Exception as e:
            print(f"Error reading sensors: {e}")
            return get_mock_sensor_data()
    else:
        return get_mock_sensor_data()

def get_mock_sensor_data():
    """
    Generate realistic mock sensor data for testing.
    Remove this once you have real sensors connected.
    """
    import random
    
    # Simulate realistic values with some variation
    base_time = time.time()
    variation = (base_time % 60) / 60  # 0-1 based on current second
    
    return {
        "sound_level": 65 + random.uniform(-10, 20) + (variation * 15),
        "light_level": 300 + random.uniform(-50, 150) + (variation * 100),
        "indoor_temperature": 70 + random.uniform(-3, 5) + (variation * 4),
        "outdoor_temperature": 65 + random.uniform(-5, 10),
        "humidity": 45 + random.uniform(-10, 15) + (variation * 10)
    }

def read_spotify_data():
    """
    Optional: Get currently playing song from Spotify API.
    Returns None if not implemented.
    """
    # TODO: Implement Spotify API integration if desired
    # For now, return mock data or None
    return {
        "current_song": "Test Song",
        "artist": "Test Artist",
        "album_art": "https://via.placeholder.com/300"
    }

def read_occupancy_data():
    """
    Optional: Get occupancy data from people counter sensors.
    Returns None if not implemented.
    """
    # TODO: Implement people counter integration if desired
    return {
        "current": 45,
        "entries": 120,
        "exits": 75,
        "capacity": 200
    }

# ============================================================================
# MQTT CONNECTION & PUBLISHING
# ============================================================================

def create_mqtt_connection():
    """Create and return MQTT connection to AWS IoT Core."""
    print(f"🔌 Connecting to AWS IoT Core...")
    print(f"   Endpoint: {IOT_ENDPOINT}")
    print(f"   Device ID: {DEVICE_ID}")
    print(f"   Topic: {MQTT_TOPIC}")
    
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
    print("✅ Connected to AWS IoT Core")
    
    return mqtt_connection

def publish_sensor_data(mqtt_connection):
    """Read sensors and publish data to AWS IoT Core."""
    try:
        # Read sensor data
        sensors = read_sensor_data()
        
        # Build message payload
        message = {
            "deviceId": DEVICE_ID,
            "venueId": VENUE_ID,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "sensors": {
                "sound_level": round(sensors["sound_level"], 2),
                "light_level": round(sensors["light_level"], 2),
                "indoor_temperature": round(sensors["indoor_temperature"], 2),
                "outdoor_temperature": round(sensors["outdoor_temperature"], 2),
                "humidity": round(sensors["humidity"], 2)
            }
        }
        
        # Add optional data if available
        spotify = read_spotify_data()
        if spotify:
            message["spotify"] = spotify
        
        occupancy = read_occupancy_data()
        if occupancy:
            message["occupancy"] = occupancy
        
        # Publish to MQTT
        message_json = json.dumps(message)
        mqtt_connection.publish(
            topic=MQTT_TOPIC,
            payload=message_json,
            qos=mqtt.QoS.AT_LEAST_ONCE
        )
        
        print(f"📤 Published at {message['timestamp']}")
        print(f"   🔊 Sound: {sensors['sound_level']:.1f} dB")
        print(f"   ☀️  Light: {sensors['light_level']:.1f} lux")
        print(f"   🌡️  Temp: {sensors['indoor_temperature']:.1f}°F")
        print(f"   💧 Humidity: {sensors['humidity']:.1f}%")
        
        return True
        
    except Exception as e:
        print(f"❌ Error publishing data: {e}")
        return False

# ============================================================================
# MAIN LOOP
# ============================================================================

def main():
    """Main loop: connect to IoT and continuously publish sensor data."""
    
    # Validate configuration
    if VENUE_ID == "YOUR_VENUE_ID":
        print("❌ ERROR: Please update VENUE_ID in the script")
        print("   Set it to match your Cognito user's custom:venueId attribute")
        sys.exit(1)
    
    print("=" * 60)
    print("🌟 Pulse Dashboard - RPi Sensor Publisher")
    print("=" * 60)
    print(f"Venue ID: {VENUE_ID}")
    print(f"Publishing to: {MQTT_TOPIC}")
    print(f"Interval: {PUBLISH_INTERVAL} seconds")
    print(f"Mode: {'REAL SENSORS' if USE_REAL_SENSORS else 'MOCK DATA (for testing)'}")
    print("=" * 60)
    
    try:
        # Create MQTT connection
        mqtt_connection = create_mqtt_connection()
        
        # Publish loop
        print("\n📡 Starting to publish sensor data...")
        print("   Press Ctrl+C to stop\n")
        
        while True:
            success = publish_sensor_data(mqtt_connection)
            if not success:
                print("⚠️  Failed to publish, will retry...")
            
            time.sleep(PUBLISH_INTERVAL)
            
    except KeyboardInterrupt:
        print("\n\n🛑 Stopping sensor publisher...")
        mqtt_connection.disconnect()
        print("✅ Disconnected. Goodbye!")
        
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        print("\nTroubleshooting:")
        print("1. Check that certificate files exist and paths are correct")
        print("2. Verify IoT Thing exists in AWS IoT Console")
        print("3. Ensure IoT policy allows publish to venue/* topics")
        print("4. Check network connection")
        sys.exit(1)

if __name__ == "__main__":
    main()
