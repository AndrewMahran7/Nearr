/** Provider-independent identity relationship guard.
 *
 * The recognizer owns identity. A map provider may confirm an exact/alias
 * identity or annotate its parent, but a parent container can never replace a
 * more specific defensible child. This module deliberately has no case IDs,
 * ground truth, coordinates, or benchmark data.
 */
export type CanonicalizationRelation = 'EXACT' | 'ALIAS' | 'PARENT_ONLY' | 'INCOMPATIBLE';

const NON_SPECIFIC_MODEL_TYPES = new Set(['ADMIN_AREA', 'BROAD_AREA', 'CITY', 'REGION', 'COUNTRY', 'UNKNOWN']);
const PARENT_PROVIDER_TYPES = new Set([
  'park', 'national_park', 'state_park', 'beach', 'campground', 'shopping_mall',
  'lodging', 'resort_hotel', 'marina', 'administrative_area_level_1',
  'administrative_area_level_2', 'locality', 'country',
]);
const CHILD_MARKERS = new Set([
  'arch', 'cave', 'cavern', 'cenote', 'falls', 'fall', 'waterfall', 'ledge',
  'pool', 'pothole', 'potholes', 'rock', 'rocks', 'trail', 'trailhead', 'tenant',
  'hole', 'grotto', 'quarry', 'pier', 'tower', 'bridge', 'restaurant', 'cafe',
  'bakery', 'bar', 'winery', 'brewery',
]);
const PARENT_NAME_MARKERS = new Set([
  'park', 'beach', 'mall', 'plaza', 'complex', 'resort', 'marina', 'lake',
  'region', 'county', 'city', 'recreation', 'recreational', 'area', 'center',
  'centre', 'preserve', 'reserve',
]);
const NOISE = new Set(['the', 'and', 'of', 'in', 'on', 'at', 'inside', 'within', 'near']);

export function canonicalIdentityTokens(value: string): string[] {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((token) => token.length > 1 && !NOISE.has(token));
}

function normalized(value: string): string {
  return canonicalIdentityTokens(value).join(' ');
}

function overlap(left: string, right: string): number {
  const a = new Set(canonicalIdentityTokens(left));
  const b = new Set(canonicalIdentityTokens(right));
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.min(a.size, b.size);
}

export function modelIdentityIsSpecific(entityType: string): boolean {
  return !NON_SPECIFIC_MODEL_TYPES.has(entityType.toUpperCase());
}

export function classifyCanonicalizationRelation(args: {
  modelName: string;
  modelEntityType: string;
  providerName: string;
  providerTypes?: readonly string[];
}): CanonicalizationRelation {
  const model = normalized(args.modelName);
  const provider = normalized(args.providerName);
  if (!model || !provider || !modelIdentityIsSpecific(args.modelEntityType)) return 'INCOMPATIBLE';
  if (model === provider) return 'EXACT';

  const modelTokens = new Set(canonicalIdentityTokens(args.modelName));
  const providerTokens = new Set(canonicalIdentityTokens(args.providerName));
  const missingModelTokens = [...modelTokens].filter((token) => !providerTokens.has(token));
  const extraProviderTokens = [...providerTokens].filter((token) => !modelTokens.has(token));
  const modelChildMarkers = [...modelTokens].filter((token) => CHILD_MARKERS.has(token));
  const providerHasSameChildMarker = modelChildMarkers.some((token) => providerTokens.has(token));
  const providerLooksLikeParent = (args.providerTypes ?? []).some((type) => PARENT_PROVIDER_TYPES.has(type.toLowerCase())) ||
    [...providerTokens].some((token) => PARENT_NAME_MARKERS.has(token));
  const providerIsContainedContext = provider.length >= 4 && model.includes(provider) && missingModelTokens.length > 0;

  // Natural-feature child words disappearing into a park/beach/lake/area are
  // a specificity loss even when the parent name is embedded in the model's
  // descriptive identity. For businesses, a mall/complex provider result is
  // likewise parent metadata unless the names are actually identical.
  if (
    (providerLooksLikeParent && missingModelTokens.length > 0 &&
      (modelChildMarkers.length > 0 && !providerHasSameChildMarker)) ||
    (providerLooksLikeParent && modelChildMarkers.length > 0 &&
      extraProviderTokens.some((token) => PARENT_NAME_MARKERS.has(token))) ||
    (providerLooksLikeParent && providerIsContainedContext) ||
    (['BUSINESS', 'HOTEL'].includes(args.modelEntityType.toUpperCase()) && providerLooksLikeParent && missingModelTokens.length > 0)
  ) return 'PARENT_ONLY';

  return overlap(args.modelName, args.providerName) >= 0.45 ? 'ALIAS' : 'INCOMPATIBLE';
}
