/**
 * ReputationBreakdownModal - Deep dive into Google Reviews
 * 
 * Shows:
 * - Current rating and review count
 * - What the rating means
 * - Trend over time
 * - How to improve
 */

import { motion } from 'framer-motion';
import { Modal } from '../common/Modal';
import { Star, ExternalLink, MessageSquare, ThumbsUp, AlertTriangle } from 'lucide-react';
import { AnimatedNumber } from '../common/AnimatedNumber';
import type { GoogleReviewsData } from '../../services/google-reviews.service';

interface ReputationBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  reviews: GoogleReviewsData | null;
  venueName: string;
}

export function ReputationBreakdownModal({
  isOpen,
  onClose,
  reviews,
  venueName,
}: ReputationBreakdownModalProps) {
  // No reviews state
  if (!reviews) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Reputation">
        <div className="text-center py-10">
          <div className="w-16 h-16 rounded-full bg-warm-100 dark:bg-warm-700 flex items-center justify-center mx-auto mb-4">
            <Star className="w-8 h-8 text-warm-400 dark:text-warm-500" />
          </div>
          <h3 className="text-lg font-semibold text-warm-700 dark:text-warm-200 mb-2">
            No Review Data
          </h3>
          <p className="text-sm text-warm-500 dark:text-warm-400 max-w-xs mx-auto mb-4">
            Set up your venue address in Settings to pull your Google Reviews automatically.
          </p>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
          >
            Got It
          </button>
        </div>
      </Modal>
    );
  }
  
  // Rating tier configuration
  const getTierConfig = (rating: number) => {
    if (rating >= 4.5) return {
      tier: 'Outstanding',
      emoji: '🌟',
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
      message: 'You\'re in the top tier. This rating attracts new customers.',
      impact: '+15-20% more foot traffic compared to 4.0 venues'
    };
    if (rating >= 4.0) return {
      tier: 'Strong',
      emoji: '✅',
      color: 'text-primary',
      bg: 'bg-primary/10 dark:bg-primary/20 border-primary/20',
      message: 'Solid reputation. Push for 4.5+ to stand out.',
      impact: 'Most customers consider 4.0+ acceptable'
    };
    if (rating >= 3.5) return {
      tier: 'Average',
      emoji: '⚠️',
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
      message: 'Some customers may hesitate. Work on recent reviews.',
      impact: 'Below 4.0 can reduce foot traffic by 10-15%'
    };
    return {
      tier: 'Needs Work',
      emoji: '🚨',
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
      message: 'Low rating is hurting business. Prioritize improvement.',
      impact: 'Many customers skip venues below 3.5 stars'
    };
  };
  
  const tier = getTierConfig(reviews.rating);
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reputation">
      <div className="space-y-6">
        {/* Hero Rating */}
        <div className="text-center py-6 bg-warm-50 dark:bg-warm-700/50 rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-2 mb-3">
            <AnimatedNumber
              value={reviews.rating}
              className="text-5xl font-bold text-warm-800 dark:text-warm-100"
              formatFn={(v) => v.toFixed(1)}
            />
            <Star className="w-10 h-10 text-amber-500 fill-amber-500" />
          </div>
          
          {/* Stars */}
          <div className="flex justify-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className={`w-6 h-6 ${
                  i <= Math.round(reviews.rating) 
                    ? 'text-amber-500 fill-amber-500' 
                    : 'text-warm-300 dark:text-warm-600'
                }`}
              />
            ))}
          </div>
          
          <p className="text-sm text-warm-500 dark:text-warm-400">
            {reviews.reviewCount.toLocaleString()} reviews on Google
          </p>
        </div>
        
        {/* Tier Badge */}
        <div className={`p-4 rounded-xl border ${tier.bg}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{tier.emoji}</span>
            <span className={`font-semibold ${tier.color}`}>{tier.tier}</span>
          </div>
          <p className="text-sm text-warm-700 dark:text-warm-200 mb-2">{tier.message}</p>
          <p className="text-xs text-warm-500 dark:text-warm-400 italic">{tier.impact}</p>
        </div>
        
        {/* How to Improve */}
        <div>
          <h4 className="text-xs font-semibold text-warm-500 dark:text-warm-400 uppercase tracking-wide mb-3">
            How to Improve Your Rating
          </h4>
          <div className="space-y-2">
            <TipCard
              icon={MessageSquare}
              title="Respond to every review"
              desc="Shows you care. Even negative reviews deserve a thoughtful response."
            />
            <TipCard
              icon={ThumbsUp}
              title="Ask happy guests to review"
              desc="Satisfied customers often forget. A simple ask can boost your count."
            />
            <TipCard
              icon={AlertTriangle}
              title="Address common complaints"
              desc="Look for patterns in negative reviews and fix root causes."
            />
          </div>
        </div>
        
        {/* View on Google */}
        <motion.a
          href={reviews.url || `https://www.google.com/maps/search/${encodeURIComponent(venueName)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          whileTap={{ scale: 0.98 }}
        >
          View on Google
          <ExternalLink className="w-4 h-4" />
        </motion.a>
      </div>
    </Modal>
  );
}

// ============ TIP CARD ============

function TipCard({ icon: Icon, title, desc }: { icon: typeof MessageSquare; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-warm-50 dark:bg-warm-700/50">
      <div className="w-8 h-8 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium text-warm-800 dark:text-warm-100">{title}</p>
        <p className="text-xs text-warm-500 dark:text-warm-400 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

export default ReputationBreakdownModal;
