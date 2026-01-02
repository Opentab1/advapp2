/**
 * AnimatedNumber - Numbers that count up/down when they change
 * 
 * WHOOP-style animated counting effect.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

interface AnimatedNumberProps {
  value: number | null;
  className?: string;
  duration?: number;
  formatFn?: (value: number) => string;
}

export function AnimatedNumber({
  value,
  className = '',
  duration = 0.5,
  formatFn = (v) => Math.round(v).toString(),
}: AnimatedNumberProps) {
  const spring = useSpring(value ?? 0, {
    stiffness: 100,
    damping: 20,
    duration: duration * 1000,
  });
  
  const display = useTransform(spring, (v) => formatFn(v));
  const [displayValue, setDisplayValue] = useState(value !== null ? formatFn(value) : '--');
  
  useEffect(() => {
    if (value !== null) {
      spring.set(value);
    }
  }, [value, spring]);
  
  useEffect(() => {
    const unsubscribe = display.on('change', (v) => {
      setDisplayValue(v);
    });
    return unsubscribe;
  }, [display]);
  
  if (value === null) {
    return <span className={className}>--</span>;
  }
  
  return (
    <motion.span className={className}>
      {displayValue}
    </motion.span>
  );
}

export default AnimatedNumber;
