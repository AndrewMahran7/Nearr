# Fieldnotes component inventory

This inventory describes the React Native implementation in `feat/nearr-1.6-fieldnotes`, based on `ca08c154`. Light is the first-install presentation; stored Light, Dark and System preferences remain supported. These are production screen components wired to existing application state. The separately gated native preview is a Development QA surface.

## Shared foundation

| Component or module | Responsibility and implementation |
| --- | --- |
| `constants/colors.ts`, `constants/typography.ts`, `constants/fieldnotes.ts`, `lib/theme.tsx` | Semantic Light/Dark palettes, system typography, geometry and motion constants. Paper surfaces, botanical utility actions and restricted warm brand accents share the existing theme system. |
| `components/Button.tsx`, `Input.tsx`, `Card.tsx`, `Screen.tsx` | Primary, secondary, text, ghost, save and destructive actions; scalable button content; input focus border; shared surfaces and margins. |
| `components/Fieldnotes.tsx` | Labelled 44-point `IconButton`, selected-state `FilterChip`, and textual/icon `StatusRow`. |
| `components/SourceRibbon.tsx` | Original-post provenance with supplied thumbnail, platform, title, optional caption, Watch original action and unavailable state. It performs no image lookup and does not substitute destination imagery. |
| `lib/useReduceMotion.ts`, `lib/haptics.ts` | Conservative live Reduce Motion preference; native feedback guarded by foreground/platform state and coalesced within 600ms. |
| `assets/icon.png`, `assets/adaptive-icon.png` | Chosen Fieldnotes icon assets. Icon study and build integration have separate root-owned evidence. |

## Product surfaces and ownership

| Surface | Main components | Presentation and preserved owner |
| --- | --- | --- |
| Main map and navigation | `app/(tabs)/map.tsx`, `components/map/FieldnotesMapChrome.tsx`, `MapTopSearchBar.tsx`, `MapCategoryFilterBar.tsx`, `FloatingMapActions.tsx`, `MapBottomSheet.tsx` | Compact brand/search/Activity chrome, collapsed filter entry, Map/Saved dock and small library peek. Map retains camera, selection, filters and sheet state. Saved exposes Account/Settings. |
| Markers and clusters | `NearrMapMarker.tsx`, `NearrMapClusterMarker.tsx`, `lib/mapMarkerPresentation.ts`, `lib/fieldnotesMapPresentation.ts` | Selected-state hierarchy, limited photo markers, semantic marker presentation and accessible place identity. Existing map grouping and selection remain in place. |
| Search and manual add | `MapPlaceSearchDropdown.tsx`, `MapFallbackList.tsx`, `app/add-place.tsx` | Local saved-place results and explicit global search remain distinct. Query, provider request and save services retain existing ownership; presentation changes do not add prefetch. |
| Selected-place preview | `SelectedPlaceCard` in `FieldnotesMapChrome.tsx` | Destination image or honest fallback, reason, name and source context form one opening target. Close is separate. Large font scale promotes the full detail view. |
| Full saved-place detail | `SelectedPlaceDetails.tsx`, `RecommendedPlaceDetails.tsx`, `map/place/PlaceCardRow.tsx` | Destination/gallery, full name and address, botanical Directions, Share, SourceRibbon, reason, reminder, visited state and related places. More contains editing, sharing, correction and removal. Existing permissions, persistence, source identity and callbacks remain connected. |
| Place photos and related video | `PhotoRolodex.tsx`, existing `PlaceVideoGalleryStrip.tsx`, `PlaceImage.tsx` | Counted gallery with contain fit, manual previous/next controls and failed-image fallback. Existing bounded hydration, cached snapshots and visited-page loading remain. Video/source media stays distinct from destination photos. |
| Saved library | `SavedPlacesLibrary.tsx`, `SavedPlaceBrowseCard.tsx`, `CompactPlaceRow.tsx` | One lead feature only for unfiltered recent collections of at most 50 places; remaining rows are compact. Collections above 50 use all compact rows. Search, sort, category filters and empty/loading states retain current data. FlatList owns row virtualization. |
| Activity | `app/share-jobs/index.tsx`, `ShareJobsSheet.tsx`, `ShareJobsHeader.tsx`, `AutoSaveUndoToast.tsx` | Editorial rows grouped by Needs your check, Finding places and On your map. Durable jobs, errors, archive, save and undo retain their service ownership. Processing remains indeterminate. |
| Quick Check | `app/share-jobs/[jobId].tsx`, `CandidateConfirmationCard.tsx`, `CandidatePhotoCarousel.tsx`, `SourceEvidenceGallery.tsx`, `VayrinPresentationHeader.tsx` | Place question, original-video evidence, destination photography, truthful area match and reason disclosure. Candidate inspection and selection are separate; active-only photo hydration is preserved. Historical component filenames do not add a character to the product. |
| Multi-place review | `MultiPlaceCandidateCard.tsx`, `PlaceBrowseCarousel.tsx`, shared candidate/evidence components | Individual selection controls and inspection targets, separate source/saved/selected counts, and disabled save when none are selected. Batch save, duplicate, rejection and omission policies are unchanged. |
| Onboarding | `components/onboarding/**`, principally `v2/OnboardingV2PreAuth.tsx`, `Phase1Visuals.tsx`, `ImmersiveGuidedSave.tsx`, `OnboardingV2SecondHalf.tsx` | Photo-led welcome, adaptive shared primitives, scrollable practice sheets and permissions education. `useOnboardingColors` and `usePhase1Colors` adapt to the live theme and memoize styles. Existing durable stage transitions remain. |
| Bundled first save | `FieldnotesPracticeScene.tsx`, `OfflineFixtureVideo.tsx` | Receipt, source thumbnail flight, resolving pin and destination card use bundled fixture assets. The 900ms practice animation has an immediate reduced-motion equivalent. Local silent video becomes a still poster under Reduce Motion. No auth, recognition, provider imagery or map tile request was added to Phase 1. |
| Real sharing practice | `OnboardingV2RealPractice.tsx`, `OnboardingV2MapCoachmark.tsx` | Live durable job reconciliation, exact selected-post launch, error/needs-review states and optional deferral. The map coachmark scrolls within available height. Phase 2 remains a real share flow. |
| Authentication and settings | `app/(onboarding)/account.tsx`, `app/auth-callback.tsx`, `app/(tabs)/settings.tsx`, shared onboarding fields/buttons | Adaptive account/provider/email flows and Settings groups. Existing auth latch, account linking, callback and AuthGate navigation contracts remain. Permission switches and appearance options have labels/state. Legal routes use matching themes. |
| Share Extension | `ShareExtension.tsx`, `native/share-extension/ShareExtensionViewController.swift` | Chosen bundled icon, actual payload identity and supplied local image form the receipt. Sending, accepted, duplicate, failure and uncertain outcomes stay distinct. Native startup/recovery uses dynamic colors, scalable fonts and bounded scrolling. App Group/auth handoff, idempotency, fail-closed environment checks and embedded-bundle selection remain. |
| Startup and failure | `StartupSurface.tsx`, `ErrorBoundary.tsx`, `MapSnackbar.tsx`, shared status and empty surfaces | Readable recovery and status copy with the shared visual system; no fabricated successful save or percent completion. |

## Motion, data and QA boundaries

`SaveArrival.tsx` is a local cue for an already-persisted save and does not move the map camera. It waits for the shared motion preference to become ready before consuming a save identity, and each identity is processed once during the component lifetime. Reduced motion uses only a stationary pin with a short opacity cue; the ring and spark are absent. Practice uses a bundled illustrative map; it is labelled as practice and is not presented as a live geographic view. Receipt entrance, review disclosure and programmatic photo paging honor the shared reduced-motion setting. Direct touch gestures remain available.

The implementation uses existing saved-place, source, reminder, job and auth contracts. This phase does not change recognition prompts/models, backend schemas, production projects or provider cost policy. Displaying a source ribbon or opening Saved does not add a thumbnail lookup. The feature cutoff and compact rows preserve the large-library intent.

`components/FieldnotesNativePreview.tsx` and the Development-only Activity adapter provide review fixtures under explicit Development gates. They are not alternate production screens and are not evidence that a real account performed a save. Native captures must identify fixture versus live-data content.

## Validation inventory

| Evidence | Verified scope | Limit |
| --- | --- | --- |
| `scripts/testFieldnotesFoundation.ts` | 35 checks: 30 semantic foreground/background contrast combinations and five feedback gating/coalescing assertions. | Does not audit every composed pixel or measure hardware feedback. |
| `scripts/testFieldnotesSaveArrival.ts` | Actual hook/component lifecycle: pending preference, one-shot identities, setting races/errors, reduced-motion visuals, background suppression and unmount cleanup. | Deterministic native and animation boundaries; not native frame timing evidence. |
| `scripts/testFieldnotesSavedComponents.ts` | 42 assertions across 0/1/5/20/50/51/100 places; feature cutoff; search/empty states; exact selection; three font-scale branches; snapshot policy. | Actual React components with native host doubles; no native row performance or clipping measurement. |
| `scripts/testOnboardingV2MagicRender.ts` | 24 practice-scene combinations across Light/Dark, 100/150/200% font scales, normal/reduced motion and receipt/place; local assets, text invariant, deterministic processing and resume. | Native-host mocks do not produce native screenshots. |
| `artifacts/fieldnotes-implementation/onboarding-tests/summary.json` | All 29 onboarding contract suites passed, including offline/no-live-service, lifecycle, auth, Phase 2 and navigation contracts. | Source assertions and reducers are not a device journey. |
| `review-extension-phase.json` and review/extension test results | 25 review scripts, 10 extension scripts, 24 actual review component renders and 15 actual extension-root renders. | Native bridge/host mocks; no iOS extension-host acceptance claim. |
| `npm run typecheck` | Integrated TypeScript passes at the phase checkpoint. | Not a Swift compiler or native build result. |

See [FIELDNOTES_ACCESSIBILITY_REPORT.md](FIELDNOTES_ACCESSIBILITY_REPORT.md) for the distinction between implemented accessibility support and remaining native acceptance. Phase-specific commands and baseline-assertion migrations are recorded in [detail-saved-onboarding-tests.json](artifacts/fieldnotes-implementation/detail-saved-onboarding-tests.json); review/extension evidence is recorded in [review-extension-phase.json](artifacts/fieldnotes-implementation/review-extension-phase.json).
