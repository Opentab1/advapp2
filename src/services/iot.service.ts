import type { SensorData } from '../types';
import { VENUE_CONFIG, IOT_TOPIC, IDENTITY_POOL_ID } from '../config/amplify';
import * as Paho from 'paho-mqtt';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';

// Constants
const IOT_HOST = VENUE_CONFIG.iotEndpoint; // e.g. a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com
const IOT_REGION = VENUE_CONFIG.region; // e.g. us-east-2
const TOPIC = IOT_TOPIC; // e.g. pulse/fergs-stpete/main-floor

// Expected payload from the topic
interface IoTMessagePayload {
  timestamp?: string;
  sensors?: {
    sound_level?: number;
    light_level?: number;
    indoor_temperature?: number;
    outdoor_temperature?: number;
    humidity?: number;
  };
  spotify?: {
    current_song?: string;
    album_art?: string;
    artist?: string;
  };
  decibels?: number;
  light?: number;
  indoorTemp?: number;
  outdoorTemp?: number;
  humidity?: number;
}

class IoTService {
  private client: Paho.Client | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseReconnectDelayMs = 3000;
  private messageHandlers: Set<(data: SensorData) => void> = new Set();
  private isConnecting = false;

  async connect(_venueId: string): Promise<void> {
    if (this.client && this.client.isConnected()) return;
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      if (!IDENTITY_POOL_ID) {
        console.warn('Missing VITE_COGNITO_IDENTITY_POOL_ID; cannot obtain guest AWS credentials.');
        this.isConnecting = false;
        return;
      }

      // Acquire temporary AWS credentials (guest, no login)
      const credentialsProvider = fromCognitoIdentityPool({
        identityPoolId: IDENTITY_POOL_ID,
        clientConfig: { region: IOT_REGION }
      });
      const credentials = await credentialsProvider();

      // Pre-sign the MQTT over WebSocket URL using SigV4
      const presignedUrl = await this.createPresignedWssUrl(credentials);

      // Initialize Paho MQTT client
      const clientId = `pulse-${Math.random().toString(36).slice(2)}`;
      this.client = new Paho.Client(presignedUrl, clientId);

      // Set callbacks
      this.client.onConnectionLost = (_response: Paho.MQTTError) => {
        console.warn('AWS IoT connection lost');
        this.isConnecting = false;
        this.handleReconnect(_venueId);
      };

      this.client.onMessageArrived = (message: Paho.Message) => {
        try {
          const text = message.payloadString || '{}';
          const payload: IoTMessagePayload = JSON.parse(text);
          const data = this.transformPayload(payload);
          this.messageHandlers.forEach((handler) => handler(data));
        } catch (err) {
          console.error('Error parsing MQTT message', err);
        }
      };

      // Connect
      await new Promise<void>((resolve, reject) => {
        this.client!.connect({
          useSSL: true,
          mqttVersion: 4,
          timeout: 10,
          keepAliveInterval: 60,
          cleanSession: true,
          onSuccess: () => {
            console.log('✅ Connected to AWS IoT Core');
            this.reconnectAttempts = 0;
            this.isConnecting = false;
            // Subscribe to fixed topic
            this.client!.subscribe(TOPIC, { qos: 0 });
            console.log(`📡 Subscribed to topic: ${TOPIC}`);
            resolve();
          },
          onFailure: (err: Paho.MQTTError) => {
            console.error('Failed to connect to AWS IoT', err);
            this.isConnecting = false;
            reject(err);
          }
        });
      });
    } catch (error) {
      console.error('Error initializing AWS IoT MQTT', error);
      this.isConnecting = false;
      this.handleReconnect(_venueId);
    }
  }

  private async createPresignedWssUrl(credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  }): Promise<string> {
    const signer = new SignatureV4({
      service: 'iotdevicegateway',
      region: IOT_REGION,
      credentials,
      sha256: Sha256
    });

    const request: any = {
      method: 'GET',
      protocol: 'wss:',
      hostname: IOT_HOST,
      path: '/mqtt',
      headers: { host: IOT_HOST },
      query: {}
    };

    // 15 minutes expiration
    const presigned = await signer.presign(request, { expiresIn: 15 * 60 });

    // Build final URL
    const qs = new URLSearchParams();
    if (presigned.query) {
      Object.entries(presigned.query).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((val) => qs.append(k, String(val)));
        else if (typeof v !== 'undefined') qs.set(k, String(v));
      });
    }
    return `wss://${IOT_HOST}${presigned.path}?${qs.toString()}`;
  }

  private transformPayload(payload: IoTMessagePayload): SensorData {
    // Support either flat or nested payloads
    const sensors = payload.sensors || {};
    return {
      timestamp: payload.timestamp || new Date().toISOString(),
      decibels: payload.decibels ?? sensors.sound_level ?? 0,
      light: payload.light ?? sensors.light_level ?? 0,
      indoorTemp: payload.indoorTemp ?? sensors.indoor_temperature ?? 0,
      outdoorTemp: payload.outdoorTemp ?? sensors.outdoor_temperature ?? 0,
      humidity: payload.humidity ?? sensors.humidity ?? 0,
      currentSong: payload.spotify?.current_song,
      albumArt: payload.spotify?.album_art,
      artist: payload.spotify?.artist
    };
  }

  private handleReconnect(venueId: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }
    this.reconnectAttempts += 1;
    const delay = this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`Reconnecting to AWS IoT in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(venueId), delay);
  }

  onMessage(handler: (data: SensorData) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  disconnect(): void {
    try {
      if (this.client && this.client.isConnected()) {
        this.client.disconnect();
      }
    } catch {}
    this.client = null;
    this.messageHandlers.clear();
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return !!this.client?.isConnected();
  }
}

export default new IoTService();
