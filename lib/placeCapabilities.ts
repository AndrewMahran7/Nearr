import { isRealSavedPlaceId } from './savedPlaceIdentity';

export type PlaceCapabilityKind =
  | 'server_saved_place'
  | 'tutorial_local_place'
  | 'unsaved_candidate';

export type PlaceCapabilities = {
  kind: PlaceCapabilityKind;
  isServerAddressable: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSetReminder: boolean;
  canMarkVisited: boolean;
  canReportWrongPlace: boolean;
  canWatchSource: boolean;
  canShare: boolean;
  canOpenDirections: boolean;
  canTransfer: boolean;
  canSync: boolean;
};

type PlaceCapabilityInput = {
  id?: string | null;
  source_url?: string | null;
  place?: { id?: string | null; google_place_id?: string | null } | null;
};

export function isTutorialLocalPlace(input: PlaceCapabilityInput): boolean {
  const savedId = input.id?.trim() ?? '';
  const placeId = input.place?.id?.trim() ?? '';
  const googlePlaceId = input.place?.google_place_id?.trim() ?? '';
  const sourceUrl = input.source_url?.trim() ?? '';
  return savedId.startsWith('onboarding-scripted-save:')
    || placeId.startsWith('onboarding-place-')
    || googlePlaceId.startsWith('onboarding-place-')
    || sourceUrl.startsWith('onboarding://');
}

export function placeCapabilities(input: PlaceCapabilityInput): PlaceCapabilities {
  if (isTutorialLocalPlace(input)) {
    return {
      kind: 'tutorial_local_place',
      isServerAddressable: false,
      canEdit: false,
      canDelete: false,
      canSetReminder: false,
      canMarkVisited: false,
      canReportWrongPlace: false,
      canWatchSource: /^https:\/\//i.test(input.source_url?.trim() ?? ''),
      canShare: true,
      canOpenDirections: true,
      canTransfer: false,
      canSync: false,
    };
  }

  if (isRealSavedPlaceId(input.id)) {
    return {
      kind: 'server_saved_place',
      isServerAddressable: true,
      canEdit: true,
      canDelete: true,
      canSetReminder: true,
      canMarkVisited: true,
      canReportWrongPlace: true,
      canWatchSource: /^https:\/\//i.test(input.source_url?.trim() ?? ''),
      canShare: true,
      canOpenDirections: true,
      canTransfer: true,
      canSync: true,
    };
  }

  return {
    kind: 'unsaved_candidate',
    isServerAddressable: false,
    canEdit: false,
    canDelete: false,
    canSetReminder: false,
    canMarkVisited: false,
    canReportWrongPlace: false,
    canWatchSource: /^https:\/\//i.test(input.source_url?.trim() ?? ''),
    canShare: false,
    canOpenDirections: true,
    canTransfer: false,
    canSync: false,
  };
}
