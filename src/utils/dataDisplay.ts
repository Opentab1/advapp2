/**
 * Data Display Utilities
 * 
 * Provides consistent handling of unavailable, invalid, or missing sensor data
 * across the application. Displays "N/A" instead of misleading zeros.
 */

/**
 * Format a numeric value for display, returning "N/A" for invalid/missing data
 * 
 * @param value - The value to format
 * @param decimals - Number of decimal places (default 0)
 * @param invalidValues - Array of values to treat as invalid (default [0, undefined, null, NaN])
 * @returns Formatted string or "--" for invalid data
 */
export function formatValue(
  value: number | undefined | null,
  decimals: number = 0,
  invalidValues: (number | undefined | null)[] = [undefined, null]
): string {
  // Check for invalid values
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '--';
  }
  
  // Check if value is in the list of invalid values
  if (invalidValues.includes(value)) {
    return '--';
  }
  
  // Format the number
  return decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
}

/**
 * Format a numeric value, treating zero as valid
 * Use this for metrics where zero is a valid reading (e.g., occupancy can be 0)
 */
export function formatValueAllowZero(
  value: number | undefined | null,
  decimals: number = 0
): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '--';
  }
  return decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
}

/**
 * Format a numeric value, treating zero as invalid
 * Use this for metrics where zero indicates missing data (e.g., temperature shouldn't be 0°F indoors)
 */
export function formatValueNoZero(
  value: number | undefined | null,
  decimals: number = 0
): string {
  if (value === undefined || value === null || Number.isNaN(value) || value === 0) {
    return '--';
  }
  return decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
}

/**
 * Check if sensor data is valid (has actual readings)
 */
export function hasValidSensorData(data: {
  decibels?: number;
  light?: number;
  indoorTemp?: number;
  humidity?: number;
} | null | undefined): boolean {
  if (!data) return false;
  
  // At least one sensor should have a non-zero reading
  return (
    (data.decibels !== undefined && data.decibels > 0) ||
    (data.light !== undefined && data.light > 0) ||
    (data.indoorTemp !== undefined && data.indoorTemp > 0) ||
    (data.humidity !== undefined && data.humidity > 0)
  );
}

/**
 * Get display text for a metric that might be unavailable
 */
export function getMetricDisplay(
  value: number | undefined | null,
  options: {
    decimals?: number;
    allowZero?: boolean;
    suffix?: string;
    prefix?: string;
    naText?: string;
  } = {}
): string {
  const { decimals = 0, allowZero = false, suffix = '', prefix = '', naText = '--' } = options;
  
  const isInvalid = 
    value === undefined || 
    value === null || 
    Number.isNaN(value) ||
    (!allowZero && value === 0);
  
  if (isInvalid) {
    return naText;
  }
  
  const formatted = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
  return `${prefix}${formatted}${suffix}`;
}

/**
 * Format occupancy value - zero is valid for occupancy
 */
export function formatOccupancy(value: number | undefined | null): string {
  return formatValueAllowZero(value, 0);
}

/**
 * Format temperature - zero is usually invalid for indoor temp
 */
export function formatTemp(value: number | undefined | null): string {
  return formatValueNoZero(value, 0);
}

/**
 * Format decibels - zero is usually invalid (even silence has some dB)
 */
export function formatDecibels(value: number | undefined | null): string {
  return formatValueNoZero(value, 0);
}

/**
 * Format light level - zero could be valid (dark room)
 */
export function formatLight(value: number | undefined | null): string {
  return formatValueAllowZero(value, 0);
}

/**
 * Format humidity - zero is usually invalid
 */
export function formatHumidity(value: number | undefined | null): string {
  return formatValueNoZero(value, 0);
}

/**
 * Format percentage - allows zero
 */
export function formatPercentage(value: number | undefined | null): string {
  return formatValueAllowZero(value, 0);
}

/**
 * Format dwell time in minutes
 */
export function formatDwellTimeValue(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '--';
  }
  
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
