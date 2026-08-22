import type { OnboardingV2State } from "./onboardingV2Core";
import { isOnboardingV2Phase2MapState } from "./onboardingV2Core";

export const PHASE2_REQUIRED_MAP_FILTERS = ["food_drink", "outdoors"] as const;

// Canonical production chrome geometry. These values mirror the actual search,
// filter and Queue controls; the Phase 2 dock is derived from their visible
// bottom edge instead of a second unrelated safe-area calculation.
export const MAP_TOP_MARGIN = 12;
export const MAP_SEARCH_HEIGHT = 50;
export const MAP_CHROME_GAP = 8;
export const MAP_FILTER_BAND_HEIGHT = 38;
export const MAP_QUEUE_MARGIN_TOP = 8;
export const MAP_QUEUE_HEIGHT = 44;
export const PHASE2_DOCK_GAP = 8;

export const MAP_TOP_CHROME_BASE_CLEARANCE =
  MAP_TOP_MARGIN +
  MAP_SEARCH_HEIGHT +
  MAP_CHROME_GAP +
  MAP_FILTER_BAND_HEIGHT +
  MAP_CHROME_GAP;
export const MAP_QUEUE_CLEARANCE = 18 + MAP_CHROME_GAP + 8;
export const MAP_TOP_CHROME_CLEARANCE =
  MAP_TOP_CHROME_BASE_CLEARANCE + MAP_QUEUE_CLEARANCE;

export function phase2RequiredMapFilters(
  state: OnboardingV2State | null | undefined,
  phase1Only: boolean,
): readonly string[] {
  return !phase1Only && state && isOnboardingV2Phase2MapState(state)
    ? PHASE2_REQUIRED_MAP_FILTERS
    : [];
}
export function shouldRenderMapTopChrome(input: {
  searchVisible: boolean;
  hasSelectedPlace: boolean;
  previewExpanded: boolean;
}): boolean {
  return (
    !input.searchVisible && (!input.hasSelectedPlace || !input.previewExpanded)
  );
}

export type Phase2MapLayout = {
  filterBand: { top: number; bottom: number };
  queueBand: { top: number; bottom: number };
  controlBandBottom: number;
  dockTop: number;
  overlapsControls: boolean;
};

export function resolvePhase2MapLayout(safeTopInset: number): Phase2MapLayout {
  const safeTop = Math.max(0, safeTopInset);
  const filterTop =
    safeTop + MAP_TOP_MARGIN + MAP_SEARCH_HEIGHT + MAP_CHROME_GAP;
  const filterBottom = filterTop + MAP_FILTER_BAND_HEIGHT;
  const queueTop = filterBottom + MAP_QUEUE_MARGIN_TOP;
  const queueBottom = queueTop + MAP_QUEUE_HEIGHT;
  const dockTop = queueBottom + PHASE2_DOCK_GAP;
  return {
    filterBand: { top: filterTop, bottom: filterBottom },
    queueBand: { top: queueTop, bottom: queueBottom },
    controlBandBottom: queueBottom,
    dockTop,
    overlapsControls: dockTop < queueBottom,
  };
}
