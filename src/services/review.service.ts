/**
 * ReviewService — low-confidence event review queue.
 *
 * Each detector emits individual events with a confidence score. Events below
 * the feature's threshold land here for human review: thumbnail + short clip +
 * predicted label + accept / reject buttons.
 *
 * Accepting updates the authoritative count in the job summary.
 * Rejecting removes the event from the count.
 * Both outcomes feed a learning signal for future model tuning.
 *
 * This is the single biggest lever toward the 99% accuracy SLA on drinks,
 * bottles, and table-service visits.
 *
 * Backend plumbing (worker → DDB → Lambda) lands in a separate commit behind
 * a feature flag. Until that ships, this service returns empty arrays and the
 * UI shows a friendly "no events to review" state.
 */
import { adminFetch } from './admin.service';

/** Confidence-review threshold per feature — events below land in queue. */
export const CONFIDENCE_THRESHOLDS: Record<string, number> = {
  drink_count:   0.30,
  bottle_count:  0.35,
  table_service: 0.25,
};

/** Map DB feature key → human-readable label. */
export const FEATURE_LABEL: Record<string, string> = {
  drink_count:   'Drink serve',
  bottle_count:  'Bottle pour',
  table_service: 'Table visit',
};

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface LowConfEvent {
  eventId:          string;
  venueId:          string;
  jobId:            string;
  cameraId:         string;
  cameraName?:      string;          // denormalized for UI
  feature:          keyof typeof FEATURE_LABEL | string;
  confidence:       number;          // 0..1
  detectedAt:       number;          // Unix seconds
  detectedValueJson?: string;        // JSON blob — feature-specific (bartender name, table id, bottle class)

  // Media
  snapshotUrl?:     string;          // pre-signed S3 URL to still frame
  clipUrl?:         string;          // pre-signed S3 URL to 3–5s mp4 context clip

  // Review state
  status:           ReviewStatus;
  reviewedBy?:      string;          // reviewer email
  reviewedAt?:      number;          // Unix seconds
  reviewerNote?:    string;
}

export interface ReviewFilters {
  venueId?:  string;
  feature?:  string;
  status?:   ReviewStatus;
  fromTs?:   number;
  toTs?:     number;
  limit?:    number;
}

export interface ReviewStats {
  pending:  number;
  approved: number;
  rejected: number;
  approvalRate: number;              // approved / (approved + rejected)
}

class ReviewService {
  /**
   * List low-confidence events. Backend endpoint TBD —
   * will be /admin/review-queue once Lambda lands.
   */
  async list(filters: ReviewFilters = {}): Promise<LowConfEvent[]> {
    try {
      const qs = new URLSearchParams();
      if (filters.venueId) qs.set('venueId', filters.venueId);
      if (filters.feature) qs.set('feature', filters.feature);
      if (filters.status)  qs.set('status',  filters.status);
      if (filters.fromTs !== undefined) qs.set('fromTs', String(filters.fromTs));
      if (filters.toTs   !== undefined) qs.set('toTs',   String(filters.toTs));
      if (filters.limit  !== undefined) qs.set('limit',  String(filters.limit));
      const res = await adminFetch(`/admin/review-queue?${qs.toString()}`);
      return (res?.events ?? []) as LowConfEvent[];
    } catch {
      // Backend not deployed yet — empty queue is the correct UX.
      return [];
    }
  }

  async stats(filters: Pick<ReviewFilters, 'venueId' | 'fromTs' | 'toTs'> = {}): Promise<ReviewStats> {
    try {
      const qs = new URLSearchParams();
      if (filters.venueId) qs.set('venueId', filters.venueId);
      if (filters.fromTs !== undefined) qs.set('fromTs', String(filters.fromTs));
      if (filters.toTs   !== undefined) qs.set('toTs',   String(filters.toTs));
      const res = await adminFetch(`/admin/review-queue/stats?${qs.toString()}`);
      return res as ReviewStats;
    } catch {
      return { pending: 0, approved: 0, rejected: 0, approvalRate: 0 };
    }
  }

  /**
   * Approve a flagged event — it gets counted toward the authoritative total.
   * Server also records the reviewer + timestamp for audit.
   */
  async approve(eventId: string, note?: string): Promise<LowConfEvent> {
    return adminFetch(`/admin/review-queue/${encodeURIComponent(eventId)}/approve`, {
      method: 'POST',
      body:   JSON.stringify({ note }),
    });
  }

  /** Reject an event — removed from the authoritative count. */
  async reject(eventId: string, note?: string): Promise<LowConfEvent> {
    return adminFetch(`/admin/review-queue/${encodeURIComponent(eventId)}/reject`, {
      method: 'POST',
      body:   JSON.stringify({ note }),
    });
  }

  /** Bulk approve/reject for power users. */
  async bulk(eventIds: string[], action: 'approve' | 'reject', note?: string): Promise<{ updated: number }> {
    return adminFetch(`/admin/review-queue/bulk`, {
      method: 'POST',
      body:   JSON.stringify({ eventIds, action, note }),
    });
  }
}

export const reviewService = new ReviewService();
export default reviewService;
