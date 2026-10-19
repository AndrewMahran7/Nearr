export type FieldnotesMapOwner =
  | 'normal_map'
  | 'compact_place'
  | 'expanded_place'
  | 'search'
  | 'nearby_explorer'
  | 'saved_library'
  | 'source_group'
  | 'onboarding';

export type FieldnotesMapPresentation = {
  owner: FieldnotesMapOwner;
  showTopChrome: boolean;
  showActivity: boolean;
  activityPointerEvents: 'auto' | 'none';
  showDock: boolean;
  showFloatingActions: boolean;
  showEmptyFeedback: boolean;
};

/**
 * One map-surface owner decides every floating control. This keeps a hidden
 * route, sheet, or modal from leaving a visible or tappable control behind.
 */
export function resolveFieldnotesMapPresentation(input: {
  searchVisible: boolean;
  nearbyExplorerActive: boolean;
  hasSelectedPlace: boolean;
  expandedPlace: boolean;
  savedLibraryExpanded: boolean;
  sourceGroupActive: boolean;
  onboardingOwnsMap: boolean;
}): FieldnotesMapPresentation {
  const owner: FieldnotesMapOwner = input.searchVisible
    ? 'search'
    : input.nearbyExplorerActive
      ? 'nearby_explorer'
      : input.hasSelectedPlace && input.expandedPlace
        ? 'expanded_place'
        : input.sourceGroupActive
          ? 'source_group'
          : input.hasSelectedPlace
            ? 'compact_place'
            : input.savedLibraryExpanded
              ? 'saved_library'
              : input.onboardingOwnsMap
                ? 'onboarding'
                : 'normal_map';

  const normalOrCompact = owner === 'normal_map' || owner === 'compact_place';
  return {
    owner,
    showTopChrome: normalOrCompact || owner === 'onboarding',
    showActivity: normalOrCompact,
    activityPointerEvents: normalOrCompact ? 'auto' : 'none',
    showDock: normalOrCompact || owner === 'saved_library',
    showFloatingActions: owner === 'normal_map',
    showEmptyFeedback: owner === 'normal_map' || owner === 'onboarding',
  };
}
