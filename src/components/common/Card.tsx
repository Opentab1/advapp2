/**
 * Card - Unified card component with consistent styling
 * 
 * Provides:
 * - Consistent borders, shadows, and padding
 * - Empty state with guidance
 * - Loading state
 * - Clickable variant with hover effects
 * - Dark mode support
 */

import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, AlertCircle, Wifi } from 'lucide-react';
import { haptic } from '../../utils/haptics';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  animate?: boolean;
}

const PADDING = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export function Card({ 
  children, 
  className = '', 
  onClick,
  padding = 'md',
  animate = true,
}: CardProps) {
  const baseClasses = `
    bg-white dark:bg-warm-800 
    rounded-2xl 
    border border-warm-200 dark:border-warm-700 
    transition-all duration-200
    ${PADDING[padding]}
    ${onClick ? 'cursor-pointer hover:border-warm-300 dark:hover:border-warm-600 hover:shadow-md active:scale-[0.99]' : ''}
    ${className}
  `;
  
  const handleClick = () => {
    if (onClick) {
      haptic('light');
      onClick();
    }
  };
  
  if (animate) {
    return (
      <motion.div
        className={baseClasses}
        onClick={handleClick}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        whileTap={onClick ? { scale: 0.98 } : undefined}
      >
        {children}
      </motion.div>
    );
  }
  
  return (
    <div className={baseClasses} onClick={handleClick}>
      {children}
    </div>
  );
}

// ============ EMPTY STATE ============

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  variant?: 'default' | 'no-data' | 'error' | 'offline';
}

export function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  action,
  variant = 'default',
}: EmptyStateProps) {
  const variants = {
    default: {
      iconBg: 'bg-warm-100 dark:bg-warm-700',
      iconColor: 'text-warm-400 dark:text-warm-500',
    },
    'no-data': {
      iconBg: 'bg-amber-50 dark:bg-amber-900/20',
      iconColor: 'text-amber-500',
    },
    error: {
      iconBg: 'bg-red-50 dark:bg-red-900/20',
      iconColor: 'text-red-500',
    },
    offline: {
      iconBg: 'bg-warm-100 dark:bg-warm-700',
      iconColor: 'text-warm-400',
    },
  };
  
  const DefaultIcon = variant === 'error' ? AlertCircle : variant === 'offline' ? Wifi : undefined;
  const DisplayIcon = Icon || DefaultIcon;
  const style = variants[variant];
  
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      {DisplayIcon && (
        <div className={`w-12 h-12 rounded-full ${style.iconBg} flex items-center justify-center mb-3`}>
          <DisplayIcon className={`w-6 h-6 ${style.iconColor}`} />
        </div>
      )}
      <h3 className="text-base font-semibold text-warm-700 dark:text-warm-200 mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-warm-500 dark:text-warm-400 max-w-xs">
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ============ CARD HEADER ============

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  action?: ReactNode;
}

export function CardHeader({ title, subtitle, icon: Icon, iconColor = 'text-primary', action }: CardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className={`w-4 h-4 ${iconColor}`} />}
        <div>
          <h3 className="text-sm font-semibold text-warm-800 dark:text-warm-100">{title}</h3>
          {subtitle && (
            <p className="text-xs text-warm-500 dark:text-warm-400">{subtitle}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

// ============ STAT ROW ============

interface StatRowProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: LucideIcon;
  iconColor?: string;
  trend?: 'up' | 'down' | 'neutral';
  onClick?: () => void;
}

export function StatRow({ label, value, subValue, icon: Icon, iconColor = 'text-warm-400', trend, onClick }: StatRowProps) {
  const trendColors = {
    up: 'text-green-500',
    down: 'text-red-500',
    neutral: 'text-warm-400',
  };
  
  return (
    <div 
      className={`flex items-center justify-between py-2 ${onClick ? 'cursor-pointer hover:bg-warm-50 dark:hover:bg-warm-700/50 -mx-2 px-2 rounded-lg transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        {Icon && <Icon className={`w-4 h-4 ${iconColor}`} />}
        <span className="text-sm text-warm-600 dark:text-warm-300">{label}</span>
      </div>
      <div className="text-right">
        <span className={`text-sm font-semibold ${trend ? trendColors[trend] : 'text-warm-800 dark:text-warm-100'}`}>
          {value}
        </span>
        {subValue && (
          <span className="text-xs text-warm-400 dark:text-warm-500 ml-1">{subValue}</span>
        )}
      </div>
    </div>
  );
}

export default Card;
