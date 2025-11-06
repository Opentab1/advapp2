import { motion } from 'framer-motion';
import { X, Download, Copy, Mail, CheckCircle, FileCode } from 'lucide-react';
import { useState } from 'react';

interface RPiConfigGeneratorProps {
  onClose: () => void;
  venueId: string;
  venueName: string;
  locationId: string;
  locationName: string;
  deviceId: string;
  mqttTopic: string;
}

export function RPiConfigGenerator({ 
  onClose, 
  venueId, 
  venueName,
  locationId,
  locationName,
  deviceId,
  mqttTopic
}: RPiConfigGeneratorProps) {
  const [copied, setCopied] = useState(false);

  const config = {
    venueId,
    venueName,
    locationId,
    locationName,
    deviceId,
    mqttTopic,
    iotEndpoint: 'a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com',
    region: 'us-east-2',
    features: {
      songDetection: true,
      occupancyTracking: true,
      temperatureSensor: true,
      humiditySensor: true,
      lightSensor: true,
      soundSensor: true
    },
    updateInterval: 5,
    version: '2.1.3'
  };

  const configJSON = JSON.stringify(config, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(configJSON);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([configJSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-config-${venueId}-${deviceId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleEmail = () => {
    alert('Email functionality will be wired to AWS SES');
    // TODO: Wire to AWS SES to send config via email
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        className="bg-gray-900 border border-cyan-500/30 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-600/20 to-purple-600/20 border-b border-cyan-500/30 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileCode className="w-8 h-8 text-cyan-400" />
            <div>
              <h2 className="text-2xl font-bold text-white">Raspberry Pi Configuration</h2>
              <p className="text-gray-400 text-sm">{venueName} - {locationName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded transition-colors">
            <X className="w-6 h-6 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-white mb-3">Configuration File Preview</h3>
            <div className="relative">
              <pre className="bg-black/50 border border-cyan-500/20 rounded-lg p-4 overflow-x-auto text-sm text-gray-300 font-mono">
                {configJSON}
              </pre>
              <button
                onClick={handleCopy}
                className={`absolute top-3 right-3 px-3 py-1.5 rounded text-xs font-medium transition-all ${
                  copied 
                    ? 'bg-green-500/20 text-green-400 border border-green-500/50' 
                    : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                }`}
              >
                {copied ? (
                  <>
                    <CheckCircle className="w-3 h-3 inline mr-1" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 inline mr-1" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Installation Instructions */}
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-6">
            <h4 className="text-white font-semibold mb-3">Installation Instructions:</h4>
            <ol className="text-sm text-gray-300 space-y-2 list-decimal ml-4">
              <li>Copy the configuration file to your Raspberry Pi at <code className="px-1.5 py-0.5 bg-black/30 rounded text-cyan-400">/home/pi/pulse/config.json</code></li>
              <li>Run: <code className="px-1.5 py-0.5 bg-black/30 rounded text-cyan-400">sudo systemctl restart pulse-sensor</code></li>
              <li>Verify data appears in dashboard within 5 minutes</li>
              <li>Check device status in Devices Management page</li>
            </ol>
          </div>

          {/* Important Notes */}
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <h4 className="text-yellow-400 font-semibold mb-2">⚠️ Important:</h4>
            <ul className="text-sm text-gray-300 space-y-1 list-disc ml-4">
              <li>Keep this configuration file secure</li>
              <li>Do not share the deviceId or MQTT topic</li>
              <li>Each device must have a unique deviceId</li>
              <li>Backup this configuration before making changes</li>
            </ul>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-white/10 p-6 flex gap-3">
          <button
            onClick={handleDownload}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download config.json
          </button>
          <button
            onClick={handleCopy}
            className="btn-secondary flex-1 flex items-center justify-center gap-2"
          >
            <Copy className="w-4 h-4" />
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button
            onClick={handleEmail}
            className="btn-secondary flex-1 flex items-center justify-center gap-2"
          >
            <Mail className="w-4 h-4" />
            Email Config
          </button>
        </div>
      </motion.div>
    </div>
  );
}
