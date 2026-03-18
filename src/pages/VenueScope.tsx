/**
 * VenueScope - CCTV Analytics Engine
 * Embeds the Streamlit app in an iframe.
 * Set VITE_VENUESCOPE_URL in environment variables to point to your server.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Video, Monitor, Server, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';

const RAW_URL = import.meta.env.VITE_VENUESCOPE_URL || '';
const IS_CONFIGURED = RAW_URL !== '' && !RAW_URL.includes('localhost') && !RAW_URL.includes('127.0.0.1');
const VENUESCOPE_URL = RAW_URL || 'http://localhost:8501';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

// ── Not configured ────────────────────────────────────────────────────────────

function SetupGuide() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full"
      >
        <div className="bg-whoop-panel border border-whoop-divider rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal/10 border border-teal/20 flex items-center justify-center">
              <Video className="w-5 h-5 text-teal" />
            </div>
            <div>
              <h2 className="text-white font-semibold">VenueScope Setup Required</h2>
              <p className="text-xs text-text-muted">Connect your analytics engine</p>
            </div>
          </div>

          <p className="text-sm text-text-secondary">
            VenueScope runs on a dedicated server that processes your CCTV footage. Follow these steps to connect it.
          </p>

          <div className="space-y-3">
            {[
              { step: '1', title: 'Deploy the server', desc: 'Run the VenueScope Python engine on an EC2 instance or any server. See venuescope/README.md for instructions.' },
              { step: '2', title: 'Set the URL', desc: 'Add VITE_VENUESCOPE_URL=http://your-server-ip:8501 to your Amplify environment variables.' },
              { step: '3', title: 'Redeploy', desc: 'Trigger a new Amplify build. The VenueScope tab will connect automatically.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-teal/20 text-teal text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {step}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="text-xs text-text-muted mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-whoop-divider">
            <p className="text-xs text-text-muted">
              Need help? See <span className="text-teal">venuescope/README.md</span> in the repo.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Mobile wall ───────────────────────────────────────────────────────────────

function MobileWall() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xs w-full text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-whoop-panel border border-whoop-divider flex items-center justify-center mx-auto mb-4">
          <Monitor className="w-7 h-7 text-text-muted" />
        </div>
        <h2 className="text-white font-semibold mb-2">Open on Desktop</h2>
        <p className="text-sm text-text-secondary">
          VenueScope requires a larger screen to upload footage and review analysis results.
        </p>
        <a
          href={VENUESCOPE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 bg-teal/10 border border-teal/30 text-teal text-sm font-medium rounded-xl"
        >
          <ExternalLink className="w-4 h-4" />
          Open directly
        </a>
      </motion.div>
    </div>
  );
}

// ── Server offline ────────────────────────────────────────────────────────────

function ServerOffline({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xs w-full text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
          <Server className="w-7 h-7 text-red-400" />
        </div>
        <h2 className="text-white font-semibold mb-2">Server Unreachable</h2>
        <p className="text-sm text-text-secondary mb-1">
          The VenueScope server at
        </p>
        <p className="text-xs font-mono text-teal bg-teal/10 rounded px-2 py-1 inline-block mb-4 break-all">
          {VENUESCOPE_URL}
        </p>
        <p className="text-sm text-text-secondary mb-5">
          is not responding. Make sure the server is running and the URL is correct.
        </p>
        <motion.button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-whoop-panel border border-whoop-divider text-white text-sm font-medium rounded-xl hover:border-teal/40 transition-colors"
          whileTap={{ scale: 0.97 }}
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </motion.button>
      </motion.div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function VenueScope() {
  const isMobile = useIsMobile();
  const [iframeKey, setIframeKey] = useState(0);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    setStatus('loading');
    // Give the iframe 12 seconds to load before showing error
    const timer = setTimeout(() => {
      setStatus(prev => prev === 'loading' ? 'error' : prev);
    }, 12000);
    return () => clearTimeout(timer);
  }, [iframeKey]);

  const handleRetry = () => {
    setIframeKey(k => k + 1);
    setStatus('loading');
  };

  if (!IS_CONFIGURED) return <SetupGuide />;
  if (isMobile) return <MobileWall />;
  if (status === 'error') return <ServerOffline onRetry={handleRetry} />;

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-6">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-whoop-panel border-b border-whoop-divider lg:px-8">
        <div className="flex items-center gap-3">
          <Video className="w-5 h-5 text-teal flex-shrink-0" />
          <div>
            <h1 className="text-sm font-semibold text-white">VenueScope Analytics</h1>
            <p className="text-xs text-text-muted">CCTV drink counting · People tracking · Theft detection</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status === 'loading' && (
            <div className="flex items-center gap-1.5 text-xs text-text-muted">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Connecting...
            </div>
          )}
          {status === 'loaded' && (
            <div className="flex items-center gap-1.5 text-xs text-teal">
              <div className="w-1.5 h-1.5 rounded-full bg-teal" />
              Connected
            </div>
          )}
          <a
            href={VENUESCOPE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-white transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open full screen
          </a>
        </div>
      </div>

      {/* Iframe */}
      <iframe
        key={iframeKey}
        src={VENUESCOPE_URL}
        title="VenueScope Analytics Engine"
        className="w-full border-0"
        style={{ height: 'calc(100vh - 112px)' }}
        allow="camera; microphone"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </div>
  );
}

export default VenueScope;
