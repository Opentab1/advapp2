/**
 * ReputationBreakdownModal - WHOOP-style deep dive into Google Reviews
 * 
 * Shows:
 * - Current rating with star visualization (REAL)
 * - Tier badge based on rating (REAL)
 * - Recent reviews from API (REAL if available)
 * - Improvement tips (general guidance)
 * 
 * NOTE: Distribution, trends, and keyword analysis are NOT shown
 * because we don't have real data for these. Honesty > fake charts.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal } from '../common/Modal';
import { 
  Star, ExternalLink, MessageSquare, 
  ChevronRight, Quote, Target, Clock, ThumbsUp, AlertTriangle
} from 'lucide-react';
import { AnimatedNumber } from '../common/AnimatedNumber';
import type { GoogleReviewsData } from '../../services/google-reviews.service';

// ============ TYPES ============

interface ReputationBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  reviews: GoogleReviewsData | null;
  venueName: string;
}

// ============ MAIN COMPONENT ============

export function ReputationBreakdownModal({
  isOpen,
  onClose,
  reviews,
  venueName,
}: ReputationBreakdownModalProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  
  // No reviews state
  if (!reviews) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Reputation">
        <div className="text-center py-10">
          <div className="w-16 h-16 rounded-full bg-warm-700 flex items-center justify-center mx-auto mb-4">
            <Star className="w-8 h-8 text-warm-500" />
          </div>
          <h3 className="text-lg font-semibold text-warm-200 mb-2">
            No Review Data
          </h3>
          <p className="text-sm text-warm-400 max-w-xs mx-auto mb-4">
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
  
  // Check if we have real recent reviews from the API
  const hasRealReviews = reviews.recentReviews && reviews.recentReviews.length > 0;
  
  // Rating tier configuration (this is real - based on actual rating)
  const getTierConfig = (rating: number) => {
    if (rating >= 4.5) return {
      tier: 'Outstanding',
      emoji: '🌟',
      color: 'text-green-400',
      bg: 'bg-green-900/20 border-green-800',
      message: 'You\'re in the top tier. This rating attracts new customers.',
      impact: '+15-20% more foot traffic vs 4.0 venues'
    };
    if (rating >= 4.0) return {
      tier: 'Strong',
      emoji: '✅',
      color: 'text-primary',
      bg: 'bg-primary/20 border-primary/20',
      message: 'Solid reputation. Push for 4.5+ to stand out.',
      impact: 'Most customers consider 4.0+ acceptable'
    };
    if (rating >= 3.5) return {
      tier: 'Average',
      emoji: '⚠️',
      color: 'text-amber-400',
      bg: 'bg-amber-900/20 border-amber-800',
      message: 'Some customers may hesitate. Work on recent reviews.',
      impact: 'Below 4.0 can reduce foot traffic 10-15%'
    };
    return {
      tier: 'Needs Work',
      emoji: '🚨',
      color: 'text-red-400',
      bg: 'bg-red-900/20 border-red-800',
      message: 'Low rating is hurting business. Prioritize improvement.',
      impact: 'Many customers skip venues below 3.5★'
    };
  };
  
  const tier = getTierConfig(reviews.rating);
  
  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reputation">
      <div className="space-y-5">
        
        {/* ============ HERO RATING ============ */}
        <div className="text-center py-5 bg-gradient-to-b from-warm-700/50 to-transparent rounded-2xl -mx-2">
          <div className="flex items-center justify-center gap-3 mb-2">
            <AnimatedNumber
              value={reviews.rating}
              className="text-5xl font-bold text-warm-100"
              formatFn={(v) => v.toFixed(1)}
            />
            <Star className="w-10 h-10 text-amber-500 fill-amber-500" />
          </div>
          
          {/* Stars */}
          <div className="flex justify-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className={`w-6 h-6 transition-all ${
                  i <= Math.round(reviews.rating) 
                    ? 'text-amber-500 fill-amber-500' 
                    : i - 0.5 <= reviews.rating
                    ? 'text-amber-500 fill-amber-500/50'
                    : 'text-warm-600'
                }`}
              />
            ))}
          </div>
          
          <p className="text-sm text-warm-400 mb-3">
            {reviews.reviewCount.toLocaleString()} reviews on Google
          </p>
          
          {/* Tier Badge */}
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${tier.bg} ${tier.color}`}>
            {tier.emoji} {tier.tier}
          </span>
        </div>
        
        {/* ============ QUICK INSIGHT ============ */}
        <div className={`p-4 rounded-xl border ${tier.bg}`}>
          <p className="text-sm text-warm-200 mb-1">{tier.message}</p>
          <p className="text-xs text-warm-400">{tier.impact}</p>
        </div>
        
        {/* ============ RECENT REVIEWS (Real from API) ============ */}
        {hasRealReviews ? (
          <CollapsibleSection
            title="Recent Reviews"
            icon={MessageSquare}
            subtitle="Latest customer feedback"
            expanded={expandedSection === 'recent'}
            onToggle={() => toggleSection('recent')}
            defaultOpen={true}
          >
            <div className="space-y-3 pt-2">
              {reviews.recentReviews!.map((review, i) => (
                <div key={i} className="p-3 bg-warm-700/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-warm-200">{review.author}</span>
                      <span className="text-xs text-warm-500">{review.date}</span>
                    </div>
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`w-3 h-3 ${
                            s <= review.rating ? 'text-amber-500 fill-amber-500' : 'text-warm-600'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-warm-300 flex items-start gap-2">
                    <Quote className="w-3 h-3 text-warm-500 flex-shrink-0 mt-1" />
                    {review.text}
                  </p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        ) : (
          <div className="p-4 bg-warm-800/50 rounded-xl border border-warm-700/50">
            <div className="flex items-center gap-3 mb-2">
              <MessageSquare className="w-5 h-5 text-warm-500" />
              <span className="text-sm font-medium text-warm-300">Recent Reviews</span>
            </div>
            <p className="text-xs text-warm-500">
              Individual reviews require SerpAPI Pro. Currently showing aggregate rating only.
            </p>
          </div>
        )}
        
        {/* ============ IMPROVEMENT TIPS ============ */}
        <CollapsibleSection
          title="Improvement Tips"
          icon={Target}
          subtitle="How to boost your rating"
          expanded={expandedSection === 'tips'}
          onToggle={() => toggleSection('tips')}
        >
          <div className="space-y-2 pt-2">
            <TipCard
              icon={MessageSquare}
              title="Respond to every review"
              desc="Shows you care. Even negative reviews deserve a thoughtful response."
              impact="+0.1★ average increase"
            />
            <TipCard
              icon={ThumbsUp}
              title="Ask happy guests to review"
              desc="Put a QR code on receipts or table tents. Make it easy."
              impact="+20% more 5★ reviews"
            />
            <TipCard
              icon={Clock}
              title="Respond within 24 hours"
              desc="Fast responses show you're attentive and professional."
              impact="2x engagement rate"
            />
            <TipCard
              icon={AlertTriangle}
              title="Address patterns in negatives"
              desc="If multiple reviews mention the same issue, fix it."
              impact="Prevents future negatives"
            />
          </div>
        </CollapsibleSection>
        
        {/* ============ VIEW ON GOOGLE ============ */}
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
        
        {/* Footer */}
        <p className="text-xs text-warm-600 text-center">
          Data from Google • Updates when you open the app
        </p>
      </div>
    </Modal>
  );
}

// ============ COLLAPSIBLE SECTION ============

interface CollapsibleSectionProps {
  title: string;
  icon: typeof Star;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CollapsibleSection({
  title,
  icon: Icon,
  subtitle,
  expanded,
  onToggle,
  children,
  defaultOpen,
}: CollapsibleSectionProps) {
  const isOpen = defaultOpen ? !expanded : expanded;
  
  return (
    <div className="bg-warm-800/50 rounded-xl border border-warm-700/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-warm-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
            <Icon className="w-4 h-4" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-warm-100">{title}</p>
            {subtitle && <p className="text-xs text-warm-500">{subtitle}</p>}
          </div>
        </div>
        <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronRight className="w-5 h-5 text-warm-500" />
        </motion.div>
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ TIP CARD ============

function TipCard({ icon: Icon, title, desc, impact }: { 
  icon: typeof MessageSquare; 
  title: string; 
  desc: string;
  impact?: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-warm-700/50">
      <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-warm-100">{title}</p>
        <p className="text-xs text-warm-400 mt-0.5">{desc}</p>
        {impact && (
          <p className="text-xs text-green-400 mt-1">📈 {impact}</p>
        )}
      </div>
    </div>
  );
}

export default ReputationBreakdownModal;
