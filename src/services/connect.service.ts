/**
 * VenueScope Connect Service
 *
 * Generates OS-specific setup scripts that:
 * 1. Install Tailscale (if not present)
 * 2. Join the VenueScope Tailscale network using a pre-auth key (no login needed)
 * 3. Notify DigitalOcean automatically so cameras appear in the dashboard
 *
 * File types by OS so double-click auto-runs:
 *   Mac   → .command  (Terminal opens and executes)
 *   Win   → .bat      (CMD executes)
 *   Linux → .sh       (mark executable and run)
 */

import authService from './auth.service';

export interface ConnectedCamera {
  cameraId: string;
  name: string;
  mode: string;
  enabled: boolean;
  notes: string;
  createdAt: string;
  isOnline: boolean;
  location: string;
}

export interface ConnectStatus {
  connected: boolean;
  cameras: ConnectedCamera[];
  cameraCount: number;
  lastSeen: Date | null;
}

export type VenueOS = 'mac' | 'windows' | 'linux';

// ── Constants ─────────────────────────────────────────────────────────────────
const AUTHKEY  = import.meta.env.VITE_TAILSCALE_AUTHKEY || '';
const CALLBACK = 'https://137-184-61-178.sslip.io/venue-connected';

// Cache
let _lastStatus: ConnectStatus | null = null;
let _lastFetch = 0;
const CACHE_TTL = 15_000;

// ── OS Detection ──────────────────────────────────────────────────────────────
export function detectOS(): VenueOS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win'))   return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'mac'; // mac / ipad / iphone all default to mac script
}

// ── Script Generators ─────────────────────────────────────────────────────────
function macScript(venueId: string): string {
  return `#!/bin/bash
clear
echo "========================================"
echo "  VenueScope Camera Setup"
echo "========================================"
echo ""
echo "This connects your cameras to VenueScope."
echo "It takes about 30 seconds."
echo ""

# Install Tailscale if not present
if ! command -v tailscale &>/dev/null; then
  echo "Step 1/2 — Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
  echo ""
fi

echo "Step 2/2 — Connecting to VenueScope network..."
sudo tailscale up --authkey=${AUTHKEY} --hostname=venue-${venueId} --accept-routes 2>/dev/null

MYIP=$(tailscale ip -4 2>/dev/null || echo "unknown")

# Notify VenueScope automatically
curl -s "${CALLBACK}?ip=$MYIP&hostname=venue-${venueId}&venue=${venueId}" >/dev/null 2>&1 || true

clear
echo "========================================"
echo "  ALL DONE — Cameras connected."
echo "========================================"
echo ""
echo "  Your Tailscale IP: $MYIP"
echo ""
echo "  Cameras will appear in your dashboard"
echo "  within 2 minutes."
echo "========================================"
echo ""
read -p "Press Enter to close..."
`;
}

function windowsScript(venueId: string): string {
  return `@echo off
cls
echo ========================================
echo   VenueScope Camera Setup
echo ========================================
echo.
echo This connects your cameras to VenueScope.
echo It takes about 30 seconds.
echo.

where tailscale >nul 2>&1
if %errorlevel% neq 0 (
    echo Tailscale is not installed.
    echo.
    echo Opening the Tailscale installer now...
    start https://tailscale.com/download/windows
    echo.
    echo IMPORTANT: After Tailscale installs,
    echo double-click this file again.
    echo.
    pause
    exit /b 1
)

echo Connecting to VenueScope network...
tailscale up --authkey=${AUTHKEY} --hostname=venue-${venueId} --accept-routes

for /f "tokens=*" %%i in ('tailscale ip -4 2^>nul') do set MYIP=%%i

curl -s "${CALLBACK}?ip=%MYIP%&hostname=venue-${venueId}&venue=${venueId}" >nul 2>&1

cls
echo ========================================
echo   ALL DONE -- Cameras connected.
echo ========================================
echo.
echo   Your Tailscale IP: %MYIP%
echo.
echo   Cameras will appear in your dashboard
echo   within 2 minutes.
echo ========================================
echo.
pause
`;
}

function linuxScript(venueId: string): string {
  return `#!/bin/bash
clear
echo "========================================"
echo "  VenueScope Camera Setup"
echo "========================================"
echo ""

if ! command -v tailscale &>/dev/null; then
  echo "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "Connecting to VenueScope network..."
sudo tailscale up --authkey=${AUTHKEY} --hostname=venue-${venueId} --accept-routes 2>/dev/null

MYIP=$(tailscale ip -4 2>/dev/null || echo "unknown")

curl -s "${CALLBACK}?ip=$MYIP&hostname=venue-${venueId}&venue=${venueId}" >/dev/null 2>&1 || true

clear
echo "========================================"
echo "  ALL DONE — Cameras connected."
echo "  Your IP: $MYIP"
echo "========================================"
`;
}

class ConnectService {

  private get serverUrl(): string {
    const base = import.meta.env.VITE_VENUESCOPE_URL || '';
    return base.replace(':8501', ':8502').replace(/\/$/, '');
  }

  /**
   * Detect the browser's OS and return the right { script, filename, ext }.
   */
  getInstallerForOS(os: VenueOS): { script: string; filename: string; mime: string } {
    const venueId = authService.getStoredUser()?.venueId || 'venue';
    switch (os) {
      case 'windows':
        return {
          script:   windowsScript(venueId),
          filename: 'connect-venuescope.bat',
          mime:     'application/x-bat',
        };
      case 'linux':
        return {
          script:   linuxScript(venueId),
          filename: 'connect-venuescope.sh',
          mime:     'application/x-sh',
        };
      case 'mac':
      default:
        return {
          script:   macScript(venueId),
          filename: 'connect-venuescope.command', // .command = double-click opens Terminal on Mac
          mime:     'application/x-sh',
        };
    }
  }

  /**
   * Download the setup script for the given OS.
   * Double-clicking the downloaded file auto-runs it on all platforms.
   */
  downloadInstaller(os?: VenueOS): void {
    const target = os ?? detectOS();
    const { script, filename, mime } = this.getInstallerForOS(target);
    const blob = new Blob([script], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async getStatus(): Promise<ConnectStatus | null> {
    const now = Date.now();
    if (_lastStatus && now - _lastFetch < CACHE_TTL) return _lastStatus;
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
          isOnline:  true,
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

  watchStatus(callback: (status: ConnectStatus | null) => void): () => void {
    let active = true;
    const poll = async () => {
      if (!active) return;
      callback(await this.getStatus());
    };
    poll();
    const interval = setInterval(poll, 15_000);
    return () => { active = false; clearInterval(interval); };
  }

  async isServerReachable(): Promise<boolean> {
    if (!this.serverUrl) return false;
    try {
      const res = await fetch(`${this.serverUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch { return false; }
  }

  clearCache(): void {
    _lastStatus = null;
    _lastFetch  = 0;
  }
}

function _parseLocation(text: string): string {
  const match = text.match(/from\s+(\S+)/i);
  return match ? match[1] : 'Venue';
}

export default new ConnectService();
