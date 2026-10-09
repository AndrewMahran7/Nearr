/** Shared geometry/motion for the existing Nearr design system. */
export const Fieldnotes = {
  screenMargin: 24, heroInset: 16, minTouchTarget: 44, buttonMinHeight: 50,
  image: { heroRatio: 4 / 3, selectedRatio: 2, sourceRatio: 2 / 3, thumbnail: 72 },
  motion: { press: 90, fade: 120, status: 180, card: 220, detail: 300, arrival: 780 },
  maxPhotoMarkers: 3,
  featureLibraryLimit: 50,
} as const;
