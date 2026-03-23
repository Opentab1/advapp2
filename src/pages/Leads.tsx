import { motion } from 'framer-motion';
import { Users, Smartphone, MapPin, TrendingUp, Clock } from 'lucide-react';

export function Leads() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card max-w-md w-full p-8 text-center"
      >
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-3 py-1 mb-6">
          <Clock className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary uppercase tracking-wide">Coming Soon</span>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-warm-100 mb-2">Leads</h1>
        <p className="text-sm text-warm-400 mb-8">
          Turn your venue's foot traffic into a returnable customer base — automatically.
        </p>

        {/* Feature bullets */}
        <div className="space-y-4 text-left">
          {[
            { icon: Smartphone, title: 'Passive customer capture', desc: 'Identify and log guests who visit your venue without any check-in required.' },
            { icon: Users,      title: 'Guest profiles',          desc: 'Build a database of repeat vs. first-time visitors with visit frequency and recency.' },
            { icon: MapPin,     title: 'Location breakdown',      desc: 'See where your customers are coming from to inform marketing and promotions.' },
            { icon: TrendingUp, title: 'Re-engagement campaigns', desc: 'Automatically reach lapsed guests with targeted offers to bring them back.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-warm-200">{title}</p>
                <p className="text-xs text-warm-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export default Leads;
