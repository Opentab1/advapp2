import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, AlertCircle, DollarSign, TrendingUp, Users, Sparkles } from 'lucide-react';
import { Logo } from '../components/Logo';
import { AnimatedBackground } from '../components/AnimatedBackground';
import authService from '../services/auth.service';

interface LoginProps {
  onLoginSuccess: () => void;
}

// Value prop stats (rotate through these)
const VALUE_STATS = [
  { value: '$2,847', label: 'avg extra revenue captured last night', icon: DollarSign },
  { value: '23 min', label: 'longer guest dwell time on average', icon: TrendingUp },
  { value: '247', label: 'venues crushing it with Pulse', icon: Users },
  { value: '38%', label: 'increase in repeat customers', icon: Sparkles },
];

export function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false);
  const [statIndex, setStatIndex] = useState(0);

  // Rotate value stats
  useEffect(() => {
    const interval = setInterval(() => {
      setStatIndex(prev => (prev + 1) % VALUE_STATS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await authService.login(email, password);
      onLoginSuccess();
    } catch (err: any) {
      if (err.message === 'NEW_PASSWORD_REQUIRED') {
        setNeedsPasswordChange(true);
        setError('');
      } else {
        setError(err.message || 'Failed to login');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate new password
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      await authService.completeNewPassword(newPassword);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to set new password');
    } finally {
      setLoading(false);
    }
  };

  const currentStat = VALUE_STATS[statIndex];
  const StatIcon = currentStat.icon;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-warm-900">
      <AnimatedBackground />

      <motion.div
        className="w-full max-w-md relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Logo & Branding */}
        <div className="text-center mb-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex items-center justify-center gap-3 mb-4">
              <Logo className="scale-125" />
              <h1 className="text-4xl font-bold text-white tracking-tight">Pulse</h1>
            </div>
            <p className="text-2xl font-semibold text-warm-200 mb-2">
              Stop leaving money
            </p>
            <p className="text-2xl font-semibold text-warm-200">
              on the table.
            </p>
          </motion.div>
        </div>

        {/* Rotating Value Stat */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
        >
          <div className="bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 rounded-xl p-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={statIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                  <StatIcon className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-emerald-400">{currentStat.value}</div>
                  <div className="text-sm text-emerald-300/70">{currentStat.label}</div>
                </div>
              </motion.div>
            </AnimatePresence>
            
            {/* Stat indicators */}
            <div className="flex justify-center gap-1.5 mt-3">
              {VALUE_STATS.map((_, idx) => (
                <div
                  key={idx}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${
                    idx === statIndex ? 'bg-emerald-400 w-4' : 'bg-emerald-600'
                  }`}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* Login Card */}
        <motion.div
          className="glass-card p-6"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <h2 className="text-xl font-semibold text-center mb-1 text-white">
            {needsPasswordChange ? 'Set New Password' : 'Access Your Dashboard'}
          </h2>
          <p className="text-warm-400 text-center text-sm mb-6">
            {needsPasswordChange 
              ? 'Your temporary password has expired. Please set a new password.' 
              : 'Sign in to see your venue\'s revenue impact'}
          </p>

          {/* Error Message */}
          {error && (
            <motion.div
              className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </motion.div>
          )}

          {/* Password Change Form */}
          {needsPasswordChange ? (
            <form onSubmit={handlePasswordChange} className="space-y-4">
              {/* New Password Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white placeholder-gray-500"
                    required
                    minLength={8}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Must be at least 8 characters long
                </p>
              </div>

              {/* Confirm Password Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white placeholder-gray-500"
                    required
                    minLength={8}
                  />
                </div>
              </div>

              {/* Submit Button */}
              <motion.button
                type="submit"
                disabled={loading}
                className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                whileHover={{ scale: loading ? 1 : 1.02 }}
                whileTap={{ scale: loading ? 1 : 0.98 }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-navy/30 border-t-navy rounded-full animate-spin" />
                    Setting Password...
                  </span>
                ) : (
                  'Set New Password'
                )}
              </motion.button>
            </form>
          ) : (
            /* Login Form */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white placeholder-gray-500"
                    required
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-cyan/50 focus:ring-2 focus:ring-cyan/20 transition-all text-white placeholder-gray-500"
                    required
                  />
                </div>
              </div>

              {/* Submit Button */}
              <motion.button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-warm-900 font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/20"
                whileHover={{ scale: loading ? 1 : 1.02 }}
                whileTap={{ scale: loading ? 1 : 0.98 }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-warm-900/30 border-t-warm-900 rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Access Your Revenue
                  </span>
                )}
              </motion.button>
            </form>
          )}

        </motion.div>

        {/* Social Proof */}
        <motion.div
          className="mt-6 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center justify-center gap-2 text-sm text-warm-400 mb-2">
            <div className="flex -space-x-2">
              {['🍺', '🍸', '🥂'].map((emoji, i) => (
                <div key={i} className="w-6 h-6 rounded-full bg-warm-700 flex items-center justify-center text-xs border-2 border-warm-900">
                  {emoji}
                </div>
              ))}
            </div>
            <span>Join 247 venues already winning</span>
          </div>
        </motion.div>

        {/* Footer Info */}
        <motion.div
          className="mt-6 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <p className="text-xs text-warm-600">
            <span className="text-warm-500">Pulse</span> by Advizia • Secure Login
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
