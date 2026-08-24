import {
  recommendationPhotoUrls,
  type PlaceRecommendation,
} from './placeRecommendations';

export const RECOMMENDATION_GALLERY_MAX_PHOTOS = 5;

/** Photos that can still be shown after per-image load failures. */
export function visibleRecommendationPhotoUrls(
  recommendation:
    | Pick<PlaceRecommendation, 'photoUrls' | 'photoUrl'>
    | { photoUrls?: readonly (string | null | undefined)[]; photoUrl?: string | null }
    | null
    | undefined,
  failedPhotoUrls: Readonly<Record<string, true>> = {},
): string[] {
  return recommendationPhotoUrls(recommendation).filter((url) => !failedPhotoUrls[url]);
}

/** Large enough to anchor a phone sheet, bounded on wider page-sheet layouts. */
export function recommendationHeroHeight(carouselWidth: number): number {
  const safeWidth = Number.isFinite(carouselWidth) ? Math.max(1, carouselWidth) : 1;
  return Math.max(280, Math.min(360, Math.round(safeWidth * 0.78)));
}
