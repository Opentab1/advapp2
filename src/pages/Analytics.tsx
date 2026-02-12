/**
 * Analytics Page - Results Report
 * 
 * This is where bar owners come to see RESULTS.
 * Not abstract scores - real numbers with context.
 * 
 * Structure:
 * 1. Period Summary - Total guests, avg stay, peak hours
 * 2. Daily Breakdown - Table with each day's performance
 * 3. Hourly Heatmap - Visual of busy hours
 * 4. Guest Trend - Line chart over time
 * 5. Environment Summary - Sound, light, crowd conditions
 * 6. Song Analytics - Merged from Songs tab
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  RefreshCw, Download, Calendar, Clock, Music, Volume2, Users, TrendingUp, TrendingDown,
  Zap, ListMusic, ChevronDown, Disc3, FileText, FileJson, ShieldCheck
} from 'lucide-react';
import { format } from 'date-fns';
import songLogService, { 
  PerformingSong, 
  PlaylistSong, 
  GenreStats, 
  AnalyticsTimeRange 
} from '../services/song-log.service';
import type { SongLogEntry } from '../types';
import {
  PeriodSummary,
  DailyBreakdown,
  RawMetrics,
  EnvironmentalSummary,
  GuestsTrend,
  TimeRangePicker,
  RawDataView,
} from '../components/analytics';
import { PullToRefresh } from '../components/common/PullToRefresh';
import { ErrorState } from '../components/common/LoadingState';
import { useInsightsData } from '../hooks/useInsightsData';
import { useDisplayName } from '../hooks/useDisplayName';
import apiService from '../services/api.service';
import authService from '../services/auth.service';
import { haptic } from '../utils/haptics';
import type { InsightsTimeRange, MetricType } from '../types/insights';

export function Analytics() {
  const user = authService.getStoredUser();
  const { displayName } = useDisplayName();
  const venueName = displayName || user?.venueName || 'Venue';
  
  const [timeRange, setTimeRange] = useState<InsightsTimeRange>('7d');
  const [showRawData, setShowRawData] = useState(false);
  const [rawDataMetric, setRawDataMetric] = useState<MetricType>('score');
  
  const insights = useInsightsData(timeRange);
  
  // Song Analytics State
  const [songs, setSongs] = useState<SongLogEntry[]>([]);
  const [topSongs, setTopSongs] = useState<Array<{ song: string; artist: string; plays: number }>>([]);
  const [genreStats, setGenreStats] = useState<GenreStats[]>([]);
  const [highestPerforming, setHighestPerforming] = useState<PerformingSong[]>([]);
  const [topPerformersPlaylist, setTopPerformersPlaylist] = useState<PlaylistSong[]>([]);
  const [songsLoading, setSongsLoading] = useState(true);
  const [songTimeRange, setSongTimeRange] = useState<AnalyticsTimeRange>('30d');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [totalSongs, setTotalSongs] = useState(0);
  const [showSongAnalytics, setShowSongAnalytics] = useState(true);
  
  // Load songs data
  const loadSongs = useCallback(async () => {
    setSongsLoading(true);
    try {
      const allSongs = await songLogService.getAllSongs();
      setSongs(allSongs.slice(0, 200));
      setTotalSongs(allSongs.length);
      
      const top = await songLogService.getTopSongsFromAll(10);
      setTopSongs(top);
    } catch (error) {
      console.error('Error loading songs:', error);
    } finally {
      setSongsLoading(false);
    }
  }, []);
  
  // Load song analytics
  const loadSongAnalytics = useCallback(async (range: AnalyticsTimeRange) => {
    try {
      const performing = await songLogService.getHighestPerformingSongs(10, range);
      setHighestPerforming(performing);
      
      const playlist = await songLogService.getTopPerformersPlaylist(20, range);
      setTopPerformersPlaylist(playlist);
      
      const genres = await songLogService.getGenreStats(10, range);
      setGenreStats(genres);
    } catch (error) {
      console.error('Error loading song analytics:', error);
    }
  }, []);
  
  useEffect(() => {
    loadSongs();
  }, [loadSongs]);
  
  useEffect(() => {
    if (!songsLoading) {
      loadSongAnalytics(songTimeRange);
    }
  }, [songTimeRange, songsLoading, loadSongAnalytics]);
  
  const handleExportPlaylist = async (format: 'csv' | 'txt' | 'json') => {
    await songLogService.exportPlaylist(format, songTimeRange, venueName);
    setShowExportMenu(false);
  };
  
  // Get raw sensor data for the detailed components
  const rawSensorData = insights.rawData.map(d => ({
    timestamp: d.timestamp.toISOString(),
    decibels: d.decibels,
    light: d.light,
    indoorTemp: d.temperature,
    outdoorTemp: d.temperature,
    occupancy: {
      current: d.occupancy,
      entries: 0, // Not available in RawDataPoint
      exits: 0,
    },
  }));
  
  const handleRefresh = async () => {
    haptic('medium');
    await insights.refresh();
  };
  
  const handleExportCSV = () => {
    haptic('medium');
    if (insights.rawData.length > 0) {
      const exportData = insights.rawData.map(d => ({
        timestamp: d.timestamp.toISOString(),
        score: d.score,
        decibels: d.decibels,
        light: d.light,
        temperature: d.temperature,
        occupancy: d.occupancy,
      }));
      apiService.exportToCSV(exportData as any, true, venueName);
    }
  };
  
  if (insights.error && !insights.summary) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">Results</h1>
          <TimeRangePicker value={timeRange} onChange={setTimeRange} loading={insights.loading} />
        </div>
        <ErrorState 
          title="Couldn't load data" 
          message={insights.error} 
          onRetry={handleRefresh} 
        />
      </div>
    );
  }
  
  return (
    <>
      <PullToRefresh onRefresh={handleRefresh} disabled={insights.loading}>
        <div className="space-y-6 pb-24">
          
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-white">Results</h1>
            
            <div className="flex items-center gap-2">
              {/* Refresh */}
              <motion.button
                onClick={handleRefresh}
                disabled={insights.loading}
                className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors"
                whileTap={{ scale: 0.95 }}
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${insights.loading ? 'animate-spin' : ''}`} />
              </motion.button>
              
              {/* Export */}
              <motion.button
                onClick={handleExportCSV}
                disabled={insights.loading || insights.rawData.length === 0}
                className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors disabled:opacity-50"
                whileTap={{ scale: 0.95 }}
                title="Export CSV"
              >
                <Download className="w-4 h-4" />
              </motion.button>
              
              {/* Raw Data */}
              <motion.button
                onClick={() => { haptic('light'); setShowRawData(true); }}
                disabled={insights.loading}
                className="p-2 rounded-lg bg-warm-800 border border-warm-700 text-warm-400 hover:text-white transition-colors"
                whileTap={{ scale: 0.95 }}
                title="View Raw Data"
              >
                <Calendar className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
          
          {/* Time Range Picker */}
          <TimeRangePicker 
            value={timeRange} 
            onChange={setTimeRange} 
            loading={insights.loading} 
          />
          
          {/* Period Summary - THE NUMBERS */}
          <PeriodSummary 
            summary={insights.summary}
            trend={insights.trend}
            timeRange={timeRange}
            loading={insights.loading}
          />
          
          {/* Historical Retention Analysis */}
          <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-warm-800/50 rounded-xl p-5 border border-warm-700"
            >
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Guest Retention Analysis
              </h2>
              
              {/* Time Period Selector */}
              <div className="flex gap-2 mb-5 overflow-x-auto pb-2">
                {['Last Saturday 8PM', 'Last Friday 10PM', 'Last Saturday 11PM', 'Last Sunday 6PM'].map((period, idx) => (
                  <button
                    key={period}
                    className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all ${
                      idx === 0 
                        ? 'bg-primary text-white' 
                        : 'bg-warm-700 text-warm-300 hover:bg-warm-600'
                    }`}
                  >
                    {period}
                  </button>
                ))}
              </div>
              
              {/* Retention Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                <div className="bg-warm-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-primary">78%</div>
                  <div className="text-xs text-warm-400 mt-1">Retention Rate</div>
                  <div className="flex items-center justify-center gap-1 mt-2 text-green-400 text-xs">
                    <TrendingUp className="w-3 h-3" />
                    <span>+5% vs avg</span>
                  </div>
                </div>
                <div className="bg-warm-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-white">342</div>
                  <div className="text-xs text-warm-400 mt-1">Total Guests</div>
                  <div className="flex items-center justify-center gap-1 mt-2 text-green-400 text-xs">
                    <TrendingUp className="w-3 h-3" />
                    <span>+12% vs week prior</span>
                  </div>
                </div>
                <div className="bg-warm-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-white">94</div>
                  <div className="text-xs text-warm-400 mt-1">Avg Stay (min)</div>
                  <div className="flex items-center justify-center gap-1 mt-2 text-warm-400 text-xs">
                    <span>Target: 90 min</span>
                  </div>
                </div>
                <div className="bg-warm-700/50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-white">$58</div>
                  <div className="text-xs text-warm-400 mt-1">Avg Spend/Guest</div>
                  <div className="flex items-center justify-center gap-1 mt-2 text-green-400 text-xs">
                    <TrendingUp className="w-3 h-3" />
                    <span>+$4 vs avg</span>
                  </div>
                </div>
              </div>
              
              {/* Sound & Music Section */}
              <div className="border-t border-warm-600 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-warm-300 mb-3 flex items-center gap-2">
                  <Volume2 className="w-4 h-4" />
                  Sound Profile That Night
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-warm-700/30 rounded-lg p-3">
                    <div className="text-xl font-bold text-white">76 dB</div>
                    <div className="text-xs text-warm-400">Avg Sound Level</div>
                    <div className="text-[10px] text-warm-500 mt-1">Optimal range: 70-80 dB</div>
                  </div>
                  <div className="bg-warm-700/30 rounded-lg p-3">
                    <div className="text-xl font-bold text-white">85 dB</div>
                    <div className="text-xs text-warm-400">Peak at 11:30 PM</div>
                    <div className="text-[10px] text-warm-500 mt-1">During DJ set</div>
                  </div>
                </div>
              </div>
              
              {/* Top Songs Section */}
              <div className="border-t border-warm-600 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-warm-300 mb-3 flex items-center gap-2">
                  <Music className="w-4 h-4" />
                  Top Songs That Night
                </h3>
                <div className="space-y-2">
                  {[
                    { song: 'Ms. Jackson', artist: 'Outkast', plays: 3, peakCrowd: true },
                    { song: 'Blinding Lights', artist: 'The Weeknd', plays: 2, peakCrowd: false },
                    { song: 'Levitating', artist: 'Dua Lipa', plays: 2, peakCrowd: true },
                    { song: 'Uptown Funk', artist: 'Bruno Mars', plays: 2, peakCrowd: false },
                    { song: 'Don\'t Start Now', artist: 'Dua Lipa', plays: 1, peakCrowd: true },
                  ].map((track, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-warm-700/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="text-warm-500 text-sm w-5">{idx + 1}</span>
                        <div>
                          <div className="text-sm text-white">{track.song}</div>
                          <div className="text-xs text-warm-400">{track.artist}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {track.peakCrowd && (
                          <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded">Peak Crowd</span>
                        )}
                        <span className="text-xs text-warm-400">{track.plays}x</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Insight */}
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mt-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">Key Insight</div>
                    <div className="text-xs text-warm-300 mt-1">
                      When Outkast and Dua Lipa played during peak hours, guest retention increased by 23%. 
                      Consider scheduling similar high-energy tracks between 10-11 PM on Saturdays.
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          
          {/* Guest Trend Chart */}
          <GuestsTrend 
            data={rawSensorData as any}
            loading={insights.loading}
          />
          
          {/* Daily Breakdown Table */}
          <DailyBreakdown 
            data={rawSensorData as any}
            loading={insights.loading}
          />
          
          {/* Raw Metrics - entries, exits, dB, lux, score, top songs */}
          <RawMetrics 
            data={rawSensorData as any}
            loading={insights.loading}
          />
          
          {/* Environmental Summary */}
          <EnvironmentalSummary 
            data={rawSensorData as any}
            loading={insights.loading}
          />
          
          {/* Song Analytics Section */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-warm-800/50 rounded-xl border border-warm-700 overflow-hidden"
          >
            {/* Section Header */}
            <button
              onClick={() => setShowSongAnalytics(!showSongAnalytics)}
              className="w-full flex items-center justify-between p-5 hover:bg-warm-700/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Music className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-white">Song Analytics</h2>
                <span className="text-xs text-warm-400 bg-warm-700 px-2 py-0.5 rounded">
                  {totalSongs.toLocaleString()} songs tracked
                </span>
              </div>
              <ChevronDown className={`w-5 h-5 text-warm-400 transition-transform ${showSongAnalytics ? 'rotate-180' : ''}`} />
            </button>
            
            <AnimatePresence>
              {showSongAnalytics && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="p-5 pt-0 space-y-6">
                    {/* Song Time Range Selector */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-1 bg-warm-700 rounded-lg p-1">
                        {(['7d', '14d', '30d'] as AnalyticsTimeRange[]).map((range) => (
                          <motion.button
                            key={range}
                            onClick={() => setSongTimeRange(range)}
                            className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                              songTimeRange === range
                                ? 'bg-primary/20 text-primary border border-cyan/30'
                                : 'text-warm-400 hover:text-white hover:bg-warm-800'
                            }`}
                            whileTap={{ scale: 0.95 }}
                          >
                            {range}
                          </motion.button>
                        ))}
                      </div>
                      
                      <motion.button
                        onClick={() => { songLogService.clearCache(); loadSongs(); }}
                        disabled={songsLoading}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-warm-700 rounded-lg text-warm-400 hover:text-white transition-colors"
                        whileTap={{ scale: 0.95 }}
                      >
                        <RefreshCw className={`w-4 h-4 ${songsLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </motion.button>
                    </div>
                    
                    {/* Top Performers Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Highest Retention Songs */}
                      <div className="bg-warm-700/50 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                            <h3 className="text-base font-semibold text-white">Highest Retention</h3>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-emerald-400">
                            <TrendingUp className="w-3 h-3" />
                            <span>Real Data</span>
                          </div>
                        </div>
                        <p className="text-xs text-warm-400 mb-3">Songs where crowd stayed or grew</p>
                        
                        <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                          {songsLoading ? (
                            <div className="text-center py-6">
                              <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin mx-auto mb-2" />
                              <p className="text-sm text-warm-400">Calculating retention...</p>
                            </div>
                          ) : highestPerforming.length > 0 ? (
                            highestPerforming.slice(0, 5).map((song, index) => (
                              <motion.div
                                key={`${song.song}-${song.artist}`}
                                className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-emerald-500/10 to-cyan-600/10 border border-emerald-500/20"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.1 + index * 0.05 }}
                              >
                                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-xs">
                                  {index + 1}
                                </div>
                                {song.albumArt ? (
                                  <img src={song.albumArt} alt={song.song} className="w-8 h-8 rounded object-cover" />
                                ) : (
                                  <div className="w-8 h-8 rounded bg-emerald-500/20 flex items-center justify-center">
                                    <Music className="w-4 h-4 text-emerald-400" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-white truncate">{song.song}</div>
                                  <div className="text-xs text-warm-400 truncate">{song.artist}</div>
                                </div>
                                <div className="text-right">
                                  <div className={`text-sm font-bold ${(song.retentionRate ?? 100) >= 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    {(song.retentionRate ?? 100) >= 100 ? '+' : ''}{((song.retentionRate ?? 100) - 100).toFixed(1)}%
                                  </div>
                                  <div className="text-[10px] text-warm-500">{song.plays} plays</div>
                                </div>
                              </motion.div>
                            ))
                          ) : (
                            <div className="text-center py-6 text-warm-400 text-sm">
                              No retention data yet
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Top Performers Playlist */}
                      <div className="bg-warm-700/50 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <ListMusic className="w-5 h-5 text-green-400" />
                            <h3 className="text-base font-semibold text-white">Top Performers</h3>
                          </div>
                          
                          {/* Export Dropdown */}
                          <div className="relative">
                            <button
                              onClick={() => setShowExportMenu(!showExportMenu)}
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
                              disabled={topPerformersPlaylist.length === 0}
                            >
                              <Download className="w-3 h-3" />
                              Export
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            
                            <AnimatePresence>
                              {showExportMenu && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -10 }}
                                  className="absolute right-0 top-full mt-1 bg-warm-800 border border-warm-700 rounded-lg shadow-xl z-10 overflow-hidden"
                                >
                                  <button
                                    onClick={() => handleExportPlaylist('csv')}
                                    className="flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-warm-700 w-full"
                                  >
                                    <FileText className="w-3 h-3 text-green-400" />
                                    Export CSV
                                  </button>
                                  <button
                                    onClick={() => handleExportPlaylist('txt')}
                                    className="flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-warm-700 w-full"
                                  >
                                    <FileText className="w-3 h-3 text-blue-400" />
                                    Export Text
                                  </button>
                                  <button
                                    onClick={() => handleExportPlaylist('json')}
                                    className="flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-warm-700 w-full"
                                  >
                                    <FileJson className="w-3 h-3 text-purple-400" />
                                    Export JSON
                                  </button>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                        <p className="text-xs text-warm-400 mb-3">Crowd-favorite tracks, ready to export</p>
                        
                        <div className="space-y-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                          {songsLoading ? (
                            <div className="text-center py-6">
                              <RefreshCw className="w-6 h-6 text-green-400 animate-spin mx-auto mb-2" />
                              <p className="text-sm text-warm-400">Building playlist...</p>
                            </div>
                          ) : topPerformersPlaylist.length > 0 ? (
                            topPerformersPlaylist.slice(0, 8).map((song, index) => (
                              <motion.div
                                key={`${song.song}-${song.artist}-${index}`}
                                className="flex items-center gap-2 p-2 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 hover:from-green-500/20 hover:to-emerald-500/20 transition-colors"
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.15 + index * 0.03 }}
                              >
                                <div className="w-5 text-center text-green-400 font-mono text-xs">{song.position}</div>
                                {song.albumArt ? (
                                  <img src={song.albumArt} alt={song.song} className="w-7 h-7 rounded object-cover" />
                                ) : (
                                  <div className="w-7 h-7 rounded bg-green-500/20 flex items-center justify-center">
                                    <Music className="w-3 h-3 text-green-400" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-white truncate">{song.song}</div>
                                  <div className="text-[10px] text-warm-400 truncate">{song.artist}</div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span className="text-[10px] text-warm-500">{song.plays}x</span>
                                  <Zap className="w-3 h-3 text-green-400" />
                                  <span className={`text-[10px] ${(song.retentionRate ?? 100) >= 100 ? 'text-green-400' : 'text-amber-400'}`}>
                                    {(song.retentionRate ?? 100) >= 100 ? '+' : ''}{((song.retentionRate ?? 100) - 100).toFixed(1)}%
                                  </span>
                                </div>
                              </motion.div>
                            ))
                          ) : (
                            <div className="text-center py-6 text-warm-400 text-sm">
                              No playlist data yet
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Genres & Most Played Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Top Genres */}
                      <div className="bg-warm-700/50 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Disc3 className="w-5 h-5 text-purple-400" />
                          <h3 className="text-base font-semibold text-white">Top Genres</h3>
                        </div>
                        
                        <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar">
                          {genreStats.length > 0 ? (
                            genreStats.slice(0, 6).map((genre, index) => (
                              <motion.div
                                key={genre.genre}
                                className="p-2 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.2 + index * 0.05 }}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-purple-400 font-bold text-xs">{index + 1}</span>
                                    <span className="text-sm font-medium text-white">{genre.genre}</span>
                                  </div>
                                  <span className="text-purple-400 font-bold text-sm">{genre.plays}</span>
                                </div>
                                {genre.performanceScore > 0 && (
                                  <div className="h-1 bg-purple-500/20 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-gradient-to-r from-purple-400 to-pink-400 rounded-full"
                                      style={{ width: `${genre.performanceScore}%` }}
                                    />
                                  </div>
                                )}
                              </motion.div>
                            ))
                          ) : (
                            <div className="text-center py-6 text-warm-400 text-sm">
                              No genre data yet
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Most Played */}
                      <div className="bg-warm-700/50 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <TrendingUp className="w-5 h-5 text-primary" />
                          <h3 className="text-base font-semibold text-white">Most Played</h3>
                        </div>
                        
                        <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar">
                          {topSongs.length > 0 ? topSongs.slice(0, 6).map((song, index) => (
                            <motion.div
                              key={`${song.song}-${song.artist}`}
                              className="flex items-center justify-between p-2 rounded-lg bg-warm-600/50"
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.2 + index * 0.05 }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-primary font-bold text-xs w-4">{index + 1}</span>
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-white truncate">{song.song}</div>
                                  <div className="text-[10px] text-warm-400 truncate">{song.artist}</div>
                                </div>
                              </div>
                              <div className="text-primary font-bold text-sm flex-shrink-0">{song.plays}x</div>
                            </motion.div>
                          )) : (
                            <div className="text-center py-6 text-warm-400 text-sm">
                              No songs tracked yet
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Recent Plays */}
                      <div className="bg-warm-700/50 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Clock className="w-5 h-5 text-primary" />
                          <h3 className="text-base font-semibold text-white">Recent Plays</h3>
                        </div>
                        
                        <div className="space-y-1.5 max-h-[250px] overflow-y-auto custom-scrollbar">
                          {songs.length > 0 ? songs.slice(0, 8).map((song, index) => (
                            <motion.div
                              key={song.id}
                              className="flex items-center gap-2 p-1.5 rounded-lg bg-warm-600/50"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.3 + index * 0.02 }}
                            >
                              {song.albumArt ? (
                                <img src={song.albumArt} alt={song.songName} className="w-7 h-7 rounded object-cover" />
                              ) : (
                                <div className="w-7 h-7 rounded bg-primary/20 flex items-center justify-center">
                                  <Music className="w-3 h-3 text-primary" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-white truncate">{song.songName}</div>
                                <div className="text-[10px] text-warm-400 truncate">{song.artist}</div>
                              </div>
                              <div className="text-[10px] text-warm-500 flex-shrink-0">
                                {song.timestamp ? format(new Date(song.timestamp), 'h:mm a') : '—'}
                              </div>
                            </motion.div>
                          )) : (
                            <div className="text-center py-6 text-warm-400 text-sm">
                              No songs played yet
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          
        </div>
      </PullToRefresh>
      
      {/* Raw Data View Modal */}
      {showRawData && (
        <RawDataView 
          isOpen 
          onClose={() => setShowRawData(false)} 
          data={insights.rawData} 
          timeRange={timeRange} 
          onTimeRangeChange={setTimeRange} 
          initialMetric={rawDataMetric} 
          onExport={handleExportCSV} 
        />
      )}
    </>
  );
}

export default Analytics;
