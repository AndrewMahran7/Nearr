import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Readiness lets one-shot effects wait without consuming their pending identity. */
export function useReduceMotionPreference(): { reduced: boolean; ready: boolean } {
  const [preference, setPreference] = useState({ reduced: true, ready: false });
  useEffect(() => {
    let mounted = true;
    let receivedLiveChange = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !receivedLiveChange) setPreference({ reduced: value, ready: true });
    }).catch(() => {
      if (mounted && !receivedLiveChange) setPreference({ reduced: true, ready: true });
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => {
      receivedLiveChange = true;
      if (mounted) setPreference({ reduced, ready: true });
    });
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return preference;
}

/** Conservative until the accessibility setting is known; responds to live changes. */
export function useReduceMotion(): boolean {
  return useReduceMotionPreference().reduced;
}
