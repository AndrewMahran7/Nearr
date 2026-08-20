/**
 * Pure Google Places REST-key selection.
 *
 * Kept free of Expo/React Native imports so the build verifier and regression
 * tests can enforce exactly the same precedence as the running app.
 */

export type GooglePlacesKeySource =
  | 'dedicated_places_key'
  | 'maps_fallback'
  | 'missing';

export type GooglePlacesKeyLocation = 'process_env' | 'expo_extra' | 'none';

export type GooglePlacesConfigInputs = {
  appEnvironment?: unknown;
  backendEnvironment?: unknown;
  envPlacesKey?: unknown;
  envMapsKey?: unknown;
  extraPlacesKey?: unknown;
  extraPlacesKeySource?: unknown;
};

export type ResolvedGooglePlacesConfig = {
  key: string;
  source: GooglePlacesKeySource;
  location: GooglePlacesKeyLocation;
  endpointFamily: 'legacy';
  appEnvironment: string;
  backendEnvironment: string;
  dedicatedKeyRequired: boolean;
  configurationError: string | null;
};

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function declaredSource(value: unknown): GooglePlacesKeySource | null {
  const source = trim(value);
  return source === 'dedicated_places_key' || source === 'maps_fallback' || source === 'missing'
    ? source
    : null;
}

/**
 * Dedicated keys always outrank compatibility fallbacks, even when the
 * dedicated value came from Expo config and the fallback was inlined by a
 * local Metro bundle. That cross-source ordering is what prevents a local
 * `.env` Maps key from masking the key embedded by an EAS development build.
 */
export function resolveGooglePlacesConfig(
  inputs: GooglePlacesConfigInputs,
): ResolvedGooglePlacesConfig {
  const appEnvironment = trim(inputs.appEnvironment).toLowerCase();
  const backendEnvironment = trim(inputs.backendEnvironment).toLowerCase();
  const envPlacesKey = trim(inputs.envPlacesKey);
  const envMapsKey = trim(inputs.envMapsKey);
  const extraPlacesKey = trim(inputs.extraPlacesKey);
  const extraSource = declaredSource(inputs.extraPlacesKeySource);
  const dedicatedKeyRequired =
    appEnvironment === 'development' || appEnvironment === 'preview';

  let key = '';
  let source: GooglePlacesKeySource = 'missing';
  let location: GooglePlacesKeyLocation = 'none';

  if (envPlacesKey) {
    key = envPlacesKey;
    source = 'dedicated_places_key';
    location = 'process_env';
  } else if (extraPlacesKey && extraSource === 'dedicated_places_key') {
    key = extraPlacesKey;
    source = 'dedicated_places_key';
    location = 'expo_extra';
  } else if (envMapsKey) {
    key = envMapsKey;
    source = 'maps_fallback';
    location = 'process_env';
  } else if (extraPlacesKey) {
    // Configs created before googlePlacesKeySource existed remain compatible.
    // They are deliberately treated as fallback/unknown, never as proof that
    // a development lane has the required dedicated REST key.
    key = extraPlacesKey;
    source = 'maps_fallback';
    location = 'expo_extra';
  }

  const configurationError =
    dedicatedKeyRequired && source !== 'dedicated_places_key'
      ? `EXPO_PUBLIC_GOOGLE_PLACES_KEY is required for ${appEnvironment}; ` +
        'refusing to use EXPO_PUBLIC_GOOGLE_MAPS_API_KEY for legacy Places REST requests.'
      : null;

  return {
    key,
    source,
    location,
    endpointFamily: 'legacy',
    appEnvironment,
    backendEnvironment,
    dedicatedKeyRequired,
    configurationError,
  };
}
