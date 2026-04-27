export {
  ensureNotificationPermission,
  ensureForegroundLocationPermission,
  ensureBackgroundLocationPermission,
  startProximityWatch,
  stopProximityWatch,
  checkProximity,
  checkProximityOnce,
  effectiveRadiusMeters,
  inQuietHours,
  decideProximity,
} from '@/lib/notifications';

export type { ProximityDecision, CheckProximityOnceResult } from '@/lib/notifications';
