export {
  ensureNotificationPermission,
  getNotificationPermissionState,
  ensureForegroundLocationPermission,
  ensureBackgroundLocationPermission,
  startProximityWatch,
  stopProximityWatch,
  syncProximityWatch,
  sendTestNotification,
  checkProximity,
  checkProximityOnce,
  effectiveRadiusMeters,
  inQuietHours,
  decideProximity,
  registerNotificationCategories,
  handleNotificationAction,
  NOTIFY_CATEGORY_STANDARD,
  NOTIFY_CATEGORY_FINAL,
} from '@/lib/notifications';

export type { ProximityDecision, CheckProximityOnceResult } from '@/lib/notifications';
