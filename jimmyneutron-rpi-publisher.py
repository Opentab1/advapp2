#!/usr/bin/env python3
"""
Pulse Dashboard - RPi Sensor Publisher for Jimmy Neutron Venue
This script publishes sensor data to AWS IoT Core for the jimmyneutron venue.
"""

import json
import time
import random
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
USE_REAL_SENSORS = False

# ============================================================================
# SENSOR READING FUNCTIONS
# ============================================================================

def read_sensor_data():
    """
    Read sensor data. Replace this with your actual sensor code.
    For now, generates realistic mock data for testing.
    """
    if USE_REAL_SENSORS:
        # TODO: Replace with your actual sensor reading code
        # Example:
        # import board
        # import adafruit_dht
        # dht_sensor = adafruit_dht.DHT22(board.D4)
        # temperature = dht_sensor.temperature
        # humidity = dht_sensor.humidity
        
        return {
            "sound_level": 0,  # Replace with actual sound sensor
            "light_level": 0,  # Replace with actual light sensor
            "indoor_temperature": 0,  # Replace with actual temp sensor
            "outdoor_temperature": 0,  # Replace with weather API or outdoor sensor
            "humidity": 0  # Replace with actual humidity sensor
        }
    else:
        # Generate realistic mock data for testing
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
        # Read sensor data
        sensors = read_sensor_data()
        
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
        
        # Optional: Add Spotify data if available
        # message["spotify"] = {
        #     "current_song": "Song Name",
        #     "artist": "Artist Name",
        #     "album_art": "https://..."
        # }
        
        # Optional: Add occupancy data if available
        # message["occupancy"] = {
        #     "current": 45,
        #     "entries": 120,
        #     "exits": 75,
        #     "capacity": 200
        # }
        
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
    print(f"Mode: {'REAL SENSORS' if USE_REAL_SENSORS else '🧪 MOCK DATA (for testing)'}")
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
