import { fetchAuthSession } from '@aws-amplify/auth';
import type { SensorData } from '../types';
import { VENUE_CONFIG } from '../config/amplify';

// AWS IoT Core configuration
const IOT_ENDPOINT = VENUE_CONFIG.iotEndpoint;

interface IoTMessage {
  deviceId: string;
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
    album_art: string;
  };
}

class IoTService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private messageHandlers: Set<(data: SensorData) => void> = new Set();
  private isConnecting = false;

  async connect(venueId: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      // Get AWS credentials from Cognito
      const session = await fetchAuthSession();
      const credentials = session.credentials;

      if (!credentials) {
        console.warn('No AWS credentials available, using fallback');
        this.isConnecting = false;
        return;
      }

      // Create WebSocket URL for AWS IoT Core
      const wsUrl = await this.getSignedWebSocketUrl(venueId, credentials);
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('✅ Connected to AWS IoT Core');
        this.reconnectAttempts = 0;
        this.isConnecting = false;

        // Subscribe to venue-specific topic
        this.subscribe(`pulse/venue/${venueId}/data`);
      };

      this.ws.onmessage = (event) => {
        try {
          const message: IoTMessage = JSON.parse(event.data);
          const sensorData = this.transformIoTMessage(message);
          
          // Notify all handlers
          this.messageHandlers.forEach(handler => handler(sensorData));
        } catch (error) {
          console.error('Error parsing IoT message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.isConnecting = false;
        this.handleReconnect(venueId);
      };
    } catch (error) {
      console.error('Error connecting to IoT:', error);
      this.isConnecting = false;
    }
  }

  private async getSignedWebSocketUrl(
    _venueId: string, 
    credentials: any
  ): Promise<string> {
    // For production: Generate pre-signed WebSocket URL using AWS SigV4
    // This is a simplified version - in production, use AWS SDK to sign the request
    const endpoint = `wss://${IOT_ENDPOINT}/mqtt`;
    return `${endpoint}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${credentials.accessKeyId}`;
  }

  private subscribe(topic: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const subscribeMessage = {
        action: 'subscribe',
        topics: [topic]
      };
      this.ws.send(JSON.stringify(subscribeMessage));
      console.log(`📡 Subscribed to topic: ${topic}`);
    }
  }

  private handleReconnect(venueId: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect(venueId);
    }, delay);
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
      albumArt: message.spotify?.album_art
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers.clear();
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export default new IoTService();
