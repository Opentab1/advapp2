/**
 * OnboardingWizard - First-run setup guide for new clients
 *
 * Shows once after first login. Stored in localStorage so it never repeats.
 * Steps: Welcome → Pulse Sensor → VenueScope Camera → Ready
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Video, BarChart2, ChevronRight, X, Check } from 'lucide-react';

const STORAGE_KEY = 'pulse_onboarding_v1_complete';

export function hasCompletedOnboarding(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function markOnboardingComplete() {
  localStorage.setItem(STORAGE_KEY, 'true');
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS = [
  {
    id: 'welcome',
    icon: BarChart2,
    iconColor: 'text-teal',
    iconBg: 'bg-teal/10 border-teal/20',
    title: 'Welcome to Advizia Pulse',
    subtitle: 'Your venue analytics command center',
    body: "Pulse turns your venue's sensors and cameras into real decisions — so you make more money and stop losing it.",
    bullets: [
      'Live crowd, sound & light data from your Pulse sensor',
      'CCTV drink counting and theft detection via VenueScope',
      'Music analytics, event planning, and staff performance',
    ],
  },
  {
    id: 'sensor',
    icon: Zap,
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-400/10 border-amber-400/20',
    title: 'Connect Your Pulse Sensor',
    subtitle: 'Real-time venue data',
    body: 'Your Pulse device collects sound levels, light levels, and crowd estimates every 30 seconds.',
    bullets: [
      'Power on the device and connect it to your venue WiFi',
      'It takes ~5 minutes for the first readings to appear',
      'The Live tab will show a green dot when connected',
    ],
  },
  {
    id: 'venuescope',
    icon: Video,
    iconColor: 'text-purple-400',
    iconBg: 'bg-purple-400/10 border-purple-400/20',
    title: 'VenueScope Camera Analytics',
    subtitle: 'CCTV-powered drink counting',
    body: 'Upload bar shift footage to count drinks, compare against your POS, and flag potential theft — automatically.',
    bullets: [
      'Works with any existing overhead bar camera',
      'Detects each drink served per bartender',
      'Generates a shift report with confidence score',
    ],
    note: 'VenueScope requires a dedicated server. Ask your account manager to get it set up.',
  },
  {
    id: 'ready',
    icon: Check,
    iconColor: 'text-teal',
    iconBg: 'bg-teal/10 border-teal/20',
    title: "You're all set",
    subtitle: 'Start exploring your dashboard',
    body: "Here's a quick map of the app so you know where to find everything.",
    tabs: [
      { name: 'Live', desc: 'Real-time pulse score, crowd & environment' },
      { name: 'Results', desc: 'Dwell time, guest trends & song analytics' },
      { name: 'Events', desc: 'Event ideas & past performance tracking' },
      { name: 'Staffing', desc: 'Staff schedules & performance rankings' },
      { name: 'VenueScope', desc: 'CCTV drink counting & theft detection' },
    ],
  },
];

// ── Wizard component ──────────────────────────────────────────────────────────

interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const advance = () => {
    if (isLast) {
      markOnboardingComplete();
      onComplete();
    } else {
      setDirection(1);
      setStep(s => s + 1);
    }
  };

  const dismiss = () => {
    markOnboardingComplete();
    onComplete();
  };

  const Icon = current.icon;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="bg-whoop-panel border border-whoop-divider rounded-2xl w-full max-w-md overflow-hidden"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 pt-5 pb-0">
          {/* Step dots */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i === step
                    ? 'w-5 h-1.5 bg-teal'
                    : i < step
                    ? 'w-1.5 h-1.5 bg-teal/40'
                    : 'w-1.5 h-1.5 bg-whoop-divider'
                }`}
              />
            ))}
          </div>
          <button
            onClick={dismiss}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-white hover:bg-whoop-panel-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={current.id}
            custom={direction}
            initial={{ opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -24 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="px-5 py-5 space-y-4"
          >
            {/* Icon */}
            <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${current.iconBg}`}>
              <Icon className={`w-6 h-6 ${current.iconColor}`} />
            </div>

            {/* Title */}
            <div>
              <p className="text-xs text-text-muted uppercase tracking-wider font-medium mb-1">{current.subtitle}</p>
              <h2 className="text-xl font-bold text-white">{current.title}</h2>
            </div>

            {/* Body */}
            <p className="text-sm text-text-secondary leading-relaxed">{current.body}</p>

            {/* Bullets */}
            {'bullets' in current && current.bullets && (
              <ul className="space-y-2">
                {current.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-text-secondary">
                    <Check className="w-4 h-4 text-teal flex-shrink-0 mt-0.5" />
                    {b}
                  </li>
                ))}
              </ul>
            )}

            {/* Note */}
            {'note' in current && current.note && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                <p className="text-xs text-amber-400">{current.note}</p>
              </div>
            )}

            {/* Tab map (last step) */}
            {'tabs' in current && current.tabs && (
              <div className="space-y-2">
                {current.tabs.map(({ name, desc }) => (
                  <div key={name} className="flex items-center gap-3 p-2.5 rounded-xl bg-whoop-panel-secondary">
                    <div className="w-1.5 h-1.5 rounded-full bg-teal flex-shrink-0" />
                    <span className="text-sm font-medium text-white w-24 flex-shrink-0">{name}</span>
                    <span className="text-xs text-text-muted">{desc}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer */}
        <div className="px-5 pb-5">
          <motion.button
            onClick={advance}
            className="w-full py-3 rounded-xl bg-teal text-black font-semibold text-sm flex items-center justify-center gap-2"
            whileTap={{ scale: 0.97 }}
          >
            {isLast ? (
              <>
                <Check className="w-4 h-4" />
                Go to Dashboard
              </>
            ) : (
              <>
                Continue
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

export default OnboardingWizard;
