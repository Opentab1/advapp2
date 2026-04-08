/**
 * Forecast — Full Event Intelligence + Attendance Forecaster
 *
 * Port of Python:
 *   core/forecasting.py         → industry multiplier attendance model
 *   core/event_intelligence.py  → weather, Reddit, composite scoring, concept data
 *
 * Live API calls from browser:
 *   • Open-Meteo (weather)  — free, CORS-enabled, no key required
 *   • Reddit JSON API       — public, CORS-enabled, no key required
 *   • Google Trends         — NOT browser-callable; static demand scores used
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, TrendingUp, CloudRain, MapPin, RefreshCw, ChevronDown,
  BadgeDollarSign, Zap, MessageCircle, BarChart2,
  DollarSign, Star, Calendar,
} from 'lucide-react';
import venueSettingsService from '../services/venue-settings.service';
import authService from '../services/auth.service';

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL — Industry multiplier model (day-of-week × seasonality × event lift)
// ═══════════════════════════════════════════════════════════════════════════════

const DOW_MULTIPLIER: Record<number, number> = {
  0: 0.31, 1: 0.34, 2: 0.42, 3: 0.55, 4: 0.78, 5: 1.00, 6: 0.65,
};
const MONTH_MULTIPLIER: Record<number, number> = {
  1: 0.72, 2: 0.75, 3: 0.88, 4: 0.91, 5: 0.96, 6: 1.05,
  7: 1.02, 8: 0.98, 9: 0.93, 10: 0.97, 11: 1.08, 12: 1.12,
};
const EVENT_LIFT: Record<string, number> = {
  'DJ Night': 1.25, 'Live Music': 1.20, 'Trivia Night': 1.18,
  'Karaoke': 1.12, 'Drag Show': 1.30, 'Sports Watch Party': 1.22,
  'Comedy Night': 1.15, 'Happy Hour Special': 1.05, 'Themed Party': 1.28,
  'Open Mic': 1.08, 'Ladies Night': 1.20, 'Networking Event': 0.88,
  'Game Night': 1.10, 'Paint & Sip': 1.05, 'Speed Dating': 1.08, 'Other': 1.10,
};
const WEATHER_PENALTY: Record<string, number> = {
  none: 1.00, low: 0.97, moderate: 0.88, high: 0.72, extreme: 0.55,
};
const BAR_SPEND_PER_HEAD: Record<string, [number, number]> = {
  'DJ Night': [18, 35], 'Live Music': [15, 28], 'Trivia Night': [12, 22],
  'Karaoke': [15, 30], 'Drag Show': [18, 35], 'Sports Watch Party': [14, 25],
  'Comedy Night': [12, 22], 'Happy Hour Special': [10, 18],
  'Themed Party': [18, 35], 'Open Mic': [10, 18],
  'Paint & Sip': [20, 40], 'Speed Dating': [15, 30],
  'Networking Event': [12, 25], 'Other': [12, 25],
};

function barHolidayMultiplier(d: Date): number {
  const m = d.getMonth() + 1, day = d.getDate(), dow = (d.getDay() + 6) % 7;
  if (m === 3  && day === 17) return 1.45;
  if (m === 10 && day === 31) return 1.35;
  if (m === 12 && day === 31) return 1.50;
  if (m === 1  && day === 1)  return 0.60;
  if (m === 11 && day >= 22 && day <= 28) return 0.55;
  if (m === 12 && day === 25) return 0.40;
  if (m === 2 && dow === 6 && day >= 7 && day <= 14) return 1.30;
  return 1.0;
}

interface AttendanceResult {
  low: number; mid: number; high: number;
  fill_rate_pct: number;
  revenue_low: number; revenue_mid: number; revenue_high: number;
  avg_spend_low: number; avg_spend_high: number;
  factors: Record<string, number>;
}

function runModel(concept: string, date: Date, capacity: number, cover: number, weatherRisk: string): AttendanceResult {
  const base    = capacity * 0.55;
  const dow     = DOW_MULTIPLIER[(date.getDay() + 6) % 7] ?? 0.65;
  const month   = MONTH_MULTIPLIER[date.getMonth() + 1] ?? 1.0;
  const lift    = EVENT_LIFT[concept] ?? 1.10;
  const holiday = barHolidayMultiplier(date);
  const weather = WEATHER_PENALTY[weatherRisk] ?? 1.0;
  const midRaw  = base * dow * month * lift * holiday * weather;
  const mid  = Math.max(5, Math.min(capacity, Math.round(midRaw)));
  const low  = Math.max(1, Math.round(mid * 0.82));
  const high = Math.min(capacity, Math.round(mid * 1.18));
  const [spLow, spHigh] = BAR_SPEND_PER_HEAD[concept] ?? [14, 28];
  const avgSpend = (spLow + spHigh) / 2;
  return {
    low, mid, high,
    fill_rate_pct: Math.round((mid / capacity) * 100 * 10) / 10,
    revenue_low:  Math.round(low  * (cover + spLow)),
    revenue_mid:  Math.round(mid  * (cover + avgSpend)),
    revenue_high: Math.round(high * (cover + spHigh)),
    avg_spend_low: spLow, avg_spend_high: spHigh,
    factors: {
      base_fill_55pct:        Math.round(base),
      day_of_week_multiplier: dow,
      month_seasonality:      month,
      event_type_lift:        lift,
      holiday_factor:         holiday,
      weather_penalty:        weather,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONCEPT DATA TABLES (ported from event_intelligence.py)
// ═══════════════════════════════════════════════════════════════════════════════

const CONCEPT_TYPES = [
  'DJ Night', 'Live Music', 'Trivia Night', 'Karaoke', 'Drag Show',
  'Sports Watch Party', 'Comedy Night', 'Happy Hour Special', 'Themed Party',
  'Open Mic', 'Paint & Sip', 'Speed Dating', 'Networking Event',
  'Game Night', 'Ladies Night', 'Other',
];

const CONCEPT_EMOJIS: Record<string, string> = {
  'DJ Night': '🎧', 'Live Music': '🎸', 'Trivia Night': '🧠', 'Karaoke': '🎤',
  'Drag Show': '💅', 'Sports Watch Party': '📺', 'Comedy Night': '😂',
  'Happy Hour Special': '🍹', 'Themed Party': '🎭', 'Open Mic': '🎙️',
  'Paint & Sip': '🎨', 'Speed Dating': '💘', 'Networking Event': '🤝',
  'Game Night': '🎲', 'Ladies Night': '👑', 'Other': '✨',
};

const CONCEPT_DRINKS: Record<string, string[]> = {
  'DJ Night':           ['Vodka Red Bull', 'Tequila Shots', 'Long Island Iced Tea', 'Espresso Martini'],
  'Live Music':         ['Draft Beer', 'Whiskey Sour', 'Old Fashioned', 'Craft IPA'],
  'Trivia Night':       ['Domestic Beer Pitchers', 'Wings + Beer Bundle', 'House Wine', 'Cider'],
  'Karaoke':            ['Karaoke Bucket (5 beers)', 'Tequila Shots', 'Frozen Margarita', 'Rum & Coke'],
  'Drag Show':          ['Drag Cocktail Special', 'Champagne / Prosecco', 'Cosmopolitan', 'Espresso Martini'],
  'Sports Watch Party': ['Beer Buckets', 'Wings + Beer Bundle', 'Domestic Pitchers', 'Bloody Mary'],
  'Comedy Night':       ['Craft Beer', 'House Wine', 'Gin & Tonic', 'Bourbon on the Rocks'],
  'Happy Hour Special': ['$5 House Cocktails', '$3 Domestic Beer', 'Wine by the Glass', 'Margaritas'],
  'Themed Party':       ['Themed Signature Cocktail', 'Themed Shots', 'Bucket Packages', 'Champagne'],
  'Open Mic':           ['Craft Beer', 'House Wine', 'Seasonal Cocktail', 'Mocktail Option'],
  'Paint & Sip':        ['House Wine', 'Mimosas', 'Rosé', 'Sangria'],
  'Speed Dating':       ['Cocktail Package (2 drinks)', 'Wine', 'Gin & Tonic', 'Champagne'],
  'Networking Event':   ['Open Bar Package', 'Beer & Wine', 'Signature Cocktail', 'Non-Alcoholic Options'],
  'Game Night':         ['Craft Beer', 'House Cocktails', 'Shots', 'Non-Alcoholic Options'],
  'Ladies Night':       ['Rosé', 'Cosmopolitan', 'Prosecco', 'Specialty Cocktails'],
  'Other':              ['Signature House Cocktail', 'Draft Beer', 'House Wine'],
};

const CONCEPT_PRICING: Record<string, { cover: [number, number]; vip_table_min: [number, number] | null }> = {
  'DJ Night':           { cover: [10, 25], vip_table_min: [200, 500] },
  'Live Music':         { cover: [5, 20],  vip_table_min: [100, 300] },
  'Trivia Night':       { cover: [0, 5],   vip_table_min: null },
  'Karaoke':            { cover: [0, 10],  vip_table_min: [50, 150] },
  'Drag Show':          { cover: [10, 30], vip_table_min: [100, 300] },
  'Sports Watch Party': { cover: [0, 10],  vip_table_min: null },
  'Comedy Night':       { cover: [10, 25], vip_table_min: [100, 200] },
  'Happy Hour Special': { cover: [0, 0],   vip_table_min: null },
  'Themed Party':       { cover: [10, 30], vip_table_min: [150, 400] },
  'Open Mic':           { cover: [0, 5],   vip_table_min: null },
  'Paint & Sip':        { cover: [25, 55], vip_table_min: null },
  'Speed Dating':       { cover: [20, 45], vip_table_min: null },
  'Networking Event':   { cover: [10, 30], vip_table_min: null },
  'Game Night':         { cover: [0, 10],  vip_table_min: null },
  'Ladies Night':       { cover: [0, 10],  vip_table_min: [100, 250] },
  'Other':              { cover: [5, 20],  vip_table_min: null },
};

const CONCEPT_BEST_NIGHTS: Record<string, string[]> = {
  'DJ Night':           ['Friday', 'Saturday'],
  'Live Music':         ['Thursday', 'Friday', 'Saturday'],
  'Trivia Night':       ['Tuesday', 'Wednesday', 'Thursday'],
  'Karaoke':            ['Wednesday', 'Thursday', 'Sunday'],
  'Drag Show':          ['Saturday', 'Sunday'],
  'Sports Watch Party': ['Sunday', 'Monday', 'Thursday'],
  'Comedy Night':       ['Thursday', 'Friday'],
  'Happy Hour Special': ['Tuesday', 'Wednesday', 'Thursday'],
  'Themed Party':       ['Friday', 'Saturday'],
  'Open Mic':           ['Monday', 'Tuesday', 'Wednesday'],
  'Paint & Sip':        ['Sunday', 'Wednesday'],
  'Speed Dating':       ['Thursday', 'Friday'],
  'Networking Event':   ['Tuesday', 'Wednesday', 'Thursday'],
  'Game Night':         ['Tuesday', 'Wednesday'],
  'Ladies Night':       ['Thursday', 'Friday'],
  'Other':              ['Thursday', 'Friday', 'Saturday'],
};

const CONCEPT_COSTS: Record<string, { low: number; high: number; items: string[] }> = {
  'DJ Night':           { low: 200, high: 1500, items: ['DJ fee', 'sound system rental', 'lighting'] },
  'Live Music':         { low: 150, high: 800,  items: ['Band/musician fee', 'sound check time', 'PA rental'] },
  'Trivia Night':       { low: 50,  high: 300,  items: ['Trivia host fee', 'printing', 'prizes'] },
  'Karaoke':            { low: 100, high: 400,  items: ['Karaoke system rental', 'host fee', 'song books'] },
  'Drag Show':          { low: 300, high: 2000, items: ['Performer fees (2-4)', 'staging', 'sound'] },
  'Sports Watch Party': { low: 0,   high: 200,  items: ['Extra TVs rental (optional)', 'promotions budget'] },
  'Comedy Night':       { low: 100, high: 600,  items: ['Comedian fee', 'mic/PA setup', 'stage lighting'] },
  'Happy Hour Special': { low: 0,   high: 100,  items: ['Promotional materials', 'social media ads'] },
  'Themed Party':       { low: 200, high: 1000, items: ['Decor', 'DJ/music', 'costume props', 'themed drinks'] },
  'Open Mic':           { low: 0,   high: 150,  items: ['PA system', 'host fee', 'microphone setup'] },
  'Paint & Sip':        { low: 200, high: 500,  items: ['Art supplies per person', 'instructor fee', 'easels'] },
  'Speed Dating':       { low: 50,  high: 200,  items: ['Event host fee', 'score cards', 'name tags', 'prizes'] },
  'Networking Event':   { low: 100, high: 500,  items: ['Marketing', 'name tags', 'light catering optional'] },
  'Game Night':         { low: 50,  high: 300,  items: ['Board games/supplies', 'host fee', 'prizes'] },
  'Ladies Night':       { low: 100, high: 400,  items: ['DJ/music', 'promotional materials', 'themed decor'] },
  'Other':              { low: 100, high: 500,  items: ['Variable based on concept'] },
};

// Static market demand (proxy for Google Trends — pytrends not callable from browser)
const CONCEPT_MARKET_DEMAND: Record<string, number> = {
  'DJ Night': 72, 'Live Music': 68, 'Trivia Night': 65, 'Karaoke': 70,
  'Drag Show': 58, 'Sports Watch Party': 75, 'Comedy Night': 55,
  'Happy Hour Special': 80, 'Themed Party': 62, 'Open Mic': 45,
  'Paint & Sip': 60, 'Speed Dating': 50, 'Networking Event': 42,
  'Game Night': 52, 'Ladies Night': 65, 'Other': 50,
};

const CONCEPT_KEYWORDS: Record<string, string[]> = {
  'DJ Night': ['dj night bar', 'nightclub dj', 'club night'],
  'Live Music': ['live music bar', 'live band bar', 'music venue'],
  'Trivia Night': ['trivia night bar', 'pub quiz', 'bar trivia'],
  'Karaoke': ['karaoke bar', 'karaoke night'],
  'Drag Show': ['drag show bar', 'drag brunch', 'drag night'],
  'Sports Watch Party': ['sports bar', 'watch party bar', 'game day bar'],
  'Comedy Night': ['comedy night bar', 'stand up comedy bar'],
  'Happy Hour Special': ['happy hour bar', 'drink specials bar'],
  'Themed Party': ['themed party bar', 'costume night bar'],
  'Open Mic': ['open mic night', 'open mic bar'],
  'Paint & Sip': ['paint and sip', 'sip and paint'],
  'Speed Dating': ['speed dating event', 'singles night bar'],
  'Networking Event': ['networking happy hour', 'professional networking bar'],
  'Game Night': ['game night bar', 'board game bar'],
  'Ladies Night': ['ladies night bar', 'girls night bar'],
  'Other': ['bar event', 'bar night'],
};

// ═══════════════════════════════════════════════════════════════════════════════
// GEO — city → lat/lon for Open-Meteo
// ═══════════════════════════════════════════════════════════════════════════════

const CITY_LATLON: Record<string, [number, number]> = {
  'tampa': [27.9506, -82.4572], 'miami': [25.7617, -80.1918],
  'orlando': [28.5383, -81.3792], 'new york': [40.7128, -74.0060],
  'los angeles': [34.0522, -118.2437], 'chicago': [41.8781, -87.6298],
  'houston': [29.7604, -95.3698], 'dallas': [32.7767, -96.7970],
  'atlanta': [33.7490, -84.3880], 'boston': [42.3601, -71.0589],
  'nashville': [36.1627, -86.7816], 'las vegas': [36.1699, -115.1398],
  'seattle': [47.6062, -122.3321], 'denver': [39.7392, -104.9903],
  'austin': [30.2672, -97.7431], 'phoenix': [33.4484, -112.0740],
  'philadelphia': [39.9526, -75.1652], 'san francisco': [37.7749, -122.4194],
  'portland': [45.5051, -122.6750], 'charlotte': [35.2271, -80.8431],
  'new orleans': [29.9511, -90.0715], 'minneapolis': [44.9778, -93.2650],
  'san diego': [32.7157, -117.1611], 'detroit': [42.3314, -83.0458],
  'baltimore': [39.2904, -76.6122], 'pittsburgh': [40.4406, -79.9959],
  'san antonio': [29.4241, -98.4936], 'memphis': [35.1495, -90.0490],
  'kansas city': [39.0997, -94.5786], 'cleveland': [41.4993, -81.6944],
  'columbus': [39.9612, -82.9988], 'indianapolis': [39.7684, -86.1581],
  'st. louis': [38.6270, -90.1994], 'salt lake city': [40.7608, -111.8910],
  'sacramento': [38.5816, -121.4944], 'san jose': [37.3382, -121.8863],
  'fort worth': [32.7555, -97.3308], 'jacksonville': [30.3322, -81.6557],
};

// ═══════════════════════════════════════════════════════════════════════════════
// WEATHER — Open-Meteo (free, CORS-enabled, no key required)
// ═══════════════════════════════════════════════════════════════════════════════

interface WeatherResult {
  risk: 'none' | 'low' | 'moderate' | 'high' | 'unknown';
  temp_high_f?: number;
  temp_low_f?: number;
  precip_inches?: number;
  risk_factors: string[];
  attendance_impact: string;
  forecast_available: boolean;
  error?: string;
}

async function fetchWeather(city: string, date: string): Promise<WeatherResult> {
  try {
    const key = city.toLowerCase().trim();
    const [lat, lon] = CITY_LATLON[key] ?? [27.9506, -82.4572];

    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lon),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
      forecast_days: '16', timezone: 'auto',
      temperature_unit: 'fahrenheit', precipitation_unit: 'inch',
    });

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const dates: string[] = data.daily.time;
    if (!dates.includes(date)) {
      return { risk: 'unknown', risk_factors: [], attendance_impact: 'unknown', forecast_available: false };
    }

    const idx    = dates.indexOf(date);
    const tmax   = data.daily.temperature_2m_max[idx] as number;
    const tmin   = data.daily.temperature_2m_min[idx] as number;
    const precip = data.daily.precipitation_sum[idx] as number;

    const riskFactors: string[] = [];
    if (precip > 0.1) riskFactors.push(`Rain expected (${precip.toFixed(1)}" — est. 15-30% attendance drop)`);
    if (tmax < 35)    riskFactors.push(`Very cold (${Math.round(tmax)}°F — consider heaters)`);
    if (tmax > 100)   riskFactors.push(`Extreme heat (${Math.round(tmax)}°F — ensure AC capacity)`);

    const risk: WeatherResult['risk'] =
      (precip > 0.5 || tmax < 35) ? 'high' :
      riskFactors.length > 0 ? 'moderate' :
      precip > 0 ? 'low' : 'none';

    return {
      risk,
      temp_high_f:  Math.round(tmax),
      temp_low_f:   Math.round(tmin),
      precip_inches: Math.round(precip * 100) / 100,
      risk_factors: riskFactors,
      attendance_impact: risk === 'high' ? '-25%' : risk === 'moderate' ? '-10%' : risk === 'low' ? '-3%' : 'none',
      forecast_available: true,
    };
  } catch (e) {
    return { risk: 'unknown', risk_factors: [], attendance_impact: 'unknown', forecast_available: false, error: String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REDDIT — Public JSON API (CORS-enabled, no key required)
// ═══════════════════════════════════════════════════════════════════════════════

const POS_WORDS = new Set(['love','great','amazing','awesome','best','good','fun','exciting','favorite','perfect','excellent','enjoy','recommend','popular','want','incredible','fantastic','wonderful','outstanding','thriving','packed','buzzing']);
const NEG_WORDS = new Set(['bad','terrible','worst','hate','boring','dead','empty','avoid','disappointing','lame','overpriced','skip','awful','horrible','dreadful','mediocre','weak','poor','lacking','closed','failed','flop']);

function simpleSentiment(text: string): number {
  const words = text.toLowerCase().split(/\W+/);
  let score = 0;
  for (const w of words) {
    if (POS_WORDS.has(w)) score += 0.25;
    if (NEG_WORDS.has(w)) score -= 0.25;
  }
  return Math.max(-1, Math.min(1, score));
}

interface RedditResult {
  mentions: number;
  sentiment: number;
  sentiment_label: 'positive' | 'neutral' | 'negative';
  top_posts: { title: string; score: number; sentiment: number }[];
  error?: string;
}

async function fetchReddit(concept: string, city: string): Promise<RedditResult> {
  try {
    const keywords = CONCEPT_KEYWORDS[concept] ?? [concept.toLowerCase()];
    const query = city ? `${keywords[0]} ${city}` : keywords[0];

    const params = new URLSearchParams({
      q: query, sort: 'relevance', t: 'year', limit: '25', raw_json: '1',
    });

    const res = await fetch(`https://www.reddit.com/search.json?${params}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    type RedditPost = { data: { title: string; score: number } };
    const posts = (data?.data?.children ?? []) as RedditPost[];
    const sentiments: number[] = [];
    const topPosts: RedditResult['top_posts'] = [];

    for (const { data: p } of posts) {
      const s = simpleSentiment(p.title);
      sentiments.push(s);
      topPosts.push({ title: p.title.slice(0, 120), score: p.score, sentiment: Math.round(s * 100) / 100 });
    }

    topPosts.sort((a, b) => b.score - a.score);
    const avgSentiment = sentiments.length > 0
      ? Math.round((sentiments.reduce((a, b) => a + b, 0) / sentiments.length) * 100) / 100
      : 0;

    return {
      mentions: posts.length,
      sentiment: avgSentiment,
      sentiment_label: avgSentiment > 0.1 ? 'positive' : avgSentiment < -0.1 ? 'negative' : 'neutral',
      top_posts: topPosts.slice(0, 5),
    };
  } catch (e) {
    return { mentions: 0, sentiment: 0, sentiment_label: 'neutral', top_posts: [], error: String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITE SCORE — ported from _composite_score in event_intelligence.py
// ═══════════════════════════════════════════════════════════════════════════════

interface ManualSignals {
  // RSVP signals (Glue Up / Eventbrite / OMG Hitched / Patchboard research)
  rsvp_type: 'paid' | 'free' | 'facebook';
  rsvp_count: string;
  // Lead time: days between announcement and event date (Eugene Loj / Brewer Magazine / Eventbrite NIVA '24)
  lead_time_days: string;
  // Social / ad signals
  meta_cpc_a: string; meta_cpc_b: string;
  tiktok_save_rate: string; ig_dm_count: string;
  ig_poll_pct: string; eventbrite_pct: string;
}

interface CompositeResult {
  score: number;
  verdict: 'green' | 'yellow' | 'red';
  verdict_text: string;
  notes: string[];
  trends_pts: number;
  weather_pts: number;
  reddit_pts: number;
  manual_pts: number;
}

function computeComposite(
  concept: string,
  weather: WeatherResult,
  reddit: RedditResult,
  manual: ManualSignals,
  venueCapacity: number,
): CompositeResult {
  let score = 0;
  const notes: string[] = [];

  // Market demand (30 pts — static proxy for Google Trends)
  const demand = CONCEPT_MARKET_DEMAND[concept] ?? 50;
  const trendsPts = Math.min(30, Math.round(demand * 0.30));
  score += trendsPts;
  if (demand >= 70) notes.push(`📈 High market demand for ${concept} (${demand}/100 baseline score)`);
  else if (demand <= 45) notes.push(`📉 Below-average demand for ${concept} (${demand}/100 — consider higher-demand concept)`);

  // Weather (up to -20 penalty)
  let weatherPts = 0;
  if (weather.risk === 'high') {
    score -= 20; weatherPts = -20;
    notes.push(`⛈️ High weather risk: ${weather.risk_factors.join('; ') || 'storm conditions expected'}`);
  } else if (weather.risk === 'moderate') {
    score -= 8; weatherPts = -8;
    notes.push(`🌧️ Moderate weather risk: ${weather.risk_factors.join('; ') || 'rain possible'}`);
  } else if (weather.risk === 'low') {
    score -= 2; weatherPts = -2;
  } else if (weather.risk === 'none') {
    notes.push('☀️ Clear weather forecast — no attendance impact expected');
  }

  // Reddit (20 pts)
  const { mentions, sentiment } = reddit;
  const redditPts = Math.min(10, Math.floor(mentions / 3)) + (sentiment > 0.1 ? 10 : sentiment > -0.1 ? 5 : 0);
  score += redditPts;
  if (mentions > 10) notes.push(`💬 Strong online buzz: ${mentions} Reddit posts, ${reddit.sentiment_label} sentiment`);
  else if (mentions > 3) notes.push(`💬 Some Reddit activity: ${mentions} posts found`);
  else notes.push(`💬 Low Reddit signal: ${mentions} posts (normal for local events)`);

  // Manual signals (capped at 65 pts — raised to accommodate RSVP + lead time)
  let manualScore = 0;

  // ── RSVP signal (up to 15 pts) ──────────────────────────────────────────────
  // Source: Glue Up, OMG Hitched, Eventbrite UK, Patchboard practitioner data
  // Paid: 90-95% show rate. Free guestlist: 40-60% show rate (4× cap rule).
  // Facebook: as low as 5% conversion for nightlife.
  const rsvpCount = parseInt(manual.rsvp_count);
  const cap = venueCapacity;
  if (!isNaN(rsvpCount) && rsvpCount > 0) {
    const ratio = rsvpCount / cap;
    let rsvpPts = 0;
    if (manual.rsvp_type === 'paid') {
      // Paid RSVPs: 90-95% show rate → 1× cap = nearly sold out
      rsvpPts = ratio >= 1.0 ? 15 : ratio >= 0.75 ? 12 : ratio >= 0.50 ? 8 : ratio >= 0.25 ? 4 : 1;
      const showEst = Math.round(rsvpCount * 0.92);
      notes.push(`🎟️ ${rsvpCount} paid RSVPs (~${showEst} expected through door at 92% show rate)`);
    } else if (manual.rsvp_type === 'free') {
      // Free guestlist: 4× capacity = sweet spot per promoter rule (25% conversion)
      rsvpPts = ratio >= 4.0 ? 15 : ratio >= 3.0 ? 10 : ratio >= 2.0 ? 6 : ratio >= 1.0 ? 3 : 1;
      const showEst = Math.round(rsvpCount * 0.40);
      notes.push(`📋 ${rsvpCount} free RSVPs (~${showEst} expected at door, 40% free-event show rate)`);
    } else {
      // Facebook "Going": as low as 5% for nightlife (Quora promoters)
      rsvpPts = ratio >= 20 ? 10 : ratio >= 10 ? 6 : ratio >= 5 ? 3 : 1;
      const showEst = Math.round(rsvpCount * 0.08);
      notes.push(`👍 ${rsvpCount} Facebook RSVPs (~${showEst} expected at door, ~8% nightlife conversion)`);
    }
    manualScore += rsvpPts;
  }

  // ── Lead time signal (up to 8 pts) ──────────────────────────────────────────
  // Source: Eugene Loj case study (10-day promo → 50% sales drop),
  //         Brewer Magazine (2-3 week sweet spot for bar events),
  //         Eventbrite NIVA '24 (57% of tickets sell within 1 week of show)
  const leadDays = parseInt(manual.lead_time_days);
  if (!isNaN(leadDays) && leadDays >= 0) {
    let leadPts = 0;
    if (leadDays >= 21 && leadDays <= 42) {
      leadPts = 8; // Sweet spot: 3-6 weeks (Brewer Magazine, Eugene Loj)
      notes.push(`📅 ${leadDays}-day lead time — ideal promotion window (21-42 days is the sweet spot)`);
    } else if (leadDays > 42) {
      leadPts = 4; // Good awareness, risk of audience forgetting
      notes.push(`📅 ${leadDays}-day lead time — good awareness, send reminders closer to the date`);
    } else if (leadDays >= 14) {
      leadPts = 5; // 2 weeks — still workable per Brewer Magazine
      notes.push(`📅 ${leadDays}-day lead time — workable, but 21+ days gives ~40% more ticket velocity`);
    } else if (leadDays >= 7) {
      leadPts = 2; // Last week — heavy concentration here but late start
      notes.push(`📅 ${leadDays}-day lead time — 57% of tickets sell in final week anyway, but late start limits ceiling`);
    } else {
      leadPts = 0; // Under 7 days — Eugene Loj: 50%+ drop in online sales
      notes.push(`⚠️ ${leadDays}-day lead time — very late. Promotions starting under 7 days out see ~50% fewer online sales`);
    }
    manualScore += leadPts;
  }

  // ── Social / ad signals ──────────────────────────────────────────────────────
  const cpcA = parseFloat(manual.meta_cpc_a), cpcB = parseFloat(manual.meta_cpc_b);
  if (!isNaN(cpcA) && !isNaN(cpcB) && cpcA > 0 && cpcB > 0) {
    manualScore += 15;
    const w = cpcA < cpcB ? 'A' : 'B';
    notes.push(`✅ Meta A/B: Concept ${w} wins ($${Math.min(cpcA,cpcB).toFixed(2)}/click vs $${Math.max(cpcA,cpcB).toFixed(2)})`);
  }
  const tsr = parseFloat(manual.tiktok_save_rate);
  if (!isNaN(tsr) && tsr >= 1.0) { manualScore += 12; notes.push(`🎵 TikTok save rate ${tsr}% — strong demand signal`); }
  else if (!isNaN(tsr) && tsr >= 0.5) { manualScore += 6; notes.push(`🎵 TikTok save rate ${tsr}% — moderate signal`); }

  const dms = parseInt(manual.ig_dm_count);
  if (!isNaN(dms) && dms >= 10) { manualScore += 10; notes.push(`📸 ${dms} unprompted Instagram DMs — high intent`); }
  else if (!isNaN(dms) && dms >= 5) { manualScore += 5; notes.push(`📸 ${dms} Instagram DMs — some interest`); }

  const poll = parseFloat(manual.ig_poll_pct);
  if (!isNaN(poll) && poll >= 65) { manualScore += 8; notes.push(`📊 Instagram poll: ${poll}% want this event`); }
  else if (!isNaN(poll) && poll >= 50) { manualScore += 4; notes.push(`📊 Instagram poll: ${poll}% want this (marginal)`); }

  const eb = parseFloat(manual.eventbrite_pct);
  if (!isNaN(eb) && eb >= 15) { manualScore += 5; notes.push(`🎟️ Eventbrite: ${eb}% capacity sold in 48h — hit`); }
  else if (!isNaN(eb) && eb >= 5) { manualScore += 2; notes.push(`🎟️ Eventbrite: ${eb}% sold in 48h — watch closely`); }

  const manualPts = Math.min(65, manualScore);
  score += manualPts;
  score = Math.max(0, Math.min(100, score));

  const verdict: CompositeResult['verdict'] = score >= 70 ? 'green' : score >= 45 ? 'yellow' : 'red';
  const verdict_text = {
    green:  '✅ Run it — all signals validated. Book the venue, hire the talent.',
    yellow: '🟡 Test night first — 1 run before committing to recurring.',
    red:    '🔴 Reconsider — weak signals. Try a different concept or night.',
  }[verdict];

  return { score, verdict, verdict_text, notes, trends_pts: trendsPts, weather_pts: weatherPts, reddit_pts: redditPts, manual_pts: manualPts };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function ScoreRing({ score, verdict }: { score: number; verdict: string }) {
  const r = 34, circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = verdict === 'green' ? '#22c55e' : verdict === 'yellow' ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <svg width="80" height="80" className="-rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#374151" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-white leading-none">{score}</span>
        <span className="text-[9px] text-warm-500">/100</span>
      </div>
    </div>
  );
}

interface DataLayerProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  color?: string;
  loading?: boolean;
  pts?: number;
}

function DataLayer({ icon: Icon, label, value, sub, color = 'text-warm-300', loading, pts }: DataLayerProps) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-warm-700/40 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-warm-700/60 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-warm-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-warm-500 uppercase tracking-wide">{label}</p>
        {loading ? (
          <div className="flex items-center gap-1.5 mt-0.5">
            <RefreshCw className="w-3 h-3 animate-spin text-warm-500" />
            <span className="text-xs text-warm-500">Fetching…</span>
          </div>
        ) : (
          <>
            <p className={`text-sm font-semibold ${color} truncate`}>{value}</p>
            {sub && <p className="text-[10px] text-warm-500 truncate">{sub}</p>}
          </>
        )}
      </div>
      {pts !== undefined && !loading && (
        <span className={`text-xs font-mono font-bold flex-shrink-0 ${pts < 0 ? 'text-red-400' : 'text-teal'}`}>
          {pts > 0 ? '+' : ''}{pts}
        </span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_FULL   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEATHER_OPTIONS = [
  { value: 'none',     label: 'Clear / No impact'     },
  { value: 'low',      label: 'Overcast (−3%)'         },
  { value: 'moderate', label: 'Rain / Wind (−12%)'     },
  { value: 'high',     label: 'Storm (−28%)'           },
  { value: 'extreme',  label: 'Severe weather (−45%)'  },
];

function nextFriday(): string {
  const d = new Date();
  const diff = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

export function Forecast() {
  const user    = authService.getStoredUser();
  const venueId = user?.venueId || '';

  // ── Inputs ──────────────────────────────────────────────────────────────────
  const [concept,  setConcept]  = useState('DJ Night');
  const [city,     setCity]     = useState('');
  const [date,     setDate]     = useState(nextFriday());
  const [capacity, setCapacity] = useState('150');
  const [cover,    setCover]    = useState('');
  const [weatherRisk, setWeatherRisk] = useState('none');
  const [autoWeather, setAutoWeather] = useState(true);
  const [manualSignals, setManualSignals] = useState<ManualSignals>({
    rsvp_type: 'paid', rsvp_count: '', lead_time_days: '',
    meta_cpc_a: '', meta_cpc_b: '', tiktok_save_rate: '',
    ig_dm_count: '', ig_poll_pct: '', eventbrite_pct: '',
  });
  const [showManual,  setShowManual]  = useState(false);
  const [showFactors, setShowFactors] = useState(false);
  const [weekResults, setWeekResults] = useState<Record<string, AttendanceResult>>({});

  // ── Results ──────────────────────────────────────────────────────────────────
  const [loading,   setLoading]   = useState(false);
  const [loadPhase, setLoadPhase] = useState('');
  const [attendance, setAttendance] = useState<AttendanceResult | null>(null);
  const [weather,    setWeather]    = useState<WeatherResult | null>(null);
  const [reddit,     setReddit]     = useState<RedditResult | null>(null);
  const [composite,  setComposite]  = useState<CompositeResult | null>(null);

  useEffect(() => {
    const addr = venueSettingsService.getAddress(venueId);
    if (addr?.city) setCity(addr.city);
    else venueSettingsService.getAddressFromCloud(venueId)
      .then(a => { if (a?.city) setCity(a.city); })
      .catch(() => {});
  }, [venueId]);

  const withinForecastWindow = (): boolean => {
    const diff = Math.ceil((new Date(date + 'T12:00:00').getTime() - Date.now()) / 86400000);
    return diff >= 0 && diff <= 15;
  };

  const runAnalysis = async () => {
    setLoading(true);
    setAttendance(null);
    setWeather(null);
    setReddit(null);
    setComposite(null);
    setWeekResults({});

    const cap = parseInt(capacity) || 150;
    const cov = parseFloat(cover) || 0;
    const d   = new Date(date + 'T12:00:00');

    // Attendance model (synchronous)
    const att = runModel(concept, d, cap, cov, weatherRisk);
    setAttendance(att);

    // Weather
    let wx: WeatherResult;
    if (city && withinForecastWindow() && autoWeather) {
      setLoadPhase('Fetching weather from Open-Meteo…');
      wx = await fetchWeather(city, date);
      setWeather(wx);
      if (wx.forecast_available && wx.risk !== 'unknown') {
        setWeatherRisk(wx.risk);
        setAttendance(runModel(concept, d, cap, cov, wx.risk));
      }
    } else {
      wx = {
        risk: weatherRisk as WeatherResult['risk'],
        risk_factors: [],
        attendance_impact: weatherRisk === 'none' ? 'none' : weatherRisk === 'low' ? '-3%' : weatherRisk === 'moderate' ? '-10%' : weatherRisk === 'high' ? '-25%' : '-45%',
        forecast_available: false,
      };
      setWeather(wx);
    }

    // Reddit
    setLoadPhase('Searching Reddit for demand signals…');
    const rd = await fetchReddit(concept, city);
    setReddit(rd);

    // Composite score
    setLoadPhase('Computing validation score…');
    const comp = computeComposite(concept, wx, rd, manualSignals, cap);

    // Day-of-week check
    const dow = DOW_FULL[(new Date(date + 'T12:00:00').getDay() + 6) % 7];
    const bestNights = CONCEPT_BEST_NIGHTS[concept] ?? [];
    if (!bestNights.includes(dow)) {
      comp.notes.push(`⚠️ ${dow} is not the optimal night — best nights for ${concept}: ${bestNights.join(', ')}`);
    }

    setComposite(comp);
    setLoadPhase('');
    setLoading(false);
  };

  const runWeekComparison = () => {
    const cap = parseInt(capacity) || 150;
    const cov = parseFloat(cover) || 0;
    const base = new Date(date + 'T12:00:00');
    const monday = new Date(base);
    monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    const map: Record<string, AttendanceResult> = {};
    DOW_LABELS.forEach((day, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      map[day] = runModel(concept, d, cap, cov, weather?.risk && weather.risk !== 'unknown' ? weather.risk : weatherRisk);
    });
    setWeekResults(map);
  };

  const selectedDow     = DOW_LABELS[(new Date(date + 'T12:00:00').getDay() + 6) % 7];
  const selectedDowFull = DOW_FULL[(new Date(date + 'T12:00:00').getDay() + 6) % 7];
  const maxMid          = Math.max(...Object.values(weekResults).map(r => r.mid), 1);
  const costs           = CONCEPT_COSTS[concept] ?? CONCEPT_COSTS['Other'];
  const pricing         = CONCEPT_PRICING[concept] ?? CONCEPT_PRICING['Other'];
  const bestNights      = CONCEPT_BEST_NIGHTS[concept] ?? ['Thursday', 'Friday', 'Saturday'];
  const drinks          = CONCEPT_DRINKS[concept] ?? [];
  const isGoodNight     = bestNights.includes(selectedDowFull);

  const msSet = (field: keyof ManualSignals) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setManualSignals(s => ({ ...s, [field]: e.target.value }));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Event Intelligence</h1>
        <p className="text-sm text-warm-400 mt-1">
          Validate your concept with live weather + Reddit data before you book.
        </p>
      </div>

      {/* ── Input card ── */}
      <div className="bg-warm-800 rounded-xl border border-warm-600 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal" />
          <h3 className="text-base font-semibold text-white">Event Setup</h3>
          <span className="ml-auto text-[10px] text-warm-500">Runs entirely in browser</span>
        </div>

        {/* Concept */}
        <div>
          <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Event Type</label>
          <select value={concept} onChange={e => setConcept(e.target.value)}
            className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70">
            {CONCEPT_TYPES.map(ct => <option key={ct} value={ct}>{CONCEPT_EMOJIS[ct]} {ct}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-warm-300 mb-1.5 flex items-center gap-1 font-medium uppercase tracking-wide">
              <MapPin className="w-3 h-3" /> City
            </label>
            <input type="text" placeholder="e.g. Houston" value={city} onChange={e => setCity(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white placeholder-warm-500 focus:outline-none focus:border-teal/70" />
          </div>
          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Event Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70" />
          </div>
          <div>
            <label className="text-xs text-warm-300 mb-1.5 flex items-center gap-1 font-medium uppercase tracking-wide">
              <Users className="w-3 h-3" /> Capacity
            </label>
            <input type="number" min={10} value={capacity} onChange={e => setCapacity(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70" />
          </div>
          <div>
            <label className="text-xs text-warm-300 mb-1.5 block font-medium uppercase tracking-wide">Cover Charge ($)</label>
            <input type="number" min={0} placeholder="0" value={cover} onChange={e => setCover(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white placeholder-warm-500 focus:outline-none focus:border-teal/70" />
          </div>
        </div>

        {/* Weather — manual selector only when outside forecast window or auto off */}
        {withinForecastWindow() ? (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoWeather} onChange={e => setAutoWeather(e.target.checked)}
              className="rounded border-warm-500 bg-warm-700 text-teal focus:ring-teal/50" />
            <span className="text-xs text-warm-400">
              Auto-fetch live weather from Open-Meteo {city ? `for ${city}` : '(enter city above)'}
            </span>
          </label>
        ) : (
          <div>
            <label className="text-xs text-warm-300 mb-1.5 flex items-center gap-1 font-medium uppercase tracking-wide">
              <CloudRain className="w-3 h-3" /> Expected Weather
              <span className="text-warm-600 font-normal ml-1">(beyond 16-day forecast window)</span>
            </label>
            <select value={weatherRisk} onChange={e => setWeatherRisk(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70">
              {WEATHER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        {withinForecastWindow() && !autoWeather && (
          <div>
            <label className="text-xs text-warm-300 mb-1.5 flex items-center gap-1 font-medium uppercase tracking-wide">
              <CloudRain className="w-3 h-3" /> Expected Weather (manual)
            </label>
            <select value={weatherRisk} onChange={e => setWeatherRisk(e.target.value)}
              className="w-full bg-warm-700 border border-warm-500 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-teal/70">
              {WEATHER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {/* Signal Boosters */}
        <div className="border border-warm-600 rounded-lg overflow-hidden">
          <button onClick={() => setShowManual(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-warm-700/50 transition-colors">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-warm-500" />
              <span className="text-sm font-medium text-warm-300">Signal Boosters</span>
              <span className="text-[10px] text-warm-600 bg-warm-700/80 px-1.5 py-0.5 rounded-full">optional · up to +65 pts</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-warm-500 transition-transform ${showManual ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showManual && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                transition={{ duration: 0.2 }} className="overflow-hidden border-t border-warm-600">
                <div className="p-4 space-y-4">
                  <p className="text-[10px] text-warm-500">
                    Enter any real-audience data you have. Each verified signal adds to your score.
                  </p>

                  {/* RSVP signals */}
                  <div>
                    <p className="text-[10px] text-warm-400 uppercase tracking-wide font-medium mb-2">
                      RSVPs <span className="text-teal">· up to +15 pts</span>
                      <span className="text-warm-600 ml-1 font-normal normal-case">
                        paid: 92% show · free guestlist: 40% show · Facebook: ~8% (Glue Up / Eventbrite research)
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-warm-400 mb-1 block">RSVP Type</label>
                        <select
                          value={manualSignals.rsvp_type}
                          onChange={e => setManualSignals(s => ({ ...s, rsvp_type: e.target.value as ManualSignals['rsvp_type'] }))}
                          className="w-full bg-warm-700 border border-warm-600 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-teal/70">
                          <option value="paid">Paid ticket / cover ($20+)</option>
                          <option value="free">Free guestlist RSVP</option>
                          <option value="facebook">Facebook "Going" click</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-warm-400 mb-1 block">RSVP Count</label>
                        <input type="number" min="0" placeholder="e.g. 85"
                          value={manualSignals.rsvp_count} onChange={msSet('rsvp_count')}
                          className="w-full bg-warm-700 border border-warm-600 rounded-lg px-2.5 py-2 text-xs text-white placeholder-warm-600 focus:outline-none focus:border-teal/70" />
                        {manualSignals.rsvp_count && (() => {
                          const r = parseInt(manualSignals.rsvp_count);
                          const c = parseInt(capacity) || 150;
                          if (isNaN(r) || r <= 0) return null;
                          const ratio = r / c;
                          const showRate = manualSignals.rsvp_type === 'paid' ? 0.92 : manualSignals.rsvp_type === 'free' ? 0.40 : 0.08;
                          const est = Math.round(r * showRate);
                          return <p className="text-[10px] mt-1 text-warm-500">~{est} expected through door ({(ratio * 100).toFixed(0)}% of capacity)</p>;
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Lead time */}
                  <div>
                    <p className="text-[10px] text-warm-400 uppercase tracking-wide font-medium mb-2">
                      Announcement Lead Time <span className="text-teal">· up to +8 pts</span>
                      <span className="text-warm-600 ml-1 font-normal normal-case">
                        sweet spot: 21-42 days · under 7 days = ~50% fewer online sales (Eugene Loj / Eventbrite NIVA '24)
                      </span>
                    </p>
                    <div>
                      <label className="text-[10px] text-warm-400 mb-1 block">Days between first public announcement and event date</label>
                      <input type="number" min="0" placeholder="e.g. 21"
                        value={manualSignals.lead_time_days} onChange={msSet('lead_time_days')}
                        className="w-full bg-warm-700 border border-warm-600 rounded-lg px-2.5 py-2 text-xs text-white placeholder-warm-600 focus:outline-none focus:border-teal/70" />
                      {manualSignals.lead_time_days && (() => {
                        const d = parseInt(manualSignals.lead_time_days);
                        if (isNaN(d)) return null;
                        const hint = d >= 21 && d <= 42
                          ? { text: '✓ Ideal window · +8 pts', color: 'text-green-400' }
                          : d > 42
                          ? { text: 'Good awareness — send reminders at 2 weeks and 48 hours · +4 pts', color: 'text-teal' }
                          : d >= 14
                          ? { text: '2 weeks — workable, 21+ days gives more ticket velocity · +5 pts', color: 'text-yellow-400' }
                          : d >= 7
                          ? { text: '57% of tickets sell in the final week anyway, but late start limits ceiling · +2 pts', color: 'text-amber-400' }
                          : { text: '⚠ Under 7 days — promotions this late see ~50% fewer online sales · +0 pts', color: 'text-red-400' };
                        return <p className={`text-[10px] mt-1 ${hint.color}`}>{hint.text}</p>;
                      })()}
                    </div>
                  </div>

                  {/* Social / ad signals */}
                  <div>
                    <p className="text-[10px] text-warm-400 uppercase tracking-wide font-medium mb-2">
                      Social &amp; Ad Signals <span className="text-teal">· up to +50 pts</span>
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { field: 'meta_cpc_a' as keyof ManualSignals, label: 'Meta Ad CPC — Concept A ($)', placeholder: 'e.g. 0.45' },
                        { field: 'meta_cpc_b' as keyof ManualSignals, label: 'Meta Ad CPC — Concept B ($)', placeholder: 'e.g. 0.72' },
                        { field: 'tiktok_save_rate' as keyof ManualSignals, label: 'TikTok Save Rate (%)', placeholder: 'e.g. 1.2' },
                        { field: 'ig_dm_count' as keyof ManualSignals, label: 'Instagram DM count', placeholder: 'e.g. 12' },
                        { field: 'ig_poll_pct' as keyof ManualSignals, label: 'IG Poll — "Yes" % (0-100)', placeholder: 'e.g. 72' },
                        { field: 'eventbrite_pct' as keyof ManualSignals, label: 'Eventbrite sold in 48h (%)', placeholder: 'e.g. 18' },
                      ].map(({ field, label, placeholder }) => (
                        <div key={field}>
                          <label className="text-[10px] text-warm-400 mb-1 block">{label}</label>
                          <input type="number" step="0.01" min="0" placeholder={placeholder}
                            value={manualSignals[field] as string} onChange={msSet(field)}
                            className="w-full bg-warm-700 border border-warm-600 rounded-lg px-2.5 py-2 text-xs text-white placeholder-warm-600 focus:outline-none focus:border-teal/70" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button onClick={runAnalysis} disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 bg-teal/20 border border-teal/50 text-teal hover:bg-teal/30 rounded-lg font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed">
          {loading
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> {loadPhase || 'Analyzing…'}</>
            : <><Zap className="w-4 h-4" /> Run Full Analysis</>}
        </button>
      </div>

      {/* ── Results ── */}
      <AnimatePresence>
        {composite && attendance && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-3">

            {/* Validation Score */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <div className="p-4">
                <div className="flex items-start gap-4">
                  <ScoreRing score={composite.score} verdict={composite.verdict} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-warm-500 uppercase tracking-wide mb-1">Validation Score</p>
                    <p className={`text-base font-bold leading-snug ${
                      composite.verdict === 'green' ? 'text-green-400' :
                      composite.verdict === 'yellow' ? 'text-yellow-400' : 'text-red-400'
                    }`}>{composite.verdict_text}</p>
                    {!isGoodNight && (
                      <p className="text-[10px] text-amber-400 mt-1.5">
                        ⚠ {selectedDowFull} not optimal — best nights: {bestNights.join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Score bar breakdown */}
                <div className="mt-3 flex gap-0.5 h-2 rounded-full overflow-hidden">
                  <div className="bg-blue-400/80" style={{ width: `${Math.max(0, composite.trends_pts)}%` }} />
                  <div className={composite.weather_pts < 0 ? 'bg-red-500/80' : 'bg-teal/70'} style={{ width: `${Math.abs(composite.weather_pts)}%` }} />
                  <div className="bg-purple-400/80" style={{ width: `${composite.reddit_pts}%` }} />
                  <div className="bg-green-400/80" style={{ width: `${composite.manual_pts}%` }} />
                  <div className="flex-1 bg-warm-700/50 rounded-r-full" />
                </div>
                <div className="flex gap-3 mt-1.5 flex-wrap text-[10px]">
                  <span className="text-blue-400">Market +{composite.trends_pts}</span>
                  <span className={composite.weather_pts < 0 ? 'text-red-400' : 'text-teal'}>
                    Weather {composite.weather_pts > 0 ? '+' : ''}{composite.weather_pts}
                  </span>
                  <span className="text-purple-400">Reddit +{composite.reddit_pts}</span>
                  <span className="text-green-400">Signals +{composite.manual_pts}</span>
                </div>
              </div>

              {composite.notes.length > 0 && (
                <div className="border-t border-whoop-divider px-4 py-3 space-y-1.5">
                  {composite.notes.map((note, i) => (
                    <p key={i} className="text-xs text-warm-300">{note}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Data Signals */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-whoop-divider">
                <span className="text-sm font-semibold text-white">Data Signals</span>
              </div>
              <div className="px-4">
                <DataLayer
                  icon={TrendingUp}
                  label="Market Demand (Baseline)"
                  value={`${CONCEPT_MARKET_DEMAND[concept] ?? 50}/100`}
                  sub={`Pre-calibrated demand score for ${concept} · Google Trends not browser-accessible`}
                  color={(CONCEPT_MARKET_DEMAND[concept] ?? 50) >= 65 ? 'text-green-400' : (CONCEPT_MARKET_DEMAND[concept] ?? 50) >= 45 ? 'text-yellow-400' : 'text-red-400'}
                  pts={composite.trends_pts}
                />
                <DataLayer
                  icon={CloudRain}
                  label="Weather Forecast"
                  value={weather?.forecast_available
                    ? `${weather.temp_high_f}°F high / ${weather.temp_low_f}°F low · ${weather.precip_inches}" precip`
                    : weather?.risk && weather.risk !== 'unknown'
                      ? `Manual: ${weather.risk} risk`
                      : 'Unavailable'}
                  sub={weather?.forecast_available
                    ? `Risk: ${weather.risk} · Attendance impact: ${weather.attendance_impact}`
                    : !city ? 'Enter city for live forecast' : !withinForecastWindow() ? 'Date beyond 16-day window' : 'Live forecast fetch failed'}
                  color={weather?.risk === 'high' ? 'text-red-400' : weather?.risk === 'moderate' ? 'text-yellow-400' : 'text-green-400'}
                  pts={composite.weather_pts}
                  loading={loading && !weather}
                />
                <DataLayer
                  icon={MessageCircle}
                  label="Reddit Demand"
                  value={reddit ? `${reddit.mentions} posts · ${reddit.sentiment_label} sentiment` : '—'}
                  sub={reddit?.top_posts[0]?.title ?? (reddit?.error ? `Error: ${reddit.error}` : '')}
                  color={reddit?.sentiment_label === 'positive' ? 'text-green-400' : reddit?.sentiment_label === 'negative' ? 'text-red-400' : 'text-warm-300'}
                  pts={composite.reddit_pts}
                  loading={loading && !reddit}
                />
                {composite.manual_pts > 0 && (
                  <DataLayer
                    icon={BarChart2}
                    label="Manual Signals"
                    value={`${composite.manual_pts} / 50 pts from A/B test data`}
                    color="text-green-400"
                    pts={composite.manual_pts}
                  />
                )}
              </div>
            </div>

            {/* Attendance Forecast */}
            <div className="bg-whoop-panel border border-teal/30 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
                <Users className="w-4 h-4 text-teal" />
                <span className="text-sm font-semibold text-white">Attendance Forecast</span>
                <span className="ml-auto text-[10px] text-warm-500 bg-warm-800 px-2 py-0.5 rounded-full">
                  Multiplier Model · DOW × Seasonality × Event Lift
                </span>
              </div>
              <div className="p-4 space-y-3">
                {(() => {
                  const scale = attendance.high > 0 ? 85 / attendance.high : 1;
                  return (
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <div className="flex justify-between text-[10px] text-warm-500 mb-1">
                          <span>Low</span><span>Most Likely</span><span>High</span>
                        </div>
                        <div className="relative h-8 bg-warm-800 rounded-lg overflow-hidden">
                          <div className="absolute inset-y-0 left-0 bg-teal/15 rounded-lg"
                            style={{ width: `${Math.min(100, attendance.high * scale)}%` }} />
                          <div className="absolute inset-y-0 left-0 bg-teal/35 rounded-lg"
                            style={{ width: `${Math.min(100, attendance.mid * scale)}%` }} />
                          <div className="absolute inset-y-0 left-0 bg-teal/70 rounded-lg"
                            style={{ width: `${Math.min(100, attendance.low * scale)}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] font-semibold text-white mt-1">
                          <span>{attendance.low}</span>
                          <span className="text-teal text-base">{attendance.mid} people</span>
                          <span>{attendance.high}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-warm-500">Fill Rate</p>
                        <p className="text-xl font-bold text-teal">{attendance.fill_rate_pct}%</p>
                      </div>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Conservative', value: `$${attendance.revenue_low.toLocaleString()}`  },
                    { label: 'Expected',     value: `$${attendance.revenue_mid.toLocaleString()}`  },
                    { label: 'Best Case',    value: `$${attendance.revenue_high.toLocaleString()}` },
                  ].map(m => (
                    <div key={m.label} className="bg-warm-800/60 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-warm-500">{m.label}</p>
                      <p className="text-sm font-bold text-green-400">{m.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-warm-500">
                  Bar spend: ${attendance.avg_spend_low}–${attendance.avg_spend_high}/head (industry benchmark for {concept})
                  {parseFloat(cover) > 0 ? ` + $${cover} cover` : ''}.
                </p>
              </div>
            </div>

            {/* Factor breakdown */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <button onClick={() => setShowFactors(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-warm-800/50 transition-colors">
                <span className="text-sm font-semibold text-white">Attendance Factors</span>
                <ChevronDown className={`w-4 h-4 text-warm-500 transition-transform ${showFactors ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {showFactors && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                    className="overflow-hidden border-t border-whoop-divider">
                    <div className="px-4 pb-4 pt-2 space-y-2">
                      {(Object.entries(attendance.factors) as [string, number][]).map(([key, val]) => {
                        const labels: Record<string, string> = {
                          base_fill_55pct: 'Base (55% fill)', day_of_week_multiplier: 'Day of week',
                          month_seasonality: 'Month seasonality', event_type_lift: 'Event type lift',
                          holiday_factor: 'Holiday factor', weather_penalty: 'Weather penalty',
                        };
                        const isBase = key === 'base_fill_55pct';
                        const color = isBase ? 'text-warm-300' : val > 1.0 ? 'text-green-400' : val < 0.9 ? 'text-amber-400' : 'text-warm-400';
                        return (
                          <div key={key} className="flex justify-between py-1 border-b border-warm-700/40 last:border-0">
                            <span className="text-xs text-warm-400">{labels[key] || key}</span>
                            <span className={`text-xs font-mono font-semibold ${color}`}>
                              {isBase ? `${val} guests` : `×${val.toFixed(2)}`}
                            </span>
                          </div>
                        );
                      })}
                      <p className="text-[10px] text-warm-600 pt-1">mid = base × DOW × month × event lift × holiday × weather</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Best Night Comparison */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-whoop-divider">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-warm-400" />
                  <span className="text-sm font-semibold text-white">Best Night This Week</span>
                </div>
                {Object.keys(weekResults).length === 0 ? (
                  <button onClick={runWeekComparison} className="text-xs text-teal hover:text-teal/80 transition-colors">
                    Compare all 7 days →
                  </button>
                ) : (
                  <button onClick={runWeekComparison} className="text-[10px] text-warm-500 hover:text-warm-300">↺</button>
                )}
              </div>
              {Object.keys(weekResults).length === 0 ? (
                <p className="text-xs text-warm-500 px-4 py-3">
                  See which night maximizes attendance for {CONCEPT_EMOJIS[concept]} {concept}.
                  Industry best nights: {bestNights.join(', ')}.
                </p>
              ) : (
                <div className="px-4 py-3 space-y-2">
                  {DOW_LABELS.map((day, i) => {
                    const r = weekResults[day];
                    if (!r) return null;
                    const pct = r.mid / maxMid * 100;
                    const isSelected = day === selectedDow;
                    const isBest = r.mid === maxMid;
                    const isRec = bestNights.includes(DOW_FULL[i]);
                    return (
                      <div key={day} className={`flex items-center gap-3 ${isSelected || isBest || isRec ? '' : 'opacity-40'}`}>
                        <span className={`text-xs w-7 font-medium ${isSelected ? 'text-white' : isBest ? 'text-teal' : 'text-warm-500'}`}>{day}</span>
                        <div className="flex-1 h-5 bg-warm-800 rounded overflow-hidden">
                          <motion.div
                            className={`h-full rounded ${isSelected ? 'bg-teal/70' : isBest ? 'bg-teal/40' : isRec ? 'bg-teal/20' : 'bg-warm-600/50'}`}
                            initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }} />
                        </div>
                        <span className={`text-xs font-mono w-8 text-right ${isSelected ? 'text-white font-semibold' : 'text-warm-500'}`}>{r.mid}</span>
                        <span className="text-[10px] w-10 text-right text-warm-500">{r.fill_rate_pct}%</span>
                        <div className="w-8 text-right">
                          {isBest && !isSelected && <span className="text-[10px] text-teal font-medium">best</span>}
                          {isRec && !isBest && <span className="text-[9px] text-green-400/70">✓</span>}
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-warm-600 pt-1">✓ = industry-recommended night for {concept}</p>
                </div>
              )}
            </div>

            {/* Revenue Estimate */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className="text-sm font-semibold text-white">Revenue Estimate</span>
              </div>
              <div className="p-4 space-y-3">
                {(() => {
                  const cap = parseInt(capacity) || 150;
                  const cov = parseFloat(cover) || 0;
                  const [spLow, spHigh] = BAR_SPEND_PER_HEAD[concept] ?? [14, 28];
                  const attLow = Math.round(cap * 0.55), attHigh = Math.round(cap * 0.90);
                  const grossLow  = attLow  * (cov + spLow);
                  const grossHigh = attHigh * (cov + spHigh);
                  const netLow    = grossLow  - costs.high;
                  const netHigh   = grossHigh - costs.low;
                  return (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-warm-800/60 rounded-lg p-3">
                          <p className="text-[10px] text-warm-500 mb-1">Gross Revenue Range</p>
                          <p className="text-sm font-bold text-green-400">
                            ${Math.round(grossLow).toLocaleString()} – ${Math.round(grossHigh).toLocaleString()}
                          </p>
                        </div>
                        <div className="bg-warm-800/60 rounded-lg p-3">
                          <p className="text-[10px] text-warm-500 mb-1">Net (after setup costs)</p>
                          <p className={`text-sm font-bold ${netLow < 0 ? 'text-red-400' : 'text-green-400'}`}>
                            ${Math.round(netLow).toLocaleString()} – ${Math.round(netHigh).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 text-[11px] text-warm-400">
                        <span>Bar spend: ${spLow}–${spHigh}/head</span>
                        {cov > 0 && <span>Cover: ${cov}/person</span>}
                        {pricing.vip_table_min && (
                          <span>VIP table min: ${pricing.vip_table_min[0]}–${pricing.vip_table_min[1]}</span>
                        )}
                        <span>Attendance: {attLow}–{attHigh} ({Math.round(attLow/cap*100)}–{Math.round(attHigh/cap*100)}% fill)</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Setup Guide */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
                <BadgeDollarSign className="w-4 h-4 text-warm-400" />
                <span className="text-sm font-semibold text-white">Setup Guide</span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-warm-400">Typical Setup Cost</span>
                  <span className="text-sm font-semibold text-white">
                    ${costs.low.toLocaleString()} – ${costs.high.toLocaleString()}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {costs.items.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-warm-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-warm-600 flex-shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="border-t border-warm-700 pt-3">
                  <p className="text-[10px] text-warm-500 mb-1">Cover Charge Guidance</p>
                  <p className="text-sm text-warm-300">
                    {pricing.cover[0] === 0 && pricing.cover[1] === 0
                      ? 'Free entry (revenue from bar spend only)'
                      : `$${pricing.cover[0]}–$${pricing.cover[1]} / person`}
                  </p>
                </div>
              </div>
            </div>

            {/* Recommended Drinks */}
            <div className="bg-whoop-panel border border-whoop-divider rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-whoop-divider">
                <Star className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-white">Recommended Drinks</span>
                <span className="ml-auto text-[10px] text-warm-500">Menu engineering data</span>
              </div>
              <div className="p-4 grid grid-cols-2 gap-2">
                {drinks.map((drink, i) => (
                  <div key={i} className="flex items-center gap-2 bg-warm-800/60 rounded-lg px-3 py-2">
                    <span className="text-amber-400 text-xs flex-shrink-0">★</span>
                    <span className="text-xs text-warm-300">{drink}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Model info */}
            <div className="flex items-start gap-2 px-3 py-2.5 bg-warm-800/40 border border-warm-700 rounded-lg">
              <BadgeDollarSign className="w-4 h-4 text-warm-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-warm-400">Industry multiplier model — day-of-week × seasonality × event lift × weather</p>
                <p className="text-[10px] text-warm-500 mt-0.5">
                  Run VenueScope People Counter on 30+ live events to unlock venue-specific ML forecast.
                </p>
              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Forecast;
