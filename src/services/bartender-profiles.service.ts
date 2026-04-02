/**
 * Bartender Profiles service.
 * Reads cross-shift performance profiles from DynamoDB BartenderProfiles table
 * via AppSync GraphQL.
 */

import { generateClient } from '@aws-amplify/api';

const client = generateClient();

interface ShiftHistoryEntry {
  date: string;
  jobId: string;
  drinks: number;
  perHour: number;
  durationHours: number;
  hasTheft: boolean;
  avgIdlePct: number;
  tableVisits: number;
}

export interface BartenderProfile {
  venueId: string;
  bartenderId: string;
  name: string;
  displayName?: string;
  totalShifts: number;
  totalDrinks: number;
  totalHours: number;
  avgDrinksPerHour: number;
  peakDrinksPerHour: number;
  theftFlags: number;
  lastSeen: string;
  shiftHistory: ShiftHistoryEntry[];
  avgIdlePct: number;
  tableVisits: number;
  createdAt: string;
  updatedAt: string;
}

interface RawProfile {
  venueId: string;
  bartenderId: string;
  name?: string;
  displayName?: string;
  totalShifts?: number;
  totalDrinks?: number;
  totalHours?: number;
  avgDrinksPerHour?: number;
  peakDrinksPerHour?: number;
  theftFlags?: number;
  lastSeen?: string;
  shiftHistory?: string; // JSON string
  avgIdlePct?: number;
  tableVisits?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface ProfileConnection {
  items: RawProfile[];
  nextToken?: string;
}

const LIST_PROFILES_QUERY = `
  query ListBartenderProfiles($venueId: ID!, $limit: Int) {
    listBartenderProfiles(venueId: $venueId, limit: $limit) {
      items {
        venueId bartenderId name displayName
        totalShifts totalDrinks totalHours
        avgDrinksPerHour peakDrinksPerHour
        theftFlags lastSeen shiftHistory
        avgIdlePct tableVisits
        createdAt updatedAt
      }
      nextToken
    }
  }
`;

const GET_PROFILE_QUERY = `
  query GetBartenderProfile($venueId: ID!, $bartenderId: String!) {
    getBartenderProfile(venueId: $venueId, bartenderId: $bartenderId) {
      venueId bartenderId name displayName
      totalShifts totalDrinks totalHours
      avgDrinksPerHour peakDrinksPerHour
      theftFlags lastSeen shiftHistory
      avgIdlePct tableVisits
      createdAt updatedAt
    }
  }
`;

function parseShiftHistory(raw: string | undefined): ShiftHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ShiftHistoryEntry[];
  } catch {
    return [];
  }
}

function normalizeProfile(raw: RawProfile): BartenderProfile {
  return {
    venueId:           raw.venueId,
    bartenderId:       raw.bartenderId,
    name:              raw.name ?? raw.bartenderId,
    displayName:       raw.displayName,
    totalShifts:       raw.totalShifts ?? 0,
    totalDrinks:       raw.totalDrinks ?? 0,
    totalHours:        raw.totalHours ?? 0,
    avgDrinksPerHour:  raw.avgDrinksPerHour ?? 0,
    peakDrinksPerHour: raw.peakDrinksPerHour ?? 0,
    theftFlags:        raw.theftFlags ?? 0,
    lastSeen:          raw.lastSeen ?? '',
    shiftHistory:      parseShiftHistory(raw.shiftHistory),
    avgIdlePct:        raw.avgIdlePct ?? 0,
    tableVisits:       raw.tableVisits ?? 0,
    createdAt:         raw.createdAt ?? '',
    updatedAt:         raw.updatedAt ?? '',
  };
}

const bartenderProfilesService = {
  async listProfiles(venueId: string): Promise<BartenderProfile[]> {
    try {
      const result = await client.graphql({
        query: LIST_PROFILES_QUERY,
        variables: { venueId, limit: 200 },
        authMode: 'userPool',
      }) as { data: { listBartenderProfiles: ProfileConnection } };

      const items = result?.data?.listBartenderProfiles?.items ?? [];
      return items
        .filter((p): p is RawProfile => p != null)
        .map(normalizeProfile)
        .sort((a, b) => b.avgDrinksPerHour - a.avgDrinksPerHour);
    } catch (err) {
      console.warn('[bartenderProfiles] listProfiles failed:', err);
      throw err;
    }
  },

  async getProfile(venueId: string, bartenderId: string): Promise<BartenderProfile | null> {
    try {
      const result = await client.graphql({
        query: GET_PROFILE_QUERY,
        variables: { venueId, bartenderId },
        authMode: 'userPool',
      }) as { data: { getBartenderProfile: RawProfile | null } };

      const raw = result?.data?.getBartenderProfile;
      if (!raw) return null;
      return normalizeProfile(raw);
    } catch (err) {
      console.warn('[bartenderProfiles] getProfile failed:', err);
      return null;
    }
  },
};

export default bartenderProfilesService;
