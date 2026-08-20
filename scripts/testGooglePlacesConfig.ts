import assert from 'node:assert/strict';

import { resolveGooglePlacesConfig } from '../lib/googlePlacesConfigCore';

const dedicated = resolveGooglePlacesConfig({
  appEnvironment: 'development',
  backendEnvironment: 'development',
  envPlacesKey: 'places-key',
  envMapsKey: 'maps-key',
});
assert.equal(dedicated.source, 'dedicated_places_key');
assert.equal(dedicated.location, 'process_env');
assert.equal(dedicated.key, 'places-key');
assert.equal(dedicated.configurationError, null);

const embeddedDedicatedBeatsMetroFallback = resolveGooglePlacesConfig({
  appEnvironment: 'development',
  backendEnvironment: 'development',
  envMapsKey: 'locally-inlined-maps-key',
  extraPlacesKey: 'eas-embedded-places-key',
  extraPlacesKeySource: 'dedicated_places_key',
});
assert.equal(embeddedDedicatedBeatsMetroFallback.source, 'dedicated_places_key');
assert.equal(embeddedDedicatedBeatsMetroFallback.location, 'expo_extra');
assert.equal(embeddedDedicatedBeatsMetroFallback.key, 'eas-embedded-places-key');
assert.equal(embeddedDedicatedBeatsMetroFallback.configurationError, null);

for (const appEnvironment of ['development', 'preview']) {
  const fallback = resolveGooglePlacesConfig({
    appEnvironment,
    backendEnvironment: 'development',
    envMapsKey: 'maps-key',
  });
  assert.equal(fallback.source, 'maps_fallback');
  assert.match(fallback.configurationError ?? '', /EXPO_PUBLIC_GOOGLE_PLACES_KEY is required/);
}

const legacyExtraInDevelopment = resolveGooglePlacesConfig({
  appEnvironment: 'development',
  backendEnvironment: 'development',
  extraPlacesKey: 'unknown-old-build-key',
});
assert.equal(legacyExtraInDevelopment.source, 'maps_fallback');
assert.ok(legacyExtraInDevelopment.configurationError);

const productionCompatibility = resolveGooglePlacesConfig({
  appEnvironment: 'production',
  backendEnvironment: 'production',
  envMapsKey: 'maps-key',
});
assert.equal(productionCompatibility.source, 'maps_fallback');
assert.equal(productionCompatibility.key, 'maps-key');
assert.equal(productionCompatibility.configurationError, null);

const missing = resolveGooglePlacesConfig({
  appEnvironment: 'development',
  backendEnvironment: 'development',
});
assert.equal(missing.source, 'missing');
assert.equal(missing.location, 'none');
assert.ok(missing.configurationError);

console.log('PASS Google Places dedicated-key selection and development fallback guard');
