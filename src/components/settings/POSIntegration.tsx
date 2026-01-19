import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  CreditCard, Link2, CheckCircle,
  RefreshCw, Zap
} from 'lucide-react';

interface POSProvider {
  id: string;
  name: string;
  logo: string;
  description: string;
  status: 'available' | 'coming_soon' | 'connected';
  popular?: boolean;
}

const POS_PROVIDERS: POSProvider[] = [
  {
    id: 'square',
    name: 'Square',
    logo: '⬜',
    description: 'Connect Square POS to see revenue per hour, avg tab size, and sales correlation',
    status: 'available',
    popular: true
  },
  {
    id: 'toast',
    name: 'Toast',
    logo: '🍞',
    description: 'Sync Toast data for restaurant-specific analytics and revenue tracking',
    status: 'available',
    popular: true
  },
  {
    id: 'clover',
    name: 'Clover',
    logo: '🍀',
    description: 'Integrate Clover POS for complete sales and payment analytics',
    status: 'coming_soon'
  },
  {
    id: 'lightspeed',
    name: 'Lightspeed',
    logo: '⚡',
    description: 'Connect Lightspeed for inventory and sales correlation',
    status: 'coming_soon'
  },
  {
    id: 'touchbistro',
    name: 'TouchBistro',
    logo: '👆',
    description: 'Restaurant POS integration for table and sales analytics',
    status: 'coming_soon'
  },
  {
    id: 'revel',
    name: 'Revel Systems',
    logo: '🎉',
    description: 'Enterprise POS integration for multi-location analytics',
    status: 'coming_soon'
  }
];

interface ConnectedPOS {
  providerId: string;
  connectedAt: string;
  lastSync?: string;
  status: 'active' | 'error' | 'syncing';
}

export function POSIntegration() {
  const [connectedPOS, setConnectedPOS] = useState<ConnectedPOS | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  const handleConnect = async (providerId: string) => {
    setConnecting(providerId);
    
    // Simulate OAuth flow
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setConnectedPOS({
      providerId,
      connectedAt: new Date().toISOString(),
      status: 'active'
    });
    
    setConnecting(null);
  };

  const handleDisconnect = () => {
    if (confirm('Disconnect POS integration? Historical data will be preserved.')) {
      setConnectedPOS(null);
    }
  };

  const connectedProvider = connectedPOS 
    ? POS_PROVIDERS.find(p => p.id === connectedPOS.providerId) 
    : null;

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

      {/* Connected POS */}
      {connectedPOS && connectedProvider && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4 border border-emerald-500/30 bg-emerald-500/5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-warm-800 flex items-center justify-center text-2xl">
                {connectedProvider.logo}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{connectedProvider.name}</span>
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-sm text-warm-400">
                  Connected {new Date(connectedPOS.connectedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="flex items-center gap-1 text-sm text-emerald-400">
                  <RefreshCw className="w-3 h-3" />
                  Syncing
                </div>
                <div className="text-xs text-warm-500">Every 15 min</div>
              </div>
              <button
                onClick={handleDisconnect}
                className="text-sm text-warm-400 hover:text-red-400 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
          
          {/* What's syncing */}
          <div className="mt-4 pt-4 border-t border-emerald-500/20 grid grid-cols-3 gap-4">
            {[
              { label: 'Hourly Revenue', status: 'active' },
              { label: 'Avg Tab Size', status: 'active' },
              { label: 'Payment Types', status: 'active' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                <span className="text-sm text-warm-300">{item.label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Benefits Banner */}
      {!connectedPOS && (
        <div className="glass-card p-4 border-l-4 border-primary">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-white">Why connect your POS?</h4>
              <ul className="text-sm text-warm-400 mt-2 space-y-1">
                <li>• See <strong className="text-white">revenue per hour</strong> correlated with crowd size</li>
                <li>• Track <strong className="text-white">avg tab size</strong> by day, time, and music genre</li>
                <li>• Discover <strong className="text-white">which songs = higher spending</strong></li>
                <li>• Get <strong className="text-white">staffing ROI</strong> based on actual sales</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Available Integrations */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-warm-400">
          {connectedPOS ? 'Other Integrations' : 'Available Integrations'}
        </h4>
        
        {POS_PROVIDERS.filter(p => p.id !== connectedPOS?.providerId).map((provider, i) => {
          const isConnecting = connecting === provider.id;
          const isAvailable = provider.status === 'available';
          
          return (
            <motion.div
              key={provider.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`glass-card p-4 ${isAvailable ? 'hover:bg-warm-800/50' : 'opacity-60'} transition-colors`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-warm-800 flex items-center justify-center text-xl">
                    {provider.logo}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{provider.name}</span>
                      {provider.popular && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary">Popular</span>
                      )}
                    </div>
                    <div className="text-xs text-warm-400 mt-0.5 max-w-md">
                      {provider.description}
                    </div>
                  </div>
                </div>
                
                {isAvailable ? (
                  <motion.button
                    onClick={() => handleConnect(provider.id)}
                    disabled={isConnecting || !!connectedPOS}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      connectedPOS 
                        ? 'bg-warm-700 text-warm-500 cursor-not-allowed'
                        : 'bg-primary/20 text-primary hover:bg-primary/30'
                    }`}
                    whileHover={!connectedPOS ? { scale: 1.02 } : {}}
                    whileTap={!connectedPOS ? { scale: 0.98 } : {}}
                  >
                    {isConnecting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Link2 className="w-4 h-4" />
                        Connect
                      </>
                    )}
                  </motion.button>
                ) : (
                  <span className="text-sm text-warm-500 flex items-center gap-1">
                    Coming Soon
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Request Integration */}
      <div className="text-center pt-4">
        <p className="text-sm text-warm-500">
          Don't see your POS? <a href="mailto:support@advizia.ai" className="text-primary hover:underline">Request an integration</a>
        </p>
      </div>
    </div>
  );
}

export default POSIntegration;
