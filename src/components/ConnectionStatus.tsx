import { motion } from 'framer-motion';
import { Wifi, WifiOff, Radio } from 'lucide-react';

interface ConnectionStatusProps {
  isConnected: boolean;
  usingIoT: boolean;
  locationName: string;
}

export function ConnectionStatus({ isConnected, usingIoT, locationName }: ConnectionStatusProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10"
    >
      {usingIoT ? (
        <>
          <Radio className="w-4 h-4 text-green-400 animate-pulse" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-green-400">AWS IoT Live</span>
            <span className="text-xs text-gray-400">•</span>
            <span className="text-xs text-gray-400">{locationName}</span>
          </div>
        </>
      ) : isConnected ? (
        <>
          <Wifi className="w-4 h-4 text-yellow-400" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-yellow-400">DynamoDB Polling</span>
            <span className="text-xs text-gray-400">•</span>
            <span className="text-xs text-gray-400">{locationName}</span>
          </div>
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 text-red-400" />
          <span className="text-sm font-medium text-red-400">Disconnected</span>
        </>
      )}
    </motion.div>
  );
}
