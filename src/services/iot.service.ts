import mqtt from 'mqtt';
import type { SensorData } from '../types';
import { AWS_IOT_CONFIG } from '../config/amplify';
import { generateClient } from '@aws-amplify/api';
import { getCurrentUser, fetchAuthSession } from '@aws-amplify/auth';

// AWS IoT Core configuration - Direct MQTT connection
const IOT_ENDPOINT = `wss://${AWS_IOT_CONFIG.endpoint}/mqtt`;
const FALLBACK_MQTT_TOPIC = 'pulse/sensors/data';

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

type VenueConnectionOptions = {
  venueId?: string;
  locationId?: string;
};

interface VenueConnectionInfo {
  venueId: string;
  locationId?: string;
  topic: string;
  displayName?: string;
  locationName?: string;
}

class IoTService {
  private client: mqtt.MqttClient | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private messageHandlers: Set<(data: SensorData) => void> = new Set();
  private isConnecting = false;
  private currentTopic: string | null = null;
  private connectionInfo: VenueConnectionInfo | null = null;

  async connect(options: VenueConnectionOptions = {}): Promise<VenueConnectionInfo> {
    const info = await this.resolveVenueConnection(options);

    if (this.client?.connected && this.currentTopic === info.topic) {
      console.log('Already connected to AWS IoT topic:', info.topic);
      this.connectionInfo = info;
      return info;
    }

    if (this.client?.connected && this.currentTopic && this.currentTopic !== info.topic) {
      console.log(`Switching MQTT subscription from ${this.currentTopic} to ${info.topic}`);
      this.client.unsubscribe(this.currentTopic, (err) => {
        if (err) {
          console.warn('Error unsubscribing from previous topic', err);
        }
      });
      this.subscribe(info.topic);
      this.currentTopic = info.topic;
      this.connectionInfo = info;
      return info;
    }

    if (this.isConnecting) {
      return this.connectionInfo ?? info;
    }

    this.isConnecting = true;
    this.connectionInfo = info;

    try {
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

      this.registerClientEventHandlers(info.topic);
    } catch (error) {
      this.isConnecting = false;
      console.error('Error establishing MQTT connection', error);
      throw error;
    }

    return info;
  }

  private registerClientEventHandlers(topic: string): void {
    if (!this.client) {
      return;
    }

    this.client.removeAllListeners();

    this.client.on('connect', () => {
      console.log('✅ Connected to AWS IoT Core');
      this.reconnectAttempts = 0;
      this.isConnecting = false;
      this.subscribe(topic);
    });

    this.client.on('message', (messageTopic: string, payload: Buffer) => {
      this.handleIncomingMessage(messageTopic, payload);
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
  }

  private async resolveVenueConnection(options: VenueConnectionOptions): Promise<VenueConnectionInfo> {
    let venueId = options.venueId?.trim();
    let locationId = options.locationId?.trim();
    let venueDisplayName: string | undefined;
    let locationDisplayName: string | undefined;

    try {
      await getCurrentUser();
      const session = await fetchAuthSession();
      const payload = session.tokens?.idToken?.payload;
      if (!venueId) {
        venueId = (payload?.['custom:venueId'] as string)?.trim() || venueId;
      }
      if (!locationId) {
        locationId = (payload?.['custom:locationId'] as string)?.trim() || locationId;
      }
    } catch (err) {
      console.warn('Unable to load Cognito user attributes for IoT connection', err);
    }

    if (!venueId) {
      throw new Error('Unable to determine venue ID for IoT subscription');
    }

    const locationCandidates = Array.from(
      new Set(
        [
          locationId,
          options.locationId,
          'main-floor',
          'default'
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    );

    let topic = FALLBACK_MQTT_TOPIC;
    let resolvedLocationId = locationId;

    let gqlClient: ReturnType<typeof generateClient> | null = null;
    try {
      gqlClient = generateClient();
    } catch (err) {
      console.warn('Unable to initialise AppSync client for venue config lookup', err);
    }

    if (gqlClient) {
      for (const candidate of locationCandidates) {
        try {
          const response = await gqlClient.graphql({
            query: getVenueConfig,
            variables: { venueId, locationId: candidate }
          }) as any;

          const config = response?.data?.getVenueConfig;
          if (config?.mqttTopic) {
            topic = config.mqttTopic;
            venueDisplayName = config.displayName ?? venueDisplayName;
            locationDisplayName = config.locationName ?? locationDisplayName;
            resolvedLocationId = candidate;
            console.log(`Loaded venue config for ${venueId} → topic: ${topic}`);
            break;
          }
        } catch (err) {
          console.warn(`Config lookup failed for ${venueId}/${candidate}`, err);
        }
      }
    }

    if (topic === FALLBACK_MQTT_TOPIC) {
      console.warn(`Using fallback MQTT topic ${FALLBACK_MQTT_TOPIC} for venue ${venueId}`);
    }

    return {
      venueId,
      locationId: resolvedLocationId,
      topic,
      displayName: venueDisplayName,
      locationName: locationDisplayName
    };
  }

  private handleIncomingMessage(topic: string, payload: Buffer): void {
    try {
      console.log(`📨 Message received on topic: ${topic}`);
      const message: IoTMessage = JSON.parse(payload.toString());
      const sensorData = this.transformIoTMessage(message);
      this.messageHandlers.forEach(handler => handler(sensorData));
    } catch (error) {
      console.error('Error parsing IoT message:', error);
    }
  }

  private subscribe(topic: string): void {
    if (this.client?.connected) {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error('❌ Subscription error:', err);
        } else {
          this.currentTopic = topic;
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
      this.client.removeAllListeners();
      this.client.end(true);
      this.client = null;
    }
    this.messageHandlers.clear();
    this.reconnectAttempts = 0;
    this.currentTopic = null;
    this.isConnecting = false;
    this.connectionInfo = null;
  }

  isConnected(): boolean {
    return this.client?.connected || false;
  }

  getActiveConnection(): VenueConnectionInfo | null {
    return this.connectionInfo;
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
