import { motion } from 'framer-motion';
import { 
  Mail, 
  Phone, 
  MessageCircle, 
  FileText, 
  Video, 
  HelpCircle,
  CheckCircle,
  AlertTriangle,
  Clock,
  ExternalLink
} from 'lucide-react';

export function Support() {
  // TODO: Replace with real device status from API
  const devices = [
    { id: 'mainfloor', name: 'Main Floor', status: 'online', lastSeen: '30 seconds ago' },
    { id: 'upstairs', name: 'Upstairs', status: 'online', lastSeen: '25 seconds ago' },
    { id: 'patio', name: 'Patio', status: 'offline', lastSeen: '2 hours ago' },
  ];

  const quickLinks = [
    { title: 'Getting Started Guide', icon: FileText, url: '#' },
    { title: 'Understanding Your Dashboard', icon: FileText, url: '#' },
    { title: 'Sensor Troubleshooting', icon: AlertTriangle, url: '#' },
    { title: 'AI Features Explained', icon: HelpCircle, url: '#' },
    { title: 'Frequently Asked Questions', icon: HelpCircle, url: '#' },
    { title: 'Video Tutorials', icon: Video, url: '#' },
  ];

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold gradient-text mb-2">📞 Support & Help Center</h1>
        <p className="text-gray-400 mb-8">Need help? We're here for you!</p>
      </motion.div>

      {/* Contact Methods */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <motion.div
          className="glass-card p-6 hover:border-purple-500/50 transition-all cursor-pointer"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          whileHover={{ scale: 1.02 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-purple-500/20">
              <Mail className="w-6 h-6 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Email Support</h2>
          </div>
          <p className="text-gray-400 mb-4">
            <a href="mailto:support@advizia.com" className="text-purple-400 hover:text-purple-300">
              support@advizia.com
            </a>
          </p>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Clock className="w-4 h-4" />
            <span>Response within 4 hours (business days)</span>
          </div>
          <button className="btn-primary w-full mt-4">
            Send Email
          </button>
        </motion.div>

        <motion.div
          className="glass-card p-6 hover:border-cyan-500/50 transition-all cursor-pointer"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          whileHover={{ scale: 1.02 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-cyan-500/20">
              <Phone className="w-6 h-6 text-cyan-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Phone Support</h2>
          </div>
          <p className="text-gray-400 mb-4">
            <a href="tel:1-800-000-0000" className="text-cyan-400 hover:text-cyan-300">
              1-800-XXX-XXXX
            </a>
          </p>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Clock className="w-4 h-4" />
            <span>Mon-Fri 9 AM - 6 PM EST</span>
          </div>
          <button className="btn-secondary w-full mt-4">
            Call Now
          </button>
        </motion.div>

        <motion.div
          className="glass-card p-6 hover:border-green-500/50 transition-all cursor-pointer opacity-60"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-green-500/20">
              <MessageCircle className="w-6 h-6 text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Live Chat</h2>
          </div>
          <p className="text-gray-400 mb-4">
            Instant support during business hours
          </p>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="px-2 py-1 rounded bg-yellow-500/20 text-yellow-400 text-xs">
              Coming Soon
            </span>
          </div>
          <button className="btn-secondary w-full mt-4" disabled>
            Start Chat
          </button>
        </motion.div>
      </div>

      {/* Quick Links */}
      <motion.div
        className="glass-card p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <FileText className="w-6 h-6 text-purple-400" />
          Quick Links
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickLinks.map((link, index) => (
            <motion.a
              key={index}
              href={link.url}
              className="glass-card p-4 hover:border-purple-500/50 transition-all flex items-center gap-3 group"
              whileHover={{ scale: 1.02 }}
            >
              <link.icon className="w-5 h-5 text-purple-400" />
              <span className="text-white group-hover:text-purple-300 transition-colors flex-1">
                {link.title}
              </span>
              <ExternalLink className="w-4 h-4 text-gray-600 group-hover:text-purple-400 transition-colors" />
            </motion.a>
          ))}
        </div>
      </motion.div>

      {/* System Status */}
      <motion.div
        className="glass-card p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6">🔧 System Status</h2>
        
        <div className="space-y-4 mb-6">
          <h3 className="text-lg font-semibold text-gray-300">Sensor Status:</h3>
          {devices.map((device) => (
            <div key={device.id} className="glass-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${device.status === 'online' ? 'bg-green-400' : 'bg-red-400'}`} />
                  <div>
                    <div className="text-white font-semibold">{device.name}</div>
                    <div className="text-sm text-gray-400">
                      {device.status === 'online' ? '✅ Online' : '⚠️ Offline'} · Last seen: {device.lastSeen}
                    </div>
                  </div>
                </div>
                {device.status === 'offline' && (
                  <div className="flex gap-2">
                    <button className="btn-secondary text-sm">Troubleshoot</button>
                    <button className="btn-primary text-sm">Contact Support</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-white font-semibold">Data Syncing</span>
            </div>
            <p className="text-sm text-gray-400">✅ Normal</p>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-white font-semibold">Cloud Services</span>
            </div>
            <p className="text-sm text-gray-400">✅ Operational</p>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-white font-semibold">AI Processing</span>
            </div>
            <p className="text-sm text-gray-400">✅ Running</p>
          </div>
        </div>
      </motion.div>

      {/* Training Resources */}
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <Video className="w-6 h-6 text-cyan-400" />
          Training Resources
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="glass-card p-4">
            <h3 className="text-white font-semibold mb-2">Onboarding Webinar</h3>
            <p className="text-sm text-gray-400 mb-3">Next session: Nov 10, 2 PM EST</p>
            <button className="btn-secondary text-sm">Register</button>
          </div>
          <div className="glass-card p-4">
            <h3 className="text-white font-semibold mb-2">Advanced Features Workshop</h3>
            <p className="text-sm text-gray-400 mb-3">Learn AI insights and optimization</p>
            <button className="btn-secondary text-sm">View Schedule</button>
          </div>
          <div className="glass-card p-4">
            <h3 className="text-white font-semibold mb-2">Best Practices Guide</h3>
            <p className="text-sm text-gray-400 mb-3">Maximize your Pulse Score</p>
            <button className="btn-secondary text-sm">Download PDF</button>
          </div>
          <div className="glass-card p-4">
            <h3 className="text-white font-semibold mb-2">Case Studies</h3>
            <p className="text-sm text-gray-400 mb-3">See how other venues succeed</p>
            <button className="btn-secondary text-sm">Read Stories</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
