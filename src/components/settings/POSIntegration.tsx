import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  CreditCard, Link2, CheckCircle, AlertCircle,
  RefreshCw, Zap, Eye, EyeOff, ExternalLink, Trash2
} from 'lucide-react';
import authService from '../../services/auth.service';

// API endpoint for POS connections
const POS_API = 'https://4unsp74svc.execute-api.us-east-2.amazonaws.com/prod/pos';

interface POSProvider {
  id: string;
  name: string;
  logo: string;
  description: string;
  tokenInstructions: string[];
  tokenUrl: string;
  placeholder: string;
}

const POS_PROVIDERS: POSProvider[] = [
  {
    id: 'square',
    name: 'Square',
    logo: '⬜',
    description: 'Connect Square to see hourly revenue, transaction counts, and average ticket size.',
    tokenInstructions: [
      'Go to developer.squareup.com and sign in with your Square account',
      'Click on your application (or create one)',
      'Go to Credentials → Production Access Token',
      'Copy the token and paste it below'
    ],
    tokenUrl: 'https://developer.squareup.com/apps',
    placeholder: 'EAAAl...'
  },
  {
    id: 'toast',
    name: 'Toast',
    logo: '🍞',
    description: 'Connect Toast to sync restaurant sales, tips, and labor data.',
    tokenInstructions: [
      'Log into Toast Web (toasttab.com)',
      'Go to Settings → API Access',
      'Generate a new API key',
      'Copy both Client ID and Client Secret'
    ],
    tokenUrl: 'https://www.toasttab.com/restaurants/admin',
    placeholder: 'Enter your Toast API key'
  },
  {
    id: 'clover',
    name: 'Clover',
    logo: '🍀',
    description: 'Connect Clover POS for payment and sales analytics.',
    tokenInstructions: [
      'Log into your Clover Dashboard',
      'Go to Settings → API Tokens',
      'Create a new token with "Read Payments" permission',
      'Copy the token and paste it below'
    ],
    tokenUrl: 'https://www.clover.com/dashboard',
    placeholder: 'Enter your Clover API token'
  }
];

interface POSConnection {
  provider: string;
  connected: boolean;
  lastSync?: string;
  status: 'active' | 'error' | 'syncing';
  error?: string;
}

export function POSIntegration() {
  const [connections, setConnections] = useState<Record<string, POSConnection>>({});
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const user = authService.getStoredUser();
  const venueId = user?.venueId;

  useEffect(() => {
    loadConnections();
  }, [venueId]);

  const loadConnections = async () => {
    if (!venueId) return;
    setLoading(true);
    
    try {
      const response = await fetch(`${POS_API}/${venueId}`);
      if (response.ok) {
        const data = await response.json();
        // Convert array to record
        const connectionsMap: Record<string, POSConnection> = {};
        data.forEach((conn: { provider: string; lastSync?: string; status: string; error?: string }) => {
          connectionsMap[conn.provider] = {
            provider: conn.provider,
            connected: true,
            lastSync: conn.lastSync,
            status: conn.status as 'active' | 'error' | 'syncing',
            error: conn.error
          };
        });
        setConnections(connectionsMap);
      }
    } catch (err) {
      console.error('Error loading POS connections:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (providerId: string) => {
    if (!venueId || !tokenInput.trim()) return;
    
    setSaving(true);
    setError(null);
    
    try {
      const response = await fetch(`${POS_API}/${venueId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          token: tokenInput.trim()
        })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to connect');
      }
      
      setSelectedProvider(null);
      setTokenInput('');
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (providerId: string) => {
    if (!venueId) return;
    if (!confirm(`Disconnect ${providerId}? Historical data will be preserved.`)) return;
    
    try {
      await fetch(`${POS_API}/${venueId}/${providerId}`, {
        method: 'DELETE'
      });
      
      const updated = { ...connections };
      delete updated[providerId];
      setConnections(updated);
    } catch (err) {
      console.error('Error disconnecting:', err);
    }
  };

  const getProvider = (id: string) => POS_PROVIDERS.find(p => p.id === id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <CreditCard className="w-6 h-6 text-primary" />
        <div>
          <h3 className="text-lg font-semibold text-white">POS Integration</h3>
          <p className="text-sm text-warm-400">Connect your point of sale for revenue analytics</p>
        </div>
      </div>

      {/* Benefits Banner */}
      {Object.keys(connections).length === 0 && (
        <div className="glass-card p-4 border-l-4 border-primary">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-white">What you'll see with POS connected</h4>
              <ul className="text-sm text-warm-400 mt-2 space-y-1">
                <li>• <strong className="text-white">Hourly revenue</strong> correlated with crowd size</li>
                <li>• <strong className="text-white">Revenue per staff member</strong> during their shifts</li>
                <li>• <strong className="text-white">Event ROI</strong> in actual dollars</li>
                <li>• <strong className="text-white">Music impact</strong> on spending</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {POS_PROVIDERS.map((provider) => {
            const connection = connections[provider.id];
            const isConnected = !!connection;
            const isSelected = selectedProvider === provider.id;
            
            return (
              <motion.div
                key={provider.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`glass-card p-4 transition-all ${
                  isConnected ? 'border border-emerald-500/30 bg-emerald-500/5' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-warm-800 flex items-center justify-center text-2xl">
                      {provider.logo}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{provider.name}</span>
                        {isConnected && (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>
                      <div className="text-xs text-warm-400 mt-0.5 max-w-md">
                        {isConnected 
                          ? `Connected • Last sync: ${connection.lastSync ? new Date(connection.lastSync).toLocaleString() : 'Never'}`
                          : provider.description
                        }
                      </div>
                    </div>
                  </div>
                  
                  {isConnected ? (
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded ${
                        connection.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                        connection.status === 'error' ? 'bg-red-500/20 text-red-400' :
                        'bg-amber-500/20 text-amber-400'
                      }`}>
                        {connection.status === 'active' ? 'Active' :
                         connection.status === 'error' ? 'Error' : 'Syncing'}
                      </span>
                      <button
                        onClick={() => handleDisconnect(provider.id)}
                        className="text-warm-500 hover:text-red-400 transition-colors p-2"
                        title="Disconnect"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <motion.button
                      onClick={() => setSelectedProvider(isSelected ? null : provider.id)}
                      className="btn-primary text-sm flex items-center gap-2"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Link2 className="w-4 h-4" />
                      {isSelected ? 'Cancel' : 'Connect'}
                    </motion.button>
                  )}
                </div>

                {/* Token Input Section */}
                {isSelected && !isConnected && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 pt-4 border-t border-warm-700"
                  >
                    <h4 className="font-medium text-white mb-3">How to get your API token:</h4>
                    <ol className="text-sm text-warm-400 space-y-2 mb-4">
                      {provider.tokenInstructions.map((instruction, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-primary font-bold">{i + 1}.</span>
                          {instruction}
                        </li>
                      ))}
                    </ol>
                    
                    <a
                      href={provider.tokenUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-4"
                    >
                      Open {provider.name} Dashboard
                      <ExternalLink className="w-3 h-3" />
                    </a>

                    <div className="space-y-3">
                      <div className="relative">
                        <input
                          type={showToken ? 'text' : 'password'}
                          value={tokenInput}
                          onChange={(e) => setTokenInput(e.target.value)}
                          placeholder={provider.placeholder}
                          className="w-full bg-warm-800 rounded-lg px-4 py-3 pr-12 text-white placeholder-warm-500 focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken(!showToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-500 hover:text-white"
                        >
                          {showToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>

                      {error && (
                        <div className="flex items-center gap-2 text-sm text-red-400">
                          <AlertCircle className="w-4 h-4" />
                          {error}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedProvider(null);
                            setTokenInput('');
                            setError(null);
                          }}
                          className="btn-secondary flex-1"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleConnect(provider.id)}
                          disabled={!tokenInput.trim() || saving}
                          className="btn-primary flex-1 flex items-center justify-center gap-2"
                        >
                          {saving ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-4 h-4" />
                              Save & Connect
                            </>
                          )}
                        </button>
                      </div>

                      <p className="text-xs text-warm-500 text-center">
                        Your token is encrypted and stored securely. We only read sales data.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* Error display for connected but errored */}
                {isConnected && connection.status === 'error' && connection.error && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-sm text-red-400">{connection.error}</span>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Security Note */}
      <div className="text-center pt-4 border-t border-warm-800">
        <p className="text-xs text-warm-500">
          🔒 Tokens are encrypted with AES-256 and stored in AWS Secrets Manager
        </p>
      </div>
    </div>
  );
}

export default POSIntegration;
