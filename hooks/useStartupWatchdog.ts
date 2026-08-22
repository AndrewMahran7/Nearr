import { useCallback, useEffect, useState } from 'react';
import * as Updates from 'expo-updates';

import { STARTUP_WATCHDOG_TIMEOUT_MS } from '@/lib/startupWatchdogCore';

export function useStartupWatchdog(pending: boolean): {
  timedOut: boolean;
  retry: () => void;
} {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!pending) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), STARTUP_WATCHDOG_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const retry = useCallback(() => {
    // Explicit user action only. Never auto-reload: a persistent failure must
    // remain recoverable rather than becoming a launch loop.
    void Updates.reloadAsync().catch(() => setTimedOut(true));
  }, []);

  return { timedOut, retry };
}
