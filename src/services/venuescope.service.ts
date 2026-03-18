/**
 * venuescope.service.ts
 *
 * Client for the VenueScope REST API (runs on port 8502 alongside Streamlit).
 * All calls gracefully return null if the server is not configured or offline.
 */

const RAW_URL = import.meta.env.VITE_VENUESCOPE_URL || '';

// Derive API base from Streamlit URL — replace :8501 with :8502, or append :8502
function buildApiBase(): string | null {
  if (!RAW_URL || RAW_URL.includes('localhost') || RAW_URL.includes('127.0.0.1')) {
    return null;
  }
  // Replace port 8501 → 8502, or if no port add :8502
  const apiUrl = RAW_URL.replace(/:8501\b/, ':8502').replace(/\/$/, '');
  return apiUrl.includes(':8502') ? apiUrl : apiUrl + ':8502';
}

const API_BASE = buildApiBase();
const TIMEOUT_MS = 5000;

export interface VenueScopeLatestSummary {
  job_id: string;
  clip_label: string;
  total_drinks: number;
  drinks_per_hour: number;
  top_bartender: string;
  confidence_score: number;
  confidence_label: string;
  confidence_color: string;
  created_at: number;
  has_theft_flag: boolean;
  unrung_drinks?: number;
}

export interface VenueScope30dSummary {
  period: string;
  total_jobs: number;
  total_drinks: number;
  avg_drinks_per_shift: number;
  total_entries: number;
  drinks_by_date: Record<string, number>;
  entries_by_date: Record<string, number>;
}

export interface VenueScopeRecentJob {
  job_id: string;
  clip_label: string;
  analysis_mode: string;
  total_drinks: number;
  created_at: number;
  status: string;
}

export interface VenueScopeRecentJobsResponse {
  jobs: VenueScopeRecentJob[];
  total: number;
}

async function fetchWithTimeout<T>(path: string): Promise<T | null> {
  if (!API_BASE) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

const venueScopeService = {
  isConfigured(): boolean {
    return API_BASE !== null;
  },

  async checkHealth(): Promise<boolean> {
    const result = await fetchWithTimeout<{ status: string }>('/api/health');
    return result?.status === 'ok';
  },

  async getLatestSummary(): Promise<VenueScopeLatestSummary | null> {
    return fetchWithTimeout<VenueScopeLatestSummary>('/api/summary/latest');
  },

  async get30dSummary(): Promise<VenueScope30dSummary | null> {
    return fetchWithTimeout<VenueScope30dSummary>('/api/summary/30d');
  },

  async getRecentJobs(limit = 10, days = 30): Promise<VenueScopeRecentJob[]> {
    const result = await fetchWithTimeout<VenueScopeRecentJobsResponse>(
      `/api/jobs/recent?mode=drink_count&limit=${limit}&days=${days}`
    );
    return result?.jobs ?? [];
  },
};

export default venueScopeService;
