/**
 * AccuracyService — per-venue × per-feature accuracy scoring.
 *
 * Different features need different accuracy definitions:
 *   • Counting features (drinks, bottles, visits, turns, people)
 *     → % accuracy vs ground truth. Drinks use POS variance. Others need GT
 *       audit data that lands once P4-2 ships.
 *   • Predictive features (forecast, event forecaster)
 *     → MAPE (mean absolute percentage error) vs actuals. Lower is better.
 *     → Target: MAPE < 15% for staffing forecast, < 25% for event forecaster.
 *
 * Day-one this service surfaces REAL data where we already have it
 * (drink confidence/POS reconciliation, forecast actuals) and renders
 * explicit "awaiting data" states for everything else. UI degrades cleanly.
 */
import { adminService } from './admin.service';
import venueScopeService from './venuescope.service';
import {
  FEATURE_LABEL as REVIEW_FEATURE_LABEL,
} from './review.service';

export const FEATURE_LABEL: Record<string, string> = {
  drink_count:        'Drink Detection',
  bottle_count:       'Bottle Pour',
  pour_inventory:     'Pour Inventory',
  people_count:       'People Count',
  table_turns:        'Table Turns',
  table_service:      'Table Service',
  staff_activity:     'Staff Activity',
  forecast_staff:     'Staffing Forecast',
  event_forecaster:   'Event Forecaster',
  pos_integration:    'POS Integration',
};

/** Per-feature SLA targets. Green ≥ target. Yellow = within 4 points. Red otherwise. */
export const ACCURACY_TARGETS: Record<string, { target: number; metric: AccuracyMetric; unit: string }> = {
  drink_count:      { target: 99, metric: 'pct_accuracy', unit: '%' },
  bottle_count:     { target: 90, metric: 'pct_accuracy', unit: '%' },   // per user decision today
  pour_inventory:   { target: 99, metric: 'pct_accuracy', unit: '%' },
  people_count:     { target: 99, metric: 'pct_accuracy', unit: '%' },
  table_turns:      { target: 99, metric: 'pct_accuracy', unit: '%' },
  table_service:    { target: 95, metric: 'pct_accuracy', unit: '%' },
  staff_activity:   { target: 95, metric: 'pct_accuracy', unit: '%' },
  forecast_staff:   { target: 15, metric: 'mape',         unit: '%' },   // lower is better
  event_forecaster: { target: 25, metric: 'mape',         unit: '%' },
  pos_integration:  { target: 100, metric: 'pct_accuracy', unit: '%' },  // API call — should be 100
};

export type AccuracyMetric = 'pct_accuracy' | 'mape';
export type AccuracyBand   = 'green' | 'yellow' | 'red' | 'no-data';

export interface FeatureAccuracy {
  feature:       string;
  label:         string;
  metric:        AccuracyMetric;
  target:        number;         // % threshold for "green"
  value?:        number;         // current measured accuracy / MAPE
  sampleSize:    number;         // n shifts / days / events behind the number
  band:          AccuracyBand;
  narrative:     string;         // one-line human-readable explanation
  detailLink?:   string;         // tab in admin portal to drill into
}

export interface VenueAccuracySnapshot {
  venueId:    string;
  venueName:  string;
  computedAt: number;             // Unix seconds
  overall:    AccuracyBand;
  features:   FeatureAccuracy[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function bandForPctAccuracy(value: number | undefined, target: number): AccuracyBand {
  if (value === undefined || Number.isNaN(value)) return 'no-data';
  if (value >= target)           return 'green';
  if (value >= target - 4)       return 'yellow';
  return 'red';
}

function bandForMape(value: number | undefined, target: number): AccuracyBand {
  // MAPE: lower is better
  if (value === undefined || Number.isNaN(value)) return 'no-data';
  if (value <= target)           return 'green';
  if (value <= target + 5)       return 'yellow';
  return 'red';
}

function worstBand(bands: AccuracyBand[]): AccuracyBand {
  if (bands.some(b => b === 'red'))    return 'red';
  if (bands.some(b => b === 'yellow')) return 'yellow';
  if (bands.some(b => b === 'green'))  return 'green';
  return 'no-data';
}

// ── Feature scorers ──────────────────────────────────────────────────────────

/**
 * Drink accuracy via worker confidence scores + unrung drinks.
 * When review-queue backend lands we'll swap to event-level truth.
 */
async function scoreDrinkCount(venueId: string): Promise<FeatureAccuracy> {
  const target  = ACCURACY_TARGETS.drink_count.target;
  try {
    const jobs = await adminService.listJobs(venueId, 50);
    const drinkJobs = jobs.filter(j =>
      j.analysisMode === 'drink_count' && j.status === 'done' && j.totalDrinks > 0
    );
    if (drinkJobs.length === 0) {
      return {
        feature: 'drink_count', label: FEATURE_LABEL.drink_count,
        metric: 'pct_accuracy', target, sampleSize: 0, band: 'no-data',
        narrative: 'No completed drink_count shifts yet for this venue.',
      };
    }
    // Proxy accuracy: weighted average of confidenceScore, penalized by unrungDrinks fraction
    let weightedAcc = 0;
    let totalWeight  = 0;
    let totalDrinks  = 0;
    let totalUnrung  = 0;
    for (const j of drinkJobs) {
      const w = j.totalDrinks;
      if (w <= 0) continue;
      const conf  = Math.max(0, Math.min(1, j.confidenceScore ?? 0));
      const unrungFrac = j.unrungDrinks / Math.max(1, j.totalDrinks);
      const acc = conf * 100 * (1 - Math.min(0.30, unrungFrac));
      weightedAcc += acc * w;
      totalWeight  += w;
      totalDrinks  += j.totalDrinks;
      totalUnrung  += j.unrungDrinks;
    }
    const value = totalWeight > 0 ? weightedAcc / totalWeight : undefined;
    return {
      feature: 'drink_count', label: FEATURE_LABEL.drink_count,
      metric: 'pct_accuracy', target, value,
      sampleSize: drinkJobs.length,
      band: bandForPctAccuracy(value, target),
      narrative:
        value === undefined
          ? 'Could not compute — no weighted samples.'
          : `Proxy accuracy from worker confidence + unrung drinks. ${drinkJobs.length} shifts, ${totalDrinks} drinks total, ${totalUnrung} flagged as low-confidence. POS reconciliation coming once backend populates.`,
      detailLink: 'ops',
    };
  } catch (e) {
    return {
      feature: 'drink_count', label: FEATURE_LABEL.drink_count,
      metric: 'pct_accuracy', target, sampleSize: 0, band: 'no-data',
      narrative: `Could not load jobs: ${(e as Error).message}`,
    };
  }
}

/**
 * Staffing forecast MAPE from actualAccuracyPct written back by the
 * backfill process. If the stored value is already an "accuracy %" we
 * derive MAPE ≈ 100 − accuracy for display consistency.
 */
async function scoreStaffForecast(venueId: string): Promise<FeatureAccuracy> {
  const target  = ACCURACY_TARGETS.forecast_staff.target;
  try {
    const history = await venueScopeService.getForecastHistory(venueId, 30);
    const withActuals = history.filter(h =>
      typeof h.actualAccuracyPct === 'number' && (h.actualAccuracyPct as number) > 0
    );
    if (withActuals.length === 0) {
      return {
        feature: 'forecast_staff', label: FEATURE_LABEL.forecast_staff,
        metric: 'mape', target, sampleSize: 0, band: 'no-data',
        narrative: 'No forecast backfill results yet — MAPE appears after the first few nights.',
      };
    }
    const mapes = withActuals.map(h => Math.max(0, 100 - (h.actualAccuracyPct as number)));
    const avg   = mapes.reduce((s, x) => s + x, 0) / mapes.length;
    return {
      feature: 'forecast_staff', label: FEATURE_LABEL.forecast_staff,
      metric: 'mape', target, value: avg,
      sampleSize: withActuals.length,
      band: bandForMape(avg, target),
      narrative: `${withActuals.length} nights with backfilled actuals. Lower MAPE is better — target ≤ ${target}%.`,
    };
  } catch (e) {
    return {
      feature: 'forecast_staff', label: FEATURE_LABEL.forecast_staff,
      metric: 'mape', target, sampleSize: 0, band: 'no-data',
      narrative: `Could not load forecast history: ${(e as Error).message}`,
    };
  }
}

function placeholderFeature(feature: string, reason: string): FeatureAccuracy {
  const t = ACCURACY_TARGETS[feature];
  return {
    feature, label: FEATURE_LABEL[feature] ?? REVIEW_FEATURE_LABEL[feature] ?? feature,
    metric: t?.metric ?? 'pct_accuracy',
    target: t?.target ?? 95,
    sampleSize: 0, band: 'no-data',
    narrative: reason,
  };
}

// ── Top-level API ────────────────────────────────────────────────────────────

class AccuracyService {
  /**
   * Compute the full feature × accuracy matrix for one venue.
   * Each feature runs independently — one failure doesn't block the others.
   */
  async getVenueSnapshot(venueId: string, venueName: string): Promise<VenueAccuracySnapshot> {
    const [drinkAcc, forecastAcc] = await Promise.all([
      scoreDrinkCount(venueId),
      scoreStaffForecast(venueId),
    ]);

    const features: FeatureAccuracy[] = [
      drinkAcc,
      placeholderFeature('bottle_count',
        'Awaiting POS bottle-category wiring. 90% is acceptable per product decision.'),
      placeholderFeature('pour_inventory',
        'Pragmatic 99% target — starting + closing bottles vs POS drinks. Backend wiring pending (P1-13).'),
      placeholderFeature('people_count',
        'Awaiting monthly ground-truth audit (P4-2) to score.'),
      placeholderFeature('table_turns',
        'Awaiting monthly ground-truth audit (P4-2) to score.'),
      placeholderFeature('table_service',
        'Awaiting monthly ground-truth audit (P4-2). 95% target — hard at 99%.'),
      placeholderFeature('staff_activity',
        'Awaiting manual spot check workflow.'),
      forecastAcc,
      placeholderFeature('event_forecaster',
        'Event forecasts compared to attendance once enough events run. MAPE < 25% target.'),
      placeholderFeature('pos_integration',
        'POS is an external API call — accuracy is effectively connection success rate. TBD wiring.'),
    ];
    return {
      venueId, venueName, computedAt: Math.floor(Date.now() / 1000),
      overall: worstBand(features.map(f => f.band)),
      features,
    };
  }
}

export const accuracyService = new AccuracyService();
export default accuracyService;
