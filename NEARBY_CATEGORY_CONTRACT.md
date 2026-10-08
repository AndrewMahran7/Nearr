# Nearby and category contract

Date: 2026-10-08
Scope: Nearr Development only

## Nearby eligibility

Nearby is not "the nearest saved places anywhere." A place is eligible only when:

1. user and place coordinates are finite and geographically valid;
2. computed distance is finite;
3. distance is less than or equal to that place's canonical effective nearby-notification radius from `getEffectiveNearbyNotificationRadiusMeters`.

Only eligible places are sorted nearest-first and then capped to the requested result limit. Missing or invalid coordinates are skipped. This prevents a place hundreds of miles away from appearing merely because it is the closest item in a sparse library.

The hook delegates the pure filtering/sorting contract to `lib/nearbyPlaces.ts`, so UI ordering and eligibility use one testable rule.

## Category derivation

Category precedence remains:

1. explicit canonical Nearr category;
2. normalized provider types and category hints;
3. conservative `other` fallback.

The Food group includes canonical `restaurant`, `bar`, and `cafe`. Tutorial fixture data now uses canonical categories rather than display group labels:

- Mad Yolks: `restaurant` -> Food
- scenic fixture: `scenic_spot` -> Outdoors
- attraction fixture: `attraction` -> Things to Do
- shopping fixture: `shopping` -> Shopping

Mad Yolks therefore appears in Food and does not leak into Other. No production-data rewrite or category migration is required; this was a fixture normalization and selector-contract fix.

## Regression proof

`npm run test:nearby-category-contract` checks inside/outside radius boundaries, invalid coordinates, nearest-first ordering after eligibility, result capping, Mad Yolks classification, cafe inclusion, and no duplicate Other membership. Existing category pipeline and place-category suites remain green.
