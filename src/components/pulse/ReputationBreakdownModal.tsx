/**
 * ReputationBreakdownModal - Google Reviews details
 */

import { Modal } from '../common/Modal';
import { Star, ExternalLink } from 'lucide-react';
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
  if (!reviews) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Reputation">
        <div className="text-center py-8">
          <Star className="w-12 h-12 text-warm-300 mx-auto mb-3" />
          <p className="text-warm-600 font-medium">Google Reviews not configured</p>
          <p className="text-sm text-warm-500 mt-1">
            Set up your venue address in Settings to see your rating.
          </p>
        </div>
      </Modal>
    );
  }
  
  const ratingStyle = reviews.rating >= 4.5 
    ? { bg: 'bg-green-50 border-green-200', text: 'text-green-700', message: 'Outstanding! Keep it up.' }
    : reviews.rating >= 4.0 
      ? { bg: 'bg-primary-50 border-primary-100', text: 'text-primary-700', message: 'Strong reputation.' }
      : reviews.rating >= 3.5 
        ? { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', message: 'Room to improve.' }
        : { bg: 'bg-red-50 border-red-200', text: 'text-red-700', message: 'Needs attention.' };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reputation">
      <div className="space-y-5">
        {/* Rating display */}
        <div className="text-center py-4">
          <p className="text-4xl font-bold text-warm-800">{reviews.rating.toFixed(1)}</p>
          <div className="flex justify-center gap-1 mt-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className={`w-5 h-5 ${
                  i <= Math.round(reviews.rating) 
                    ? 'text-amber-400 fill-current' 
                    : 'text-warm-300'
                }`}
              />
            ))}
          </div>
          <p className="text-sm text-warm-500 mt-2">
            {reviews.reviewCount.toLocaleString()} reviews on Google
          </p>
        </div>
        
        {/* Status */}
        <div className={`p-3 rounded-xl border ${ratingStyle.bg}`}>
          <p className={`text-sm font-medium ${ratingStyle.text}`}>
            {reviews.rating >= 4.5 ? '🌟' : reviews.rating >= 4.0 ? '✅' : reviews.rating >= 3.5 ? '⚠️' : '🚨'}{' '}
            {ratingStyle.message}
          </p>
        </div>
        
        {/* Tips */}
        <div className="p-3 rounded-xl bg-warm-50">
          <p className="text-xs text-warm-500 uppercase tracking-wide mb-2 font-medium">
            How to improve
          </p>
          <ul className="space-y-2 text-sm text-warm-600">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-warm-400 mt-1.5" />
              Respond to all reviews (positive and negative)
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-warm-400 mt-1.5" />
              Ask happy guests to leave a review
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-warm-400 mt-1.5" />
              Address common complaints in recent reviews
            </li>
          </ul>
        </div>
        
        {/* Google link */}
        <a
          href={`https://www.google.com/maps/search/${encodeURIComponent(venueName)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-warm-100 hover:bg-warm-200 text-sm text-primary font-medium transition-colors"
        >
          View on Google
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </Modal>
  );
}

export default ReputationBreakdownModal;
