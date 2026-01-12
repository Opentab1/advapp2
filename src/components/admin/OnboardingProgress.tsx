/**
 * OnboardingProgress - Shows setup completion status for a venue
 * 
 * Displays checklist of onboarding steps:
 * 1. Venue created
 * 2. Owner account created
 * 3. Device provisioned
 * 4. Device online
 * 5. First data received
 */

import { motion } from 'framer-motion';
import { 
  CheckCircle, 
  Circle, 
  Loader2,
  Building2,
  User,
  Cpu,
  Wifi,
  BarChart3
} from 'lucide-react';
import type { AdminVenue, AdminDevice } from '../../services/admin.service';

interface OnboardingProgressProps {
  venue: AdminVenue;
  devices: AdminDevice[];
  compact?: boolean;
}

interface OnboardingStep {
  id: string;
  label: string;
  icon: React.ElementType;
  status: 'complete' | 'in_progress' | 'pending';
  detail?: string;
}

export function OnboardingProgress({ venue, devices, compact = false }: OnboardingProgressProps) {
  const venueDevices = devices.filter(d => d.venueId === venue.venueId);
  const hasDevice = venueDevices.length > 0;
  const deviceOnline = venueDevices.some(d => d.status === 'online');
  const hasData = !!venue.lastDataTimestamp;

  const steps: OnboardingStep[] = [
    {
      id: 'venue',
      label: 'Venue Created',
      icon: Building2,
      status: 'complete',
      detail: venue.createdAt ? new Date(venue.createdAt).toLocaleDateString() : undefined
    },
    {
      id: 'owner',
      label: 'Owner Account',
      icon: User,
      status: (venue.userCount || 0) > 0 ? 'complete' : 'pending',
      detail: (venue.userCount || 0) > 0 ? `${venue.userCount} user(s)` : 'No users yet'
    },
    {
      id: 'device',
      label: 'Device Provisioned',
      icon: Cpu,
      status: hasDevice ? 'complete' : 'pending',
      detail: hasDevice ? `${venueDevices.length} device(s)` : 'No device provisioned'
    },
    {
      id: 'online',
      label: 'Device Online',
      icon: Wifi,
      status: deviceOnline ? 'complete' : hasDevice ? 'in_progress' : 'pending',
      detail: deviceOnline ? 'Connected' : hasDevice ? 'Waiting for connection...' : 'Provision device first'
    },
    {
      id: 'data',
      label: 'Receiving Data',
      icon: BarChart3,
      status: hasData ? 'complete' : deviceOnline ? 'in_progress' : 'pending',
      detail: hasData 
        ? `Last: ${new Date(venue.lastDataTimestamp!).toLocaleString()}`
        : deviceOnline ? 'Waiting for first data...' : 'Device must be online'
    }
  ];

  const completedSteps = steps.filter(s => s.status === 'complete').length;
  const progressPercent = (completedSteps / steps.length) * 100;

  // Compact version for venue list
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              progressPercent === 100 ? 'bg-green-500' :
              progressPercent >= 60 ? 'bg-yellow-500' :
              'bg-red-500'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <span className={`text-xs font-medium ${
          progressPercent === 100 ? 'text-green-400' :
          progressPercent >= 60 ? 'text-yellow-400' :
          'text-red-400'
        }`}>
          {completedSteps}/{steps.length}
        </span>
      </div>
    );
  }

  // Full version
  return (
    <div className="space-y-3">
      {/* Progress Bar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">Setup Progress</span>
        <span className={`text-sm font-medium ${
          progressPercent === 100 ? 'text-green-400' : 'text-yellow-400'
        }`}>
          {completedSteps}/{steps.length} Complete
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-4">
        <motion.div
          className={`h-full rounded-full ${
            progressPercent === 100 ? 'bg-green-500' :
            progressPercent >= 60 ? 'bg-yellow-500' :
            'bg-orange-500'
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.id}
              className={`flex items-center gap-3 p-3 rounded-lg ${
                step.status === 'complete' ? 'bg-green-500/10' :
                step.status === 'in_progress' ? 'bg-yellow-500/10' :
                'bg-gray-800/50'
              }`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              {/* Status Icon */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                step.status === 'complete' ? 'bg-green-500/20' :
                step.status === 'in_progress' ? 'bg-yellow-500/20' :
                'bg-gray-700'
              }`}>
                {step.status === 'complete' ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : step.status === 'in_progress' ? (
                  <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-500" />
                )}
              </div>

              {/* Step Info */}
              <div className="flex-1">
                <div className={`text-sm font-medium ${
                  step.status === 'complete' ? 'text-green-400' :
                  step.status === 'in_progress' ? 'text-yellow-400' :
                  'text-gray-400'
                }`}>
                  {step.label}
                </div>
                {step.detail && (
                  <div className="text-xs text-gray-500">{step.detail}</div>
                )}
              </div>

              {/* Step Icon */}
              <Icon className={`w-4 h-4 ${
                step.status === 'complete' ? 'text-green-400' :
                step.status === 'in_progress' ? 'text-yellow-400' :
                'text-gray-600'
              }`} />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default OnboardingProgress;
