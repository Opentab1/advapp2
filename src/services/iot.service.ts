import mqtt from 'mqtt';
import type { SensorData } from '../types';
import { AWS_CONFIG } from '../config/amplify';
import { generateClient } from '@aws-amplify/api';
import { getCurrentUser, fetchAuthSession } from '@aws-amplify/auth';

const getVenueConfig = /* GraphQL */ `
  query GetVenueConfig($venueId: ID!, $locationId: String!) {
    getVenueConfig(venueId: $venueId, locationId: $locationId) {
      mqttTopic
      displayName
      locationName
      iotEndpoint
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
      // Get venueId from Cognito user attributes - REQUIRED
      let venueId: string | null = null;
      let locationId: string | undefined = undefined;

      try {
        await getCurrentUser();
        const session = await fetchAuthSession();
        const payload = session.tokens?.idToken?.payload;
        venueId = payload?.['custom:venueId'] as string | undefined || null;
        locationId = payload?.['custom:locationId'] as string | undefined;
        
        if (!venueId) {
          throw new Error('custom:venueId not found in user attributes');
        }
      } catch (err) {
        console.error("Failed to get venueId from Cognito:", err);
        this.isConnecting = false;
        throw new Error('User must be logged in with custom:venueId attribute');
      }

      // Query DynamoDB VenueConfig for the MQTT topic and IoT endpoint - REQUIRED
      let TOPIC: string | null = null;
      let IOT_ENDPOINT: string | null = null;

      try {
        // Verify authentication session has tokens
        const session = await fetchAuthSession();
        if (!session.tokens) {
          throw new Error('Not authenticated. Please log in again.');
        }
        
        const client = generateClient();
        const response = await client.graphql({
          query: getVenueConfig,
          variables: { 
            venueId, 
            locationId: locationId || 'default' // Use 'default' if locationId not provided
          },
          authMode: 'userPool'
        }) as any;

        const config = response?.data?.getVenueConfig;
        if (config?.mqttTopic) {
          TOPIC = config.mqttTopic;
          // Use venue-specific IoT endpoint if provided, otherwise fall back to default
          const endpoint = config.iotEndpoint || AWS_CONFIG.defaultIotEndpoint;
          IOT_ENDPOINT = `wss://${endpoint}/mqtt`;
          console.log("✅ Loaded VenueConfig for", venueId);
          console.log("   → MQTT topic:", TOPIC);
          console.log("   → IoT endpoint:", endpoint);
        } else {
          throw new Error(`No mqttTopic found in VenueConfig for venueId: ${venueId}`);
        }
      } catch (err) {
        console.error("Failed to get VenueConfig from DynamoDB:", err);
        this.isConnecting = false;
        throw new Error(`Failed to load MQTT configuration from VenueConfig for venueId: ${venueId}`);
      }

      if (!TOPIC || !IOT_ENDPOINT) {
        this.isConnecting = false;
        throw new Error('MQTT topic or IoT endpoint not found');
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
