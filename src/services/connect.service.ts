/**
 * VenueScope Connect Service
 *
 * Manages the "Connect Venue Cameras" flow:
 * - Polls for connected cameras registered by the installer
 * - Tracks connection status per venue
 * - Provides download link for the branded installer
 */

import authService from './auth.service';

export interface ConnectedCamera {
  cameraId: string;
  name: string;
  mode: string;
  enabled: boolean;
  notes: string;
  createdAt: string;
  // Derived
  isOnline: boolean;
  location: string; // parsed from notes
}

export interface ConnectStatus {
  connected: boolean;
  cameras: ConnectedCamera[];
  cameraCount: number;
  lastSeen: Date | null;
}

// Cache
let _lastStatus: ConnectStatus | null = null;
let _lastFetch = 0;
const CACHE_TTL = 15_000; // 15s

class ConnectService {

  /**
   * Get the VenueScope server base URL (the Mac running the engine).
   * Configured via VITE_VENUESCOPE_URL env var.
   */
  private get serverUrl(): string {
    const base = import.meta.env.VITE_VENUESCOPE_URL || '';
    // Port 8502 is the REST API; strip trailing slash
    return base.replace(':8501', ':8502').replace(/\/$/, '');
  }

  /**
   * Fetch current connection status and camera list from the Mac's API.
   * Returns null if the server is unreachable (expected when not on Tailscale).
   */
  async getStatus(): Promise<ConnectStatus | null> {
    const now = Date.now();
    if (_lastStatus && now - _lastFetch < CACHE_TTL) {
      return _lastStatus;
    }

    if (!this.serverUrl) return null;

    try {
      const res = await fetch(`${this.serverUrl}/api/connect/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;

      const data = await res.json();
      const status: ConnectStatus = {
        connected:   data.connected ?? false,
        cameraCount: data.camera_count ?? 0,
        lastSeen:    new Date(),
        cameras: (data.cameras || []).map((c: any) => ({
          cameraId:  c.camera_id,
          name:      c.name,
          mode:      c.mode || 'drink_count',
          enabled:   c.enabled !== false,
          notes:     c.notes || '',
          createdAt: c.created_at || '',
          isOnline:  true, // if API responded, cameras are reachable
          location:  _parseLocation(c.notes || c.name || ''),
        })),
      };

      _lastStatus = status;
      _lastFetch  = now;
      return status;
    } catch {
      return null;
    }
  }

  /**
   * Poll for status changes. Calls callback when cameras are registered.
   * Returns a cleanup function.
   */
  watchStatus(callback: (status: ConnectStatus | null) => void): () => void {
    let active = true;

    const poll = async () => {
      if (!active) return;
      const status = await this.getStatus();
      callback(status);
    };

    poll();
    const interval = setInterval(poll, 15_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }

  /**
   * Download the VenueScope Connect installer script.
   * For now, downloads the Python script directly from the server.
   * In production this would be a packaged .exe/.pkg.
   */
  downloadInstaller(): void {
    const a    = document.createElement('a');
    a.href     = '/venuescope_setup.sh';
    a.download = 'venuescope_setup.sh';
    a.click();
  }

  /**
   * Check if the VenueScope server is reachable (i.e. Tailscale is working).
   */
  async isServerReachable(): Promise<boolean> {
    if (!this.serverUrl) return false;
    try {
      const res = await fetch(`${this.serverUrl}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  clearCache(): void {
    _lastStatus = null;
    _lastFetch  = 0;
  }
}

function _parseLocation(text: string): string {
  // Extract location from notes like "Discovered via VenueScope Connect from hostname (192.168.x.x)"
  const match = text.match(/from\s+(\S+)/i);
  return match ? match[1] : 'Venue';
}

export default new ConnectService();
