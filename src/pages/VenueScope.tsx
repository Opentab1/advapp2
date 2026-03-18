/**
 * VenueScope - CCTV Analytics Engine
 *
 * Embeds the Streamlit app in an iframe.
 * Also shows a live summary card pulled from the VenueScope REST API.
 * Set VITE_VENUESCOPE_URL in environment variables to point to your server.
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Video, Monitor, Server, ExternalLink, RefreshCw,
  AlertTriangle, ShieldCheck, TrendingUp, BarChart3,
} from 'lucide-react';
import venueScopeService, { VenueScopeLatestSummary } from '../services/venuescope.service';

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

function useIframeHeight() {
  const [height, setHeight] = useState('calc(100vh - 112px)');
  useEffect(() => {
    const update = () => {
      // Header ~56px + top/bottom content padding ~56px = 112px
      // On very short screens floor at 400px
      const h = Math.max(window.innerHeight - 112, 400);
      setHeight(`${h}px`);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return height;
}

// ── Not configured ─────────────────────────────────────────────────────────

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

// ── Mobile wall ────────────────────────────────────────────────────────────

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
        <p className="text-sm text-text-secondary mb-5">
          VenueScope requires a larger screen to upload footage and review analysis results.
        </p>
        <a
          href={VENUESCOPE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal/10 border border-teal/30 text-teal text-sm font-medium rounded-xl"
        >
          <ExternalLink className="w-4 h-4" />
          Open directly
        </a>
      </motion.div>
    </div>
  );
}

// ── Server offline ─────────────────────────────────────────────────────────

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

// ── Quick stats sidebar ────────────────────────────────────────────────────

function QuickStatsSidebar({ summary }: { summary: VenueScopeLatestSummary | null }) {
  if (!summary) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-56 flex-shrink-0 flex flex-col gap-3 p-3 bg-whoop-panel border-l border-whoop-divider overflow-y-auto"
    >
      <div>
        <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Last Analysis</p>
        <p className="text-xs text-warm-300 truncate">{summary.clip_label || summary.job_id}</p>
      </div>

      <div className="space-y-2">
        <div className="bg-whoop-bg rounded-xl p-3 text-center">
          <div className="text-3xl font-bold text-teal">{summary.total_drinks}</div>
          <div className="text-[10px] text-text-muted uppercase tracking-wide mt-0.5">Drinks Made</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-whoop-bg rounded-xl p-2 text-center">
            <div className="text-lg font-bold text-white">{summary.drinks_per_hour.toFixed(0)}</div>
            <div className="text-[9px] text-text-muted uppercase">/hr</div>
          </div>
          <div className="bg-whoop-bg rounded-xl p-2 text-center flex flex-col items-center justify-center">
            {summary.has_theft_flag ? (
              <>
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <div className="text-[9px] text-red-400 mt-0.5">Review</div>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <div className="text-[9px] text-emerald-400 mt-0.5">Clean</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-whoop-divider pt-2">
        <div className="flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-[10px] text-text-muted">Confidence</span>
        </div>
        <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
          summary.confidence_color === 'green' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
          summary.confidence_color === 'red'   ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                                                  'bg-amber-500/20 text-amber-400 border-amber-500/30'
        }`}>
          {summary.confidence_label}
        </span>
      </div>

      <a
        href={VENUESCOPE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto flex items-center gap-1.5 text-[10px] text-text-muted hover:text-teal transition-colors"
      >
        <TrendingUp className="w-3 h-3" />
        Full analysis
        <ExternalLink className="w-3 h-3 ml-auto" />
      </a>
    </motion.div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function VenueScope() {
  const isMobile = useIsMobile();
  const iframeHeight = useIframeHeight();
  const [iframeKey, setIframeKey] = useState(0);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [latestSummary, setLatestSummary] = useState<VenueScopeLatestSummary | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setStatus('loading');
    timerRef.current = setTimeout(() => {
      setStatus(prev => prev === 'loading' ? 'error' : prev);
    }, 15000);
    return () => clearTimeout(timerRef.current);
  }, [iframeKey]);

  // Fetch quick stats from REST API when configured
  useEffect(() => {
    if (!IS_CONFIGURED) return;
    venueScopeService.getLatestSummary().then(s => {
      if (s) setLatestSummary(s);
    });
  }, []);

  const handleRetry = () => {
    setIframeKey(k => k + 1);
    setStatus('loading');
  };

  if (!IS_CONFIGURED) return <SetupGuide />;
  if (isMobile) return <MobileWall />;
  if (status === 'error') return <ServerOffline onRetry={handleRetry} />;

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-6 flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-whoop-panel border-b border-whoop-divider lg:px-8 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Video className="w-5 h-5 text-teal flex-shrink-0" />
          <div>
            <h1 className="text-sm font-semibold text-white">VenueScope Analytics</h1>
            <p className="text-xs text-text-muted">CCTV drink counting · People tracking · Theft detection</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AnimatePresence mode="wait">
            {status === 'loading' && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-xs text-text-muted"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Connecting...
              </motion.div>
            )}
            {status === 'loaded' && (
              <motion.div
                key="loaded"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-xs text-teal"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
                Connected
              </motion.div>
            )}
          </AnimatePresence>
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

      {/* Body: iframe + optional quick stats sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Iframe */}
        <iframe
          key={iframeKey}
          src={VENUESCOPE_URL}
          title="VenueScope Analytics Engine"
          className="flex-1 border-0"
          style={{ height: iframeHeight }}
          allow="camera; microphone"
          onLoad={() => {
            clearTimeout(timerRef.current);
            setStatus('loaded');
          }}
          onError={() => setStatus('error')}
        />

        {/* Quick stats sidebar — only on xl screens when we have data */}
        {latestSummary && status === 'loaded' && (
          <div className="hidden xl:block">
            <QuickStatsSidebar summary={latestSummary} />
          </div>
        )}
      </div>
    </div>
  );
}

export default VenueScope;
