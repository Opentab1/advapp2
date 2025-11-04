import mqtt from 'mqtt';
import type { SensorData } from '../types';
import { VENUE_CONFIG } from '../config/amplify';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser, fetchAuthSession } from '@aws-amplify/auth';

const client = generateClient();

// AWS IoT Core configuration - Direct MQTT connection
const IOT_ENDPOINT = `wss://${VENUE_CONFIG.iotEndpoint}/mqtt`;

const getVenueConfig = /* GraphQL */ `
  query GetVenueConfig($venueId: ID!, $locationId: String!) {
    getVenueConfig(venueId: $venueId, locationId: $locationId) {
      mqttTopic
      displayName
      locationName
    }
  }
`;

interface IoTMessage {
  deviceId?: string;
  timestamp: string;
  sensors: {
    sound_level: number;
    light_level: number;
    indoor_temperature: number;
    outdoor_temperature: number;
    humidity: number;
  };
  spotify?: {
    current_song: string;
    album_art?: string;
    artist?: string;
  };
  occupancy?: {
    current: number;
    entries: number;
    exits: number;
    capacity?: number;
  };
}

class IoTService {
  private client: mqtt.MqttClient | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private messageHandlers: Set<(data: SensorData) => void> = new Set();
  private isConnecting = false;

  async connect(_venueId: string): Promise<void> {
    if (this.client?.connected || this.isConnecting) {
      console.log('Already connected or connecting to AWS IoT');
      return;
    }

    this.isConnecting = true;

    try {
      // Fetch venue configuration from Cognito and AppSync
      let venueId = "fergs-stpete";
      let locationId = "main-floor";
      let TOPIC = "pulse/fergs-stpete/main-floor";

      try {
        await getCurrentUser();
        const session = await fetchAuthSession();
        const payload = session.tokens?.idToken?.payload;
        venueId = (payload?.['custom:venueId'] as string) || venueId;
        locationId = (payload?.['custom:locationId'] as string) || locationId;
      } catch (err) {
        console.warn("Not logged in, using default venue");
      }

      try {
        const response = await client.graphql({
          query: getVenueConfig,
          variables: { venueId, locationId }
        }) as any;

        const config = response?.data?.getVenueConfig;
        if (config?.mqttTopic) {
          TOPIC = config.mqttTopic;
          console.log("Loaded config for", venueId, "→ topic:", TOPIC);
        }
      } catch (err) {
        console.warn("Config not found, using fallback topic", err);
      }

      console.log('🔌 Connecting to AWS IoT Core via MQTT...');
      console.log('📍 Endpoint:', IOT_ENDPOINT);
      console.log('📡 Topic:', TOPIC);

      // Connect to AWS IoT Core without authentication
      // Note: The IoT endpoint must be configured to allow unauthenticated access
      this.client = mqtt.connect(IOT_ENDPOINT, {
        clientId: `pulse-dashboard-${Date.now()}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
        keepalive: 60,
        protocol: 'wss',
        protocolVersion: 5,
        rejectUnauthorized: false
      });

      this.client.on('connect', () => {
        console.log('✅ Connected to AWS IoT Core');
        this.reconnectAttempts = 0;
        this.isConnecting = false;

        // Subscribe to the topic
        this.subscribe(TOPIC);
      });

      this.client.on('message', (topic: string, payload: Buffer) => {
        try {
          console.log(`📨 Message received on topic: ${topic}`);
          const message: IoTMessage = JSON.parse(payload.toString());
          console.log('📊 Sensor data:', message);
          
          const sensorData = this.transformIoTMessage(message);
          
          // Notify all handlers
          this.messageHandlers.forEach(handler => handler(sensorData));
        } catch (error) {
          console.error('Error parsing IoT message:', error);
        }
      });

      this.client.on('error', (error) => {
        console.error('❌ MQTT error:', error);
        this.isConnecting = false;
      });

      this.client.on('close', () => {
        console.log('🔌 MQTT connection closed');
        this.isConnecting = false;
      });

      this.client.on('reconnect', () => {
        this.reconnectAttempts++;
        console.log(`🔄 Reconnecting... (attempt ${this.reconnectAttempts})`);
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('❌ Max reconnection attempts reached');
          this.client?.end(true);
        }
      });

      this.client.on('offline', () => {
        console.warn('⚠️ MQTT client is offline');
      });

    } catch (error) {
      console.error('Error connecting to IoT:', error);
      this.isConnecting = false;
    }
  }

  private subscribe(topic: string): void {
    if (this.client?.connected) {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error('❌ Subscription error:', err);
        } else {
          console.log(`📡 Subscribed to topic: ${topic}`);
        }
      });
    }
  }

  private transformIoTMessage(message: IoTMessage): SensorData {
    return {
      timestamp: message.timestamp || new Date().toISOString(),
      decibels: message.sensors.sound_level || 0,
      light: message.sensors.light_level || 0,
      indoorTemp: message.sensors.indoor_temperature || 0,
      outdoorTemp: message.sensors.outdoor_temperature || 0,
      humidity: message.sensors.humidity || 0,
      currentSong: message.spotify?.current_song,
      albumArt: message.spotify?.album_art,
      artist: message.spotify?.artist,
      occupancy: message.occupancy ? {
        current: message.occupancy.current || 0,
        entries: message.occupancy.entries || 0,
        exits: message.occupancy.exits || 0,
        capacity: message.occupancy.capacity
      } : undefined
    };
  }

  onMessage(handler: (data: SensorData) => void): () => void {
    this.messageHandlers.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  disconnect(): void {
    if (this.client) {
      console.log('🔌 Disconnecting from AWS IoT Core');
      this.client.end(true);
      this.client = null;
    }
    this.messageHandlers.clear();
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.client?.connected || false;
  }

  // Publish a message to IoT (for testing or commands)
  publish(topic: string, message: any): void {
    if (this.client?.connected) {
      this.client.publish(topic, JSON.stringify(message), { qos: 1 }, (err) => {
        if (err) {
          console.error('❌ Publish error:', err);
        } else {
          console.log(`📤 Published to topic: ${topic}`);
        }
      });
    }
  }
}

export default new IoTService();
