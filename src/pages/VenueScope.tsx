/**
 * VenueScope - CCTV Analytics Engine
 * Embeds the Streamlit app in an iframe for quick integration.
 * Set VITE_VENUESCOPE_URL in .env to point to your VenueScope server.
 */

import { Video } from 'lucide-react';

const VENUESCOPE_URL = import.meta.env.VITE_VENUESCOPE_URL || 'http://localhost:8501';

export function VenueScope() {
  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-6">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-whoop-panel border-b border-whoop-divider lg:px-8">
        <Video className="w-5 h-5 text-teal flex-shrink-0" />
        <div>
          <h1 className="text-sm font-semibold text-white">VenueScope Analytics</h1>
          <p className="text-xs text-text-muted">CCTV drink counting · People tracking · Theft detection</p>
        </div>
      </div>

      {/* Iframe */}
      <iframe
        src={VENUESCOPE_URL}
        title="VenueScope Analytics Engine"
        className="w-full border-0"
        style={{ height: 'calc(100vh - 112px)' }}
        allow="camera; microphone"
      />
    </div>
  );
}

export default VenueScope;
