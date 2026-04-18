/**
 * iot.service.ts
 *
 * IoT sensor data service. AWS IoT Core / MQTT integration has been replaced
 * by direct DynamoDB polling (via api.service.ts) since the venue uses a
 * VenueScope camera setup rather than dedicated IoT hardware sensors.
 *
 * This file is kept as a stub so any future MQTT broker can be wired in
 * without changing call sites.
 */
import type { SensorData } from '../types';

class IoTService {
  private messageHandlers: Set<(data: SensorData) => void> = new Set();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async connect(_venueId: string): Promise<void> {
    // No-op — sensor data comes via DynamoDB polling in api.service.ts
  }

  onMessage(handler: (data: SensorData) => void): () => void {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  disconnect(): void {
    this.messageHandlers.clear();
  }

  isConnected(): boolean {
    return false;
  }
}

export default new IoTService();
