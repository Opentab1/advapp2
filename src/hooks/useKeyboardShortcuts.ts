import { useEffect } from 'react';

interface ShortcutHandlers {
  onRefresh?: () => void;
  onExport?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Ignore if typing in input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'r' && handlers.onRefresh) {
        event.preventDefault();
        handlers.onRefresh();
      } else if (key === 'e' && handlers.onExport) {
        event.preventDefault();
        handlers.onExport();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handlers]);
}
