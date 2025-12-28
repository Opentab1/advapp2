import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Star, 
  ExternalLink, 
  RefreshCw, 
  AlertCircle,
  MessageSquare,
  TrendingUp,
  Clock,
  CheckCircle
} from 'lucide-react';
import googleReviewsService, { GoogleReviewsData } from '../services/google-reviews.service';
import authService from '../services/auth.service';
import venueSettingsService from '../services/venue-settings.service';

export function GoogleReviewsWidget() {
  const [reviewsData, setReviewsData] = useState<GoogleReviewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);

  const user = authService.getStoredUser();
  const venueName = user?.venueName || '';
  const venueId = user?.venueId || '';

  useEffect(() => {
    loadReviews();
  }, [venueId]);

  const loadReviews = async () => {
    console.log('🎯 GoogleReviewsWidget loadReviews called');
    console.log('📍 venueId:', venueId);
    console.log('📍 venueName:', venueName);
    
    if (!venueId || !venueName) {
      console.warn('⚠️ Missing venueId or venueName, skipping load');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get venue address for better search accuracy
      const address = venueSettingsService.getFormattedAddress(venueId) || '';
      console.log('📍 Venue address:', address || '(not set)');
      
      // Check cache age
      const age = googleReviewsService.getCacheAge(venueId);
      setCacheAge(age);
      console.log('📦 Cache age:', age, 'days');

      // Fetch reviews
      console.log('🔍 Calling googleReviewsService.getReviews...');
      const data = await googleReviewsService.getReviews(venueName, address, venueId);
      console.log('📊 Received data:', data);
      
      setReviewsData(data);
      
      if (!data && googleReviewsService.isConfigured()) {
        console.warn('⚠️ No data returned but API is configured');
        setError('Could not find your venue on Google Maps');
      }
    } catch (err: any) {
      console.error('❌ Error loading reviews:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!venueId || !venueName) return;

    try {
      setRefreshing(true);
      setError(null);

      const address = venueSettingsService.getFormattedAddress(venueId) || '';
      const data = await googleReviewsService.refreshReviews(venueName, address, venueId);
      setReviewsData(data);
      setCacheAge(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const openGoogleReviews = () => {
    const address = venueSettingsService.getFormattedAddress(venueId) || '';
    const url = googleReviewsService.getGoogleReviewsUrl(venueName, address);
    window.open(url, '_blank');
  };

  // Not configured state
  if (!googleReviewsService.isConfigured()) {
    return (
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-yellow-500/20">
            <Star className="w-5 h-5 text-yellow-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Google Reviews</h3>
        </div>
        
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-yellow-300 font-medium mb-1">
                API Key Required
              </p>
              <p className="text-xs text-yellow-300/80 mb-3">
                Add your SerpAPI key to enable automatic Google Reviews tracking.
              </p>
              <a 
                href="https://serpapi.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-cyan hover:text-cyan/80"
              >
                Get free API key <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Manual fallback - link to Google */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <button
            onClick={openGoogleReviews}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 transition-all"
          >
            <Star className="w-4 h-4" />
            View on Google Maps
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </motion.div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-yellow-500/20">
            <Star className="w-5 h-5 text-yellow-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Google Reviews</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
        </div>
      </motion.div>
    );
  }

  // Error state
  if (error && !reviewsData) {
    return (
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-yellow-500/20">
            <Star className="w-5 h-5 text-yellow-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Google Reviews</h3>
        </div>
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </motion.div>
    );
  }

  // No data state
  if (!reviewsData) {
    return (
      <motion.div
        className="glass-card p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-yellow-500/20">
            <Star className="w-5 h-5 text-yellow-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Google Reviews</h3>
        </div>
        <p className="text-gray-400 text-sm">
          No reviews data available. Make sure your venue address is set in Settings.
        </p>
        <button
          onClick={openGoogleReviews}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300"
        >
          <Star className="w-4 h-4" />
          View on Google Maps
          <ExternalLink className="w-3 h-3" />
        </button>
      </motion.div>
    );
  }

  // Success state - show reviews data
  return (
    <motion.div
      className="glass-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-yellow-500/20">
            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Google Reviews</h3>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all disabled:opacity-50"
          title="Refresh reviews"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Main Rating Display */}
      <div className="flex items-center gap-6 mb-4">
        <div className="text-center">
          <div className="text-4xl font-bold text-white">{reviewsData.rating.toFixed(1)}</div>
          <div className="flex items-center justify-center gap-0.5 mt-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-4 h-4 ${
                  star <= Math.round(reviewsData.rating)
                    ? 'text-yellow-400 fill-yellow-400'
                    : 'text-gray-600'
                }`}
              />
            ))}
          </div>
        </div>
        
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 text-gray-300">
            <MessageSquare className="w-4 h-4 text-gray-500" />
            <span className="text-sm">{reviewsData.reviewCount.toLocaleString()} reviews</span>
          </div>
          {reviewsData.priceLevel && (
            <div className="flex items-center gap-2 text-gray-300">
              <span className="text-sm font-medium text-green-400">{reviewsData.priceLevel}</span>
            </div>
          )}
        </div>
      </div>

      {/* Rating Quality Indicator */}
      <div className={`p-3 rounded-lg mb-4 ${
        reviewsData.rating >= 4.5 ? 'bg-green-500/10 border border-green-500/30' :
        reviewsData.rating >= 4.0 ? 'bg-yellow-500/10 border border-yellow-500/30' :
        reviewsData.rating >= 3.5 ? 'bg-orange-500/10 border border-orange-500/30' :
        'bg-red-500/10 border border-red-500/30'
      }`}>
        <div className="flex items-center gap-2">
          {reviewsData.rating >= 4.5 ? (
            <>
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400 font-medium">Excellent rating!</span>
            </>
          ) : reviewsData.rating >= 4.0 ? (
            <>
              <CheckCircle className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-yellow-400 font-medium">Good rating</span>
            </>
          ) : reviewsData.rating >= 3.5 ? (
            <>
              <AlertCircle className="w-4 h-4 text-orange-400" />
              <span className="text-sm text-orange-400 font-medium">Room for improvement</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400 font-medium">Needs attention</span>
            </>
          )}
        </div>
      </div>

      {/* Cache Info */}
      <div className="flex items-center justify-between text-xs text-gray-500 mb-4">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>
            Updated {cacheAge === 0 ? 'just now' : cacheAge === 1 ? 'yesterday' : `${cacheAge} days ago`}
          </span>
        </div>
        <span>Weekly refresh</span>
      </div>

      {/* Action Button */}
      <button
        onClick={openGoogleReviews}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all"
      >
        View All Reviews
        <ExternalLink className="w-3 h-3" />
      </button>
    </motion.div>
  );
}
