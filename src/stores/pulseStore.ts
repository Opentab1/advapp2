/**
 * Pulse Store - Simple shared state for Pulse Score
 * 
 * Allows the Pulse page to share the current score with the Header.
 */

type Listener = (score: number | null) => void;

class PulseStore {
  private score: number | null = null;
  private listeners: Set<Listener> = new Set();
  
  getScore(): number | null {
    return this.score;
  }
  
  setScore(score: number | null): void {
    if (this.score !== score) {
      this.score = score;
      this.listeners.forEach(listener => listener(score));
    }
  }
  
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const pulseStore = new PulseStore();

// React hook for using the store
import { useState, useEffect } from 'react';

export function usePulseScore(): number | null {
  const [score, setScore] = useState<number | null>(pulseStore.getScore());
  
  useEffect(() => {
    return pulseStore.subscribe(setScore);
  }, []);
  
  return score;
}
