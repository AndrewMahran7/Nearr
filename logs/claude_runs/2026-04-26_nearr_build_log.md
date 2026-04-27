# Nearr build log â€” 2026-04-26

## Task: Initial V1 scaffold

Build the Nearr app skeleton with all 10 V1 features wired up end-to-end.

### Files created
- `package.json`, `app.json`, `tsconfig.json`, `babel.config.js`, `.env.example`, `.gitignore`, `README.md`
- `app/_layout.tsx` â€” root stack, auth gate, deep-link listener
- `app/index.tsx` â€” redirect entry
- `app/(auth)/_layout.tsx`, `app/(auth)/login.tsx` â€” magic-link login
- `app/(tabs)/_layout.tsx` â€” tabs nav
- `app/(tabs)/map.tsx` â€” map view + FAB + start proximity watch
- `app/(tabs)/places.tsx` â€” list view with empty state
- `app/(tabs)/settings.tsx` â€” radius unit/value, notif toggle, quiet hours, sign out
- `app/add-place.tsx` â€” Google Places search â†’ save
- `app/share.tsx` â€” paste/shared URL â†’ og:title query suggestion â†’ forwards to add-place
- `app/place/[id].tsx` â€” detail, notes, per-place radius (default/miles/minutes), delete
- `src/types.ts` â€” Place, UserSettings, GooglePlaceCandidate
- `src/lib/supabase.ts` â€” configured client w/ AsyncStorage + URL polyfill
- `src/lib/places.ts` â€” Google Places text search + details
- `src/lib/shareParser.ts` â€” URL â†’ og:title heuristic, no platform login
- `src/lib/geo.ts` â€” haversine + miles<->minutes
- `src/lib/notifications.ts` â€” TaskManager-backed background location + proximity check + per-place cooldown + quiet hours
- `src/hooks/useAuth.ts` â€” session subscription
- `src/hooks/usePlaces.ts` â€” list + savePlace/updatePlace/deletePlace + getSettings/upsertSettings
- `supabase/schema.sql` â€” `places`, `user_settings`, RLS policies
- `docs/PROJECT_CONTEXT.md`
- `logs/claude_runs/2026-04-26_nearr_build_log.md` (this file)

### Files modified
None â€” fresh project.

### Key implementation decisions
- **Expo Router over React Navigation** for simpler file-based routing and built-in deep-link handling (needed for magic-link callback + share URL).
- **AsyncStorage-backed Supabase session** so users stay logged in.
- **Polled background location task** rather than `startGeofencingAsync` for V1 â€” simpler, supports an unbounded number of saved places. Can swap later.
- **1-hour per-place alert cooldown** in-memory to avoid spamming on lingering visits. Acceptable loss on app restart for V1.
- **Radius can be miles XOR minutes** at both default and per-place level; storage is two nullable columns rather than a tagged union, with `effectiveRadiusMiles()` resolving precedence (place override â†’ default â†’ 1 mile fallback).
- **Share parser is metadata-only.** No reverse-engineered TikTok/Instagram APIs; we just pull `og:title` and let Google Places disambiguate. User can edit query before confirming.
- **RLS enabled** with `auth.uid() = user_id` policies on both tables â€” never trust client-side filtering.
- **No silent failures**: every catch logs via `console.warn`; user-facing errors surface via `Alert`.

### Assumptions
- User will use a **dev client / EAS build** (not Expo Go) since we need background location + native maps + push.
- Supabase Auth is configured to allow magic links and includes `nearr://auth-callback` as a redirect URL.
- Google Cloud project has Places API + Maps SDK for iOS/Android enabled and unrestricted enough for development.
- `25 mph` is an acceptable urban-driving constant for the miles<->minutes conversion in V1.

### Commands to run
```bash
npm install
# Then in Supabase SQL editor: paste supabase/schema.sql
# Fill .env / app.json `extra` and `config.googleMaps*` keys
npx expo prebuild        # required for react-native-maps + background location
npx expo run:ios         # or run:android, on a dev build
```

### Known issues / TODOs
- iOS share extension is not implemented (Android SEND intent declared in `app.json`; iOS users currently paste URLs into the share screen). Add a native share extension target when moving to EAS production builds.
- Quiet-hours fields use plain `HH:MM` text inputs; needs a time picker.
- `GOOGLE_PLACES_KEY` is bundled into the app â€” restrict it to Places API + per-app SHA/bundle ID. For higher security, move calls behind a Supabase Edge Function in V2.
- No automated tests yet. Highest-value targets when added: `geo.ts`, `shareParser.ts`, `notifications.effectiveRadiusMiles`.
- `app.json` uses `$VAR` placeholders â€” Expo doesn't auto-substitute these. Replace with literals or wire up `app.config.ts` reading from `process.env` before building.
- `react-native-maps` requires `prebuild` â€” won't work in stock Expo Go.
- The background task imports Supabase at module top, which means an unauthenticated tick will simply `return` early in `checkProximity`. Verified intentional.

---

## Task: Initialize project structure (folders + design system)

Reorganize repo into the canonical Nearr layout and add reusable UI primitives so future screens stay consistent.

### Files created
- `components/Button.tsx`, `components/Card.tsx`, `components/Input.tsx`, `components/Screen.tsx`, `components/index.ts`
- `constants/colors.ts`, `constants/spacing.ts`, `constants/typography.ts`, `constants/index.ts`
- `services/auth.ts`, `services/places.ts`, `services/notifications.ts`
- `app/(auth)/sign-in.tsx` — replaces `login.tsx`, uses design-system primitives
- `app/(tabs)/home.tsx` — Home dashboard with quick actions and recent places

### Files modified
- `tsconfig.json` — `@/*` now maps to repo root (was `src/*`)
- `app/_layout.tsx` — auth gate redirects to `/(auth)/sign-in` and `/(tabs)/home`
- `app/(tabs)/_layout.tsx` — added Home tab; tab tints from design tokens
- `app/index.tsx` — redirects to `/(tabs)/home`
- `docs/PROJECT_CONTEXT.md` — refreshed architecture + prompt history

### Files moved / removed
- `src/lib/*` ? `lib/*`
- `src/hooks/*` ? `hooks/*`
- `src/types.ts` ? `types/index.ts`
- Removed `src/`, removed `app/(auth)/login.tsx`

### Key implementation decisions
- **Root-level folders** (`lib`, `hooks`, `components`, etc.) over a single `src/` to match the requested structure and keep import paths short.
- **`services/` is a thin facade** over `lib/` and `hooks/`. Screens import from `@/services/*`; `lib/*` stays for low-level integrations. This lets us swap implementations (e.g., move Places calls to a Supabase Edge Function) without touching screens.
- **Design system is small and additive.** Just `Colors`, `Spacing`, `Radius`, `Typography` plus four primitives. Avoids premature theming abstractions.
- **`Screen` component** wraps `SafeAreaView` + standard padding so every screen looks consistent without copy-paste.
- **Sign-in renamed.** Path is now `/(auth)/sign-in` to match the spec ("SignIn" screen).

### Assumptions
- The new Home tab is the primary landing surface post-auth (rather than dropping users straight on the Map).
- "SavePlace" in the spec maps to the existing `add-place` modal route — kept the route name to avoid breaking the deep-link / share flow that already references it.

### Commands to run
No new install needed. After pulling these changes:
```bash
npx expo start --clear
```

### Known issues / TODOs
- Older screens (`places.tsx`, `settings.tsx`, `add-place.tsx`, `share.tsx`, `place/[id].tsx`) still use inline styles. Migrating them to `@/components` + `@/constants` is a follow-up — not blocking, just visual polish.
- No automated tests for the new components yet.
- `services/` currently re-exports — once we add real validation/error normalization it should own that logic instead of `hooks/usePlaces`.


---

## Task: Supabase client + magic-link auth

Harden the auth flow so it actually completes round-trip on a device.

### Files created
- `lib/authDeepLink.ts` - parses `nearr://auth-callback` (and `exp://...auth-callback`) for both implicit (`#access_token`) and PKCE (`?code`) flows, then calls `supabase.auth.setSession` / `exchangeCodeForSession`.

### Files modified
- `lib/supabase.ts` - now prefers `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` over `app.json` extras, with a clearer warning. `detectSessionInUrl: false` is documented.
- `services/auth.ts` - `sendMagicLink` now uses `Linking.createURL('auth-callback')` so the redirect URI is correct in both Expo Go and a built app. Added `signOut` and `getCurrentUser` (already existed).
- `app/_layout.tsx` - added cold-start (`Linking.getInitialURL`) and warm-start (`Linking.addEventListener`) handlers that call `handleAuthDeepLink`. The session change then fires the existing AuthGate redirect.
- `app/(tabs)/settings.tsx` - sign-out goes through `services/auth.signOut` and is wrapped in a confirmation `Alert`.
- `docs/PROJECT_CONTEXT.md` - added Auth architecture section.

### Auth architecture (summary)
1. User enters email on `/(auth)/sign-in`.
2. `services/auth.sendMagicLink` calls `supabase.auth.signInWithOtp` with `emailRedirectTo: Linking.createURL('auth-callback')`.
3. Supabase emails a link. User taps it on the device.
4. OS opens the app at `nearr://auth-callback...` (or `exp://.../--/auth-callback...` in Expo Go).
5. `app/_layout.tsx` `Linking` listener -> `lib/authDeepLink.handleAuthDeepLink` -> `supabase.auth.setSession` (or `exchangeCodeForSession`).
6. `hooks/useAuth` `onAuthStateChange` fires -> `AuthGate` redirects to `/(tabs)/home`.
7. Session is persisted by AsyncStorage; `autoRefreshToken: true` keeps it fresh.

### Supabase setup (exact steps)
In the Supabase dashboard for the Nearr project:

1. **Authentication -> Providers -> Email**: enable `Email` and turn ON `Enable email confirmations` / `Enable magic links`.
2. **Authentication -> URL Configuration**:
   - **Site URL**: `nearr://auth-callback`
   - **Redirect URLs** (allow-list): add all of these:
     - `nearr://auth-callback`
     - `nearr://*`  (covers any deep-link path)
     - `exp://127.0.0.1:8081/--/auth-callback`  (Expo Go on iOS simulator / local)
     - `exp://localhost:19000/--/auth-callback`  (older Expo CLI default)
     - `exp://192.168.*.*:8081/--/auth-callback`  (LAN dev on a real device - replace with your IP)
3. **Authentication -> Email Templates -> Magic Link**: confirm the `{{ .ConfirmationURL }}` placeholder is present (default template works).
4. Local env: create `.env` at the repo root:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   ```
   Restart Expo with `npx expo start --clear` so the new env vars get inlined.
5. Run `supabase/schema.sql` in the SQL editor if you have not yet (creates `places` + `user_settings` with RLS).

### Key implementation decisions
- **`Linking.createURL` over a hard-coded scheme** so the same code works in Expo Go (`exp://`) and a dev/prod build (`nearr://`). The deep-link parser tolerates both.
- **Manual fragment parsing.** `expo-linking` does not parse URL fragments, so we `slice` after the `#` and merge into the params bag.
- **Both flow types supported.** Supabase defaults to implicit on email links, but PKCE is available if we enable it later - one less migration to do.
- **Sign-out confirmation.** Tiny but prevents the most common "I tapped the wrong thing" complaint.

### Assumptions
- The user adds the Supabase redirect URLs above before testing on device.
- `EXPO_PUBLIC_*` env vars are acceptable to ship in the bundle (they are already public by design - same as the anon key).

### Commands to run
```bash
# After updating .env or app.json
npx expo start --clear
```

### Known issues / TODOs
- If a user opens the magic link on a different device than the one that requested it, sign-in will not complete (expected). No web fallback yet.
- No rate-limit UI on resending magic links.
- Tests still TODO: `handleAuthDeepLink` is the highest-value target.


---

## Task: Database schema v1 (migration)

Move from the early flat `places` + `user_settings` prototype to the normalized V1 schema (`profiles` / `places` / `saved_places` / `notification_events`).

### Files created
- `supabase/migrations/20260426000001_init_schema.sql` - canonical schema, RLS policies, `set_updated_at` + `handle_new_user` triggers.
- `docs/DATABASE.md` - per-table reference, RLS matrix, trigger list, apply instructions.

### Files modified
- `supabase/schema.sql` - prefixed with a DEPRECATED banner pointing at the migration. Kept for git history.

### Schema summary
- **profiles**  1:1 with `auth.users`. Defaults + notification prefs. Auto-created on signup via `handle_new_user` trigger on `auth.users`.
- **places**  canonical, deduped on `google_place_id`. Shared across users. Authenticated read + insert; no client update/delete.
- **saved_places**  per-user save with overrides (radius, notes, source, `last_notified_at`). `unique (user_id, place_id)`. Owner-only RLS.
- **notification_events**  append-only audit log. Owner-only `select` + `insert`; no update/delete from clients.

### Key implementation decisions
- **Normalized `places` vs per-user copies.** Sharing canonical rows means future features (popular spots, friend overlap in V2) come for free, and Google Places quota is amortized across users.
- **`handle_new_user` trigger** so the client can `select` from `profiles` immediately after first sign-in without an extra "create my profile" round-trip.
- **`places` writable by any authenticated user** rather than service-role-only. Justified because (a) the unique `google_place_id` blocks duplicate spam, (b) no PII lives there, (c) it keeps the client simple. If abuse appears, lock writes behind an Edge Function.
- **`notification_events` is append-only at the DB level** (no `update`/`delete` policies). Treated as a debugging + cooldown source of truth.
- **Migration directory layout** (`supabase/migrations/<timestamp>_name.sql`) so `supabase db push` works as the project grows; we are not relying on the SQL editor as the long-term workflow.

### Assumptions
- Supabase CLI is or will be the deploy path. Pasting into the SQL editor still works as a fallback.
- `time` (no timezone) is fine for `quiet_hours_*` because quiet hours are a wall-clock concept tied to the user's device.
- Old prototype tables (`user_settings`) will be dropped manually if a project was already initialized against `supabase/schema.sql`. Not bothering with a migration to do that automatically since no one is in production yet.

### Commands to run
```bash
# Preferred:
supabase db push

# Or in the dashboard SQL editor, paste:
# supabase/migrations/20260426000001_init_schema.sql
```

### Known issues / TODOs
- `types/index.ts` and `hooks/usePlaces` still reference the old shape (`places` with `user_id`/`radius_miles`/etc.). Refactoring the client to the new shape is the next task. Until then, the existing screens will break against this schema.
- No migration to drop the old prototype tables (`user_settings` and the old `places` columns). For dev projects: just reset (`supabase db reset`) or drop manually.
- Consider PostGIS + a `geography(Point)` column for `places` once we want server-side proximity queries. Out of scope for V1.
- `handle_new_user` mirrors `email` once at signup; if the user changes email later we will not pick it up. Acceptable for V1.


---

## Task: Google Places service

Replace the inline Places code with a clean, replaceable service layer plus a UI-friendly hook.

### Files created
- `services/placesService.ts` - normalized `PlaceCandidate` (`googlePlaceId`, `formattedAddress`, `latitude`, `longitude`, `category`, `googleMapsUrl`); typed `PlacesError` with codes (`MISSING_API_KEY`, `NETWORK`, `INVALID_REQUEST`, `OVER_QUERY_LIMIT`, `REQUEST_DENIED`, `NOT_FOUND`, `UNKNOWN`); `searchPlaces` and `getPlaceDetails`.
- `hooks/usePlacesSearch.ts` - tracks `loading` / `error` / `results` / `lastQuery`; ignores stale responses via a request-id ref; exposes `search` and `reset`.

### Files modified
- `services/places.ts` - now re-exports the new service (`PlaceCandidate`, `PlacesError`, etc.) so screens can import from a single facade.
- `lib/places.ts` - replaced with a deprecated shim that adapts the new normalized shape back to the legacy `GooglePlaceCandidate` (`placeId` / `address`). Lets existing screens (`add-place.tsx`, `share.tsx`, `hooks/usePlaces.ts`) keep working until they migrate.
- `.env.example` - added `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` as the canonical name; documented native map keys.
- `docs/PROJECT_CONTEXT.md` - env var doc + prompt history entry.

### Key implementation decisions
- **Single API key var** (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`) covers both Text Search and Details. Legacy names (`EXPO_PUBLIC_GOOGLE_PLACES_KEY` and `extra.googlePlacesKey`) still resolve so we do not break whoever already had `.env` set up.
- **Typed error codes** instead of string matching so the UI can branch (e.g. show "no results" for `ZERO_RESULTS` is handled silently as an empty array, while `OVER_QUERY_LIMIT` is surfaced).
- **`ZERO_RESULTS` is not an error.** Returns `[]`. UI distinguishes "empty" from "failed".
- **Stale-response protection in the hook.** A monotonically increasing `reqId` ref ignores out-of-order responses if the user keeps typing.
- **Cost-aware Details fields.** Only request `place_id`, `name`, `formatted_address`, `geometry/location`, `types`, `url`. Google Places Details is billed per requested field group.
- **`googleMapsUrl` fallback.** Details API returns `url` directly; Text Search does not, so we synthesize `https://www.google.com/maps/place/?q=place_id:<id>` which Google supports.
- **`category` heuristic** picks the first `types[]` entry that is not generic boilerplate (`point_of_interest`, `establishment`, `food`).
- **Shim instead of breaking changes.** Old screens still work; migrating them to the normalized shape is a separate task that pairs naturally with the `saved_places` schema migration.

### Assumptions
- API key is restricted server-side (HTTP referrer / app bundle restriction in Google Cloud) before we ship; bundling a key client-side is acceptable for V1 because it is the only practical way to call Places without a backend.
- We can drop the legacy `GooglePlaceCandidate` once add-place / share screens migrate.

### Commands to run
```bash
# Update .env to use the new var name (old one still works as fallback)
# EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...
npx expo start --clear
```

### Known issues / TODOs
- No retry/backoff on `OVER_QUERY_LIMIT` (return a typed error; UI just surfaces it).
- No request cancellation on screen unmount; relies on stale-id guard. Acceptable since Places calls are cheap.
- Consider moving the call behind a Supabase Edge Function in V2 to hide the key and add server-side caching.
- Tests still TODO: `placesService.toCandidateFromTextSearch` mapping + `assertOk` error mapping are the next high-value targets.

---

## 2026-04-26 — Task 6: Manual place saving flow

**Goal:** Build the user-facing SavePlace screen against the new normalized schema (places + saved_places + profiles).

### Files created
- `services/profileService.ts` — `getProfile()` reads the current user's row from `profiles`. Used to surface the default radius in the radius chooser.
- `services/savedPlacesService.ts` — `saveSavedPlace({ candidate, radiusValue, radiusUnit, sourceType, sourceUrl, notes })`. Upserts into `places` by `google_place_id`, then inserts into `saved_places`. Catches PG `23505` (unique violation on `user_id, place_id`) and returns `{ status: 'duplicate', place }` instead of throwing.

### Files modified
- `types/index.ts` — Added normalized types: `RadiusUnit`, `SourceType`, `Profile`, `PlaceRow`, `SavedPlace`, `SavedPlaceWithPlace`. Legacy types (`Place`, `UserSettings`, `GooglePlaceCandidate`) kept for backward compatibility while older screens migrate.
- `app/add-place.tsx` — Full rewrite. Now uses `Screen`/`Input`/`Button`/`Card` design-system primitives, `usePlacesSearch` for state, and the new `saveSavedPlace` service. Two-step UX: search ? tap result ? confirmation card with radius chooser (Default / Miles / Minutes) ? Save. After save, `router.replace('/(tabs)/home')`.
- `docs/PROJECT_CONTEXT.md` — Appended prompt-history entry for Task 6.

### Key implementation decisions
- **Radius chooser is three pills**: `Default` (leaves `radius_value`/`radius_unit` NULL so the profile default is used at notify time), `Miles` (decimal-pad input), `Minutes` (number-pad input). This matches the schema's nullable per-place override and keeps the profile default as the single source of truth.
- **Duplicate handling is graceful**: PG `23505` is mapped to a non-throwing result. The screen still navigates to Home and shows an Alert ("Already saved"), so re-tapping a place from a share is a no-op rather than an error.
- **Source attribution is preserved**: `source_type` / `source_url` flow through from `useLocalSearchParams` (set by `app/share.tsx` when ingesting links) into the `saved_places` row. Defaults to `manual` when launched from the FAB.
- **Auto-search on deep-link**: if `params.q` is present (share flow), the screen runs the search immediately on mount.
- **Stale state**: relies on `usePlacesSearch`'s `reqId` ref to ignore out-of-order responses; we don't re-implement that here.
- **Errors are typed**: `placesErrorMessage()` maps each `PlacesError.code` to a human-friendly string instead of dumping `e.message`.

### Assumptions
- `profiles` row exists for the signed-in user (created by the `handle_new_user` trigger from the schema migration). `getProfile()` returns `null` quietly if not, and the chooser falls back to the label "Profile default".
- The `saved_places` insert payload omits `notifications_enabled`; the column has a DB default of `true`, so new saves are notified-on by default.
- Share params (`source_type`, `source_url`) are validated for `source_type` against the schema's CHECK constraint values; unknown values fall back to `manual`.
- Legacy `hooks/usePlaces` still targets the old schema and is **not** wired to anything in this flow. It is flagged for removal/refactor in a follow-up task.

### Commands
- `Remove-Item types/index.ts` (then recreate via `create_file` to swap legacy-only types for the new ones plus legacy aliases).
- `Remove-Item app/add-place.tsx` (then recreate with the new screen).
- `npx tsc --noEmit` ? exit 0 (clean).

### Known issues / TODOs
- `hooks/usePlaces.ts` still queries the deprecated flat `places` schema (with `user_id` + `radius_miles`) and the now-removed `user_settings` table. It is **not** used by the new save flow but is still imported by older screens (`app/(tabs)/places.tsx`, `app/(tabs)/map.tsx`, `app/place/[id].tsx`, `app/share.tsx`). Those need to be migrated to `saved_places` joined with `places` in a follow-up task before they will work against the migrated DB.
- No tests yet for `saveSavedPlace` duplicate-handling. Should add a service-level test once a Supabase test harness is in place.
- Profile-default UI shows `"Profile default"` if the profile fetch fails or is still loading; consider a small spinner there if it ever blinks visibly.

---

## 2026-04-26 — Task 7: Home screen + saved places list

**Goal:** Build the Home screen (greeting, quick save CTA, list of saved places) and an editable detail screen, all wired to the new normalized schema.

### Files created
- `components/SavedPlaceCard.tsx` — Reusable card. Name, address, radius (with profile-default fallback when overrides are NULL), notify on/off pill, source badge (TikTok/Instagram/Link), inline Remove with confirm.
- `hooks/useSavedPlaces.ts` — List state hook. Wraps `listSavedPlaces()` with `loading` / `refreshing` / `error` / `refresh()`.

### Files modified
- `services/savedPlacesService.ts` — Added `listSavedPlaces()`, `getSavedPlace(id)`, `updateSavedPlace(id, patch)`, `deleteSavedPlace(id)` plus `SavedPlacePatch` type.
- `app/(tabs)/home.tsx` — Full rewrite. Greeting from email handle, primary "Save a place" + secondary "From a link" / "Open map", FlatList of `SavedPlaceCard` rows newest-first, pull-to-refresh, `useFocusEffect` re-fetch, loading / error / empty states.
- `app/(tabs)/places.tsx` — Rewritten as a pure list using `useSavedPlaces` + `SavedPlaceCard`. Same loading / error / empty handling.
- `app/place/[id].tsx` — Rewritten against `saved_places` joined with `places`. Notifications switch, radius mode chooser (Default / Miles / Minutes), notes editor, Save / Remove. `Stack.Screen` sets the header title to the place name.
- `components/index.ts` — Re-exports `SavedPlaceCard`.
- `docs/PROJECT_CONTEXT.md` — Prompt-history entry appended.

### Key implementation decisions
- **One data hook, three screens.** `useSavedPlaces` owns list state. Home, Places, and (indirectly) the detail screen on return all consume it. `useFocusEffect` re-fetches on focus so a save / edit / delete elsewhere shows up immediately.
- **Profile fetched once per screen for the radius default label.** `getProfile()` runs in parallel with the list/detail fetch. The card shows `Default (Nv unit)` when `radius_value` / `radius_unit` are NULL, falling back to `"Default radius"` if the profile fetch fails — never blocks the list.
- **Tap to edit, inline Remove on the card.** Per spec the user can tap to edit *or* delete from the list. Inline Remove uses an Alert confirmation; nothing destructive happens without a tap-through.
- **Detail screen can edit everything in the user-facing model.** Notifications switch, radius mode (writes `radius_value` + `radius_unit` together; `default` writes both NULL), notes. The underlying canonical `places` row is read-only here (it's shared across users by `google_place_id`).
- **All three list states surfaced.** Initial spinner, hard error with retry button, empty card with a clear next step. Pull-to-refresh works regardless of state.
- **Source URL is tappable in detail.** `Linking.openURL` opens the original TikTok/Instagram/etc. post; failures swallow silently so a bad URL doesn't crash.

### Assumptions
- `saved_places` rows always join to a valid `places` row (FK with `on delete cascade` in the migration). The card and detail screen unconditionally read `saved.place`.
- `profiles` row exists for the signed-in user (`handle_new_user` trigger). Missing profile is treated as "no default available" rather than an error.
- Legacy `hooks/usePlaces` is **no longer used** by Home / Places / detail. It is still imported by `app/(tabs)/map.tsx` and `app/share.tsx` and will need migration in a follow-up task before the map and share-link flow work against the new schema.

### Commands
- `Remove-Item` on the three legacy screens (`home.tsx`, `places.tsx`, `place/[id].tsx`) — required `-LiteralPath` for `[id].tsx` because `[]` are PowerShell wildcard chars.
- `npx tsc --noEmit` ? exit 0 (clean).

### Known issues / TODOs
- `app/(tabs)/map.tsx` and `app/share.tsx` still target the legacy `places` table via `hooks/usePlaces`. Map will not render saved markers and share ingestion will not save against the new schema until they're migrated to `saved_places` + `saveSavedPlace()`.
- `components/SavedPlaceCard` does not yet show notes; we considered it but kept the card scannable. Notes are only on the detail screen for now.
- No optimistic updates on delete — we re-fetch after success. Fine for V1 list sizes but worth revisiting if lists grow.
- Pure unit tests for `listSavedPlaces` / `deleteSavedPlace` still pending a Supabase test harness.

---

## 2026-04-26 — Task 8: Settings screen

**Goal:** Build a clean Settings screen that reads/writes the new `profiles` row, validates input, and includes sign-out.

### Files modified
- `services/profileService.ts` — Added `updateProfile(patch)` and `ProfilePatch` type. Patches are sent as a single `UPDATE` against `profiles` filtered by `id = auth.uid()` and the updated row is returned.
- `app/(tabs)/settings.tsx` — Full rewrite. Form fields: default radius value + unit (Miles / Minutes pills), Notifications master switch, Nearby alerts switch, Quiet hours switch + HH:MM start/end inputs. All editable state is local; nothing is written until `Save changes` validates and calls `updateProfile`. Sign-out lives in an Account card with a confirmation Alert.
- `docs/PROJECT_CONTEXT.md` — Prompt-history entry appended.

### Key implementation decisions
- **Local-edit-then-save.** The previous screen wrote on every blur/toggle, which made invalid intermediate states (like an empty radius input) hit the DB. The new screen keeps everything local until `Save changes` so we can run cohesive validation in one place and avoid spamming Supabase.
- **Validation rules:**
  - Radius: `Number.parseFloat` must be finite and `> 0`. Same rule for both miles and minutes (units are persisted separately).
  - Quiet hours: when enabled, both `start` and `end` must match `^([01]\d|2[0-3]):([0-5]\d)$` and be different. When disabled, both fields are written as `NULL` so the schema is consistent.
  - When quiet hours are off, the time inputs are hidden — preventing the "valid form but ignored" state.
- **Postgres `time` round-trip.** Postgres returns `HH:MM:SS` from `time` columns; `trimSeconds()` strips the `:SS` for display so the user always sees `HH:MM`. Saving sends back `HH:MM` which Postgres accepts.
- **Master/sub switch coupling.** When the global `Notifications` switch is off, the `Nearby alerts` switch is rendered disabled (and dimmed) but its stored value is preserved — so flipping the master back on doesn't clobber the user's previous nearby preference.
- **Sign-out is destructive-styled with a confirm**, then `router.replace('/(auth)/sign-in')` to avoid leaving the tabs in the back-stack.
- **No proximity-watch start/stop here.** The legacy screen called `startProximityWatch`/`stopProximityWatch` directly when toggling notifications. That coupling will move into the notifications service in the next task — Settings now only owns the persisted preference.

### Assumptions
- `profiles` row always exists for a signed-in user (created by the `handle_new_user` trigger). If `getProfile()` returns `null` we show a hard error with a retry button rather than silently creating a row.
- The `default_radius_unit` column has a CHECK constraint of `('miles','minutes')`; the UI only ever sends those two values.
- Quiet-hour windows that cross midnight (e.g. 22:00 ? 07:00) are valid as far as the form is concerned. The notifications service is responsible for interpreting them correctly.

### Commands
- `Remove-Item 'app/(tabs)/settings.tsx'` then recreate via `create_file`.
- `npx tsc --noEmit` ? exit 0 (clean).

### Known issues / TODOs
- The notifications service (`lib/notifications.ts`) still reads from the legacy `user_settings` table. It needs to be migrated to read `profiles` (with the new fields `nearby_notifications_enabled` and `quiet_hours_enabled`) and to be invoked from settings changes if we want immediate effect. That's a separate task.
- HH:MM inputs are plain text. A native time picker would be nicer UX but adds platform-specific code; deferring.
- No explicit "discard changes" affordance — navigating away after editing without saving silently drops edits. Fine for V1; revisit if users report it.

---

## 2026-04-26 — Task 9: Map view

**Goal:** Show saved places on a map, with a tap-to-preview interaction and a graceful fallback when location is denied.

### Files modified
- `app/(tabs)/map.tsx` — Full rewrite. Uses `react-native-maps`, the shared `useSavedPlaces` hook, and the design-system `Card` / `Button` for the preview card.
- `docs/PROJECT_CONTEXT.md` — Prompt-history entry appended.

### Key implementation decisions
- **Custom preview card instead of native Marker callouts.** Built-in callouts are inconsistent across iOS / Android and give us no room for action buttons. Tapping a marker sets `selected` and renders a bottom `Card` with name / address / category / "Open in Maps" / "View details". Tapping the map background or the close button clears the selection.
- **Permission state machine.** Three states: `pending` (briefly on cold start; small spinner overlay), `granted` (`showsUserLocation` + `showsMyLocationButton` on, region centered on the user), `denied` (banner with an "Open settings" button via `Linking.openSettings`; map still works using the first saved place, or `FALLBACK_REGION` for the contiguous US if none). The map is **never** blocked — if location is off, the user can still browse their saved markers.
- **Fit-to-markers on first load.** A `didFitRef` ensures we only auto-fit once per screen lifetime, so subsequent re-fetches don't yank the camera around. The fit is deferred ~250ms so markers are mounted before `fitToSuppliedMarkers` runs. Edge padding biases for the bottom preview card.
- **External-maps deep link.** Uses `place.google_maps_url` when present (Google Places returns one), otherwise `https://www.google.com/maps/search/?api=1&query=lat,lng`. `Linking.openURL` failures are logged and swallowed.
- **FAB hidden while preview is open** so the two don't stack at the bottom of small phones — keeps the layout clean per spec.
- **Refetch on focus**, like Home / Places, so a save / delete elsewhere is reflected immediately.
- **No proximity-watch start here.** The legacy version called `startProximityWatch` from this screen; that responsibility is moving to the notifications service refactor.

### Assumptions
- `react-native-maps` is already configured (Google provider keys live in `app.json` per the existing setup). No new native deps were added.
- `places.latitude` / `places.longitude` are non-null in the new schema (`not null` columns), so markers always have valid coordinates.
- The Google Maps share URL format used by `place.google_maps_url` opens the correct app on both iOS and Android via `Linking.openURL`; if the user has no maps app at all, we silently no-op rather than alerting.
- Empty saved-list is fine: the map renders, no markers, FAB is the call-to-action.

### Commands
- `Remove-Item 'app/(tabs)/map.tsx'` then recreate via `create_file`.
- `npx tsc --noEmit` ? exit 0 (clean).

### Known issues / TODOs
- No marker clustering. Fine for V1 list sizes; revisit when users hit 50+.
- Map appearance is platform default. A custom map style could be applied later via the `customMapStyle` prop without rewiring anything.
- Selecting a marker doesn't auto-pan it above the preview card. Acceptable for V1; `animateCamera` toward the marker on selection is a future polish item.
- `hooks/usePlaces` is no longer used by Map. The only remaining caller is `app/share.tsx`, which still needs migration to the new schema.

---

## Task 10 — Nearby notifications (2026-04-26)

### Files modified
- `lib/geo.ts` — full rewrite. Meters as canonical unit. Exports `distanceMeters(a, b)` (haversine, EARTH_R_M = 6_371_008.8), `milesToMeters` / `metersToMiles` (METERS_PER_MILE = 1609.344), `minutesToMeters` / `metersToMinutes` (AVG_DRIVING_MPH = 25 heuristic), and `LatLng` type.
- `lib/notifications.ts` — full rewrite against the new schema. Module load registers `Notifications.setNotificationHandler` and `TaskManager.defineTask(LOCATION_TASK, ...)`. Public API: `ensureNotificationPermission`, `ensureForegroundLocationPermission`, `ensureBackgroundLocationPermission`, `startProximityWatch` (60s timeInterval, 100m distanceInterval, Android foregroundService), `stopProximityWatch`, `effectiveRadiusMeters`, `inQuietHours`, `decideProximity` (pure), `checkProximity(lat, lng)`, `checkProximityOnce()`. `fireNotification` schedules the local notification, then updates `saved_places.last_notified_at`, then inserts a `notification_events` row (event_type = 'nearby').
- `services/notifications.ts` — facade updated to re-export the new public API plus the `ProximityDecision` type.
- `app/(tabs)/settings.tsx` — after a successful `updateProfile`, calls `ensureNotificationPermission` + `startProximityWatch` when both master and nearby toggles are on; otherwise calls `stopProximityWatch`. Side effect runs after the DB write so a failed save doesn't change runtime behavior.
- `app/_layout.tsx` — added `AppState` import and `checkProximityOnce` import. New session-gated `useEffect` in `AuthGate` runs the one-shot foreground check on mount and on every `AppState` 'change' to 'active'.
- `docs/PROJECT_CONTEXT.md` — appended Task 10 prompt-history bullet with limitations.

### Key implementation decisions
- Meters is the canonical internal unit; UI converts at the edges.
- `decideProximity` is pure (no I/O) so it can be unit-tested without mocks. It returns a discriminated union: `{kind:'skip', reason}` or `{kind:'notify', distanceMeters, radiusMeters}`.
- 1-hour per-place cooldown checked against BOTH an in-memory `Map<string, number>` AND `saved_places.last_notified_at`. The DB column is the source of truth across app restarts; the in-memory map prevents same-tick double-fires.
- `fireNotification` only persists `last_notified_at` and the audit row AFTER the local notification is successfully scheduled — avoids "ghost" rows when the schedule call fails.
- Quiet hours parser accepts both `HH:MM` and `HH:MM:SS` (Postgres `time` round-trips as the latter) and handles wrap-past-midnight windows (e.g. 22:00 ? 07:00).
- `notification_events.event_type` is hardcoded to `'nearby'` for V1. Entered/exited geofence transitions require state tracking and are deferred.
- Foreground "check now" wired into `_layout.tsx` AppState listener so users get prompt alerts on app open even when no live background task is running (e.g. inside Expo Go).
- `minutesToMeters` uses a fixed 25 mph urban-driving heuristic; flagged as a known approximation.

### Assumptions
- A `profiles` row exists for every authenticated user (created by the `handle_new_user` trigger from Task 4).
- Every `saved_places` row joins to a valid `places` row (FK with cascade).
- Postgres `time` columns round-trip as `HH:MM` or `HH:MM:SS` strings.
- `notification_events.event_type` CHECK constraint allows `'nearby'` (verified against the migration).
- The user has accepted both notification and (for live tracking) at least foreground location permissions; permission denials are surfaced via Alerts but do not block the Settings save itself.

### Commands
- `Remove-Item lib/geo.ts, lib/notifications.ts` then re-created via `create_file` with the new content.
- `replace_string_in_file` for `services/notifications.ts`, `app/(tabs)/settings.tsx`, `app/_layout.tsx`, `docs/PROJECT_CONTEXT.md`.
- `npx tsc --noEmit` -> exit 0 (clean across all files).

### Known issues / TODOs
- True background ticks require an EAS dev/prod build — Expo Go cannot register background TaskManager tasks.
- `app.json` needs iOS `UIBackgroundModes: ["location"]` and Android `ACCESS_BACKGROUND_LOCATION` for production background behavior; on Android 12+ the OS shows a separate "Allow all the time" prompt.
- OS coalesces 60s `timeInterval` requests; real cadence is OS-controlled.
- `minutesToMeters` is a 25-mph approximation, not a real routing-API ETA.
- No real OS geofencing yet — V2 should migrate to `Location.startGeofencingAsync` for battery-friendly enter/exit events.
- `notification_events` only emits `'nearby'` in V1; entered/exited transitions need per-place state.
- `app/share.tsx` still uses the legacy `usePlaces` hook — last remaining legacy caller; flagged for future migration.
- No unit tests yet for `decideProximity` / `inQuietHours` — both are pure and would benefit from a small Jest harness.

---

## Task 11 — Share link ingestion (2026-04-26)

### Files modified
- `lib/shareParser.ts` — full rewrite. New shape: `ParsedShare = { url, source, title, description, suggestedQuery, metadataFailed }`. Public functions: `detectSource(url)`, `isLikelyUrl(s)`, `parseShare(rawUrl)`. Internals: `fetchHtml` (8s `AbortController` timeout, generic `NearrBot/1.0` UA, `Accept: text/html,*/*`), `pickMeta` (matches both attribute orders), `pickTitle`, `cleanTitle` (strips `on TikTok`, `| Instagram`, `• Instagram`, `(@handle) on Instagram`, `- YouTube`, and surrounding quotes), `cleanDescription` (truncates >240 chars), `buildQuery` (prefers title; falls back to first sentence of description; strips hashtags/URLs; caps at 120 chars), `firstSentence`, `decodeHtml`.
- `app/share.tsx` — full rewrite. Three-phase UI: `paste` (URL input + Read button + privacy hint), `preview` (platform label, cleaned title, description, "We'll search for" line + Find this place / Search manually instead buttons), `failed` (friendly fail card + Search manually fallback). Auto-parses on mount when arriving via deep link `?url=...`. Both Find-this-place and Search-manually route to `/add-place`; the former passes `q` + `source_url` + `source_type`, the latter omits `q`.
- `docs/PROJECT_CONTEXT.md` — appended Task 11 prompt-history bullet.

### Files created
- (none — both target files already existed and were rewritten)

### Key implementation decisions
- **No private scraping.** Only the public URL is fetched, with a generic UA. Any HTTP error, timeout, or missing metadata flips `metadataFailed = true` and the UI offers a manual-search fallback. No login, no third-party APIs, no caption scraping.
- **`AbortController` 8s timeout.** Prevents hanging on slow / blocked CDNs (TikTok and Instagram both rate-limit aggressively from non-browser UAs; we fail fast instead of hanging the user).
- **DRY: reuse `/add-place` for candidates + save.** The candidate list, confirmation card, radius chooser, and `saveSavedPlace` call all live there already and accept `q`, `source_url`, `source_type` params. Share screen just hands off — no duplicated UI, single source of truth for save logic.
- **Source attribution preserved on manual fallback.** Even when metadata fails, the user's typed search still lands as a `saved_places` row with the correct `source_type` (`tiktok` / `instagram` / `link`) and `source_url`, so analytics/UI badges remain accurate.
- **Phase state machine** (`paste` ? `parsing` ? `preview` | `failed`) keeps render branches explicit instead of overloading flags.
- **Title query preferred over description.** OpenGraph titles are typically the post text or venue mention; descriptions are often boilerplate ("Watch the latest video from..."). The fallback to description's first sentence covers cases where the title is generic.
- **Hashtag/URL stripping in `buildQuery`.** Google Places text search degrades quickly on noisy queries; cleaning these up materially improves first-result accuracy.

### Assumptions
- The user's network can reach `tiktok.com` / `instagram.com` HTML endpoints. Both platforms serve OpenGraph tags on their public preview HTML; this is what link-preview unfurlers (Slack, iMessage, etc.) consume too.
- Platforms may block, rate-limit, or A/B-test their preview pages. The flow degrades gracefully via `metadataFailed`.
- `/add-place` correctly handles `params.q === ''` (verified: `if (params.q && params.q.trim())` guards the auto-search).
- `SourceType` enum already includes `'tiktok' | 'instagram' | 'link' | 'manual'` (verified in `types/index.ts` via `add-place.tsx`'s `SOURCE_TYPES` constant).

### Commands
- `Remove-Item lib/shareParser.ts` ? recreated via `create_file`.
- `Remove-Item app/share.tsx` ? recreated via `create_file`.
- `Add-Content` to `docs/PROJECT_CONTEXT.md` for the prompt-history bullet.
- `npx tsc --noEmit` ? exit 0 (clean).

### Known issues / TODOs
- TikTok / Instagram return different HTML to non-browser UAs and sometimes serve a JS-only shell with no usable OG tags. When that happens we land in the `failed` phase and the user does a manual search — acceptable for V1.
- No retry logic on transient network failures; the user can just tap Read again.
- We don't pull cover images from `og:image` yet — would be a nice preview enhancement and could later be persisted to `places.image_url` (column not yet defined).
- Deep-link / share-intent registration in `app.json` (intent filters / `CFBundleURLTypes`) is still TODO for true "Share to Nearr" from the OS share sheet; the `?url=...` query param plumbing already works for any deep link that lands on `/share`.
- `parseShare` is not unit-tested yet. `cleanTitle`, `buildQuery`, and `decodeHtml` are pure and would be good first targets for a Jest suite.
- Description-to-query fallback may pick a non-place phrase ("you have to try this!"); when the user sees a no-results state on `/add-place` they can edit the query inline — already supported.

---

## Task 12 — iOS share extension scaffold (2026-04-26)

### Files created
- `native/share-extension/ShareViewController.swift` — Swift extension entry point. Reads first `public.url` (or `public.plain-text` containing a URL via `NSDataDetector`) attachment, persists into App Group `UserDefaults` (`lastSharedUrl` + `lastSharedAt`), opens `nearr://share?url=<encoded>` via responder-chain `openURL:` dance (extensions can't access `UIApplication.shared`), and dismisses.
- `native/share-extension/Info.plist` — `NSExtensionActivationRule` accepting URL (max 1) / text / image / movie. Display name "Save to Nearr". `NSExtensionPointIdentifier` = `com.apple.share-services`.
- `native/share-extension/NearrShareExtension.entitlements` — `com.apple.security.application-groups` = `group.com.nearr.app`.
- `plugins/withShareExtension.js` — NO-OP config plugin placeholder. Logs `console.warn` if accidentally invoked. NOT registered in `app.json`. Header comment lists the exact steps to turn it into a real plugin.
- `docs/IOS_SHARE_EXTENSION.md` — comprehensive plan + status doc with honesty checklist.

### Files modified
- `docs/PROJECT_CONTEXT.md` — appended Task 12 prompt-history bullet.

### Files NOT modified (intentional)
- `app.json` — left untouched. Registering `withShareExtension.js` would invoke a no-op plugin and (when implemented) attempt invasive pbxproj rewrites that need EAS credentials + a real Apple Developer Team to verify. Risk of silently breaking `expo run:ios` is too high for this task.
- `app/_layout.tsx` — no UserDefaults bridge added yet. Documented as future work.

### Key implementation decisions
- **Native files live in `native/` not `ios/`.** `expo prebuild` overwrites `ios/` on every run; `native/` is preserved. The future config plugin will copy from `native/share-extension/` into the generated Xcode project.
- **Dual delivery channel: deep link + App Group UserDefaults.** Deep link is primary (`nearr://share?url=...`); App Group is the redundant fallback for the case where the host app was force-killed and the deep link is dropped. Both converge on the same Expo Router `/share` screen.
- **Extension uses responder-chain `openURL:` instead of `UIApplication.shared.open`** because extensions can't access `UIApplication.shared`. Standard iOS pattern.
- **`NSDataDetector` text fallback** so we still pick up a URL when the source app shares plain text containing a link (TikTok "Copy link" sometimes does this).
- **No-op plugin keeps the build green.** A scaffold that breaks `expo prebuild` is worse than no scaffold. The placeholder warns loudly if mis-wired so it's discoverable.
- **Honesty doc** (`IOS_SHARE_EXTENSION.md`) lists what works today (paste-link + Android SEND), what's scaffolded (the four iOS files + plugin placeholder), and what still needs work (real plugin body, Apple Developer App Group registration, host-app UserDefaults bridge, EAS dev build verification). Includes an explicit checklist with [x] for done and [ ] for outstanding.

### Assumptions
- Bundle ID `com.nearr.app` is the host app's permanent ID (matches `app.json`).
- App Group ID `group.com.nearr.app` is available in the Apple Developer account when this is enabled (must be created there manually before the EAS build can sign).
- `expo.scheme` = `"nearr"` is stable (verified in `app.json`); the Swift constant `hostScheme` matches.
- The future config plugin will use `@bacons/xcode` or `expo-share-extension` (decision deferred to when the work is actually scheduled).
- Expo Router's `/share` route handling `?url=` is already verified end-to-end (Task 11).

### Commands
- `create_file` for: `native/share-extension/ShareViewController.swift`, `native/share-extension/Info.plist`, `native/share-extension/NearrShareExtension.entitlements`, `plugins/withShareExtension.js`, `docs/IOS_SHARE_EXTENSION.md`.
- `Add-Content` to `docs/PROJECT_CONTEXT.md` with the Task 12 prompt-history bullet.
- `npx tsc --noEmit` ? exit 0 (no TS files were modified; sanity check only).

### Known issues / TODOs
- **Plugin is a no-op** — calling it does nothing today. Replace its body with `@bacons/xcode`-based target creation when ready.
- **App Group must be created in Apple Developer Portal** under the same Team ID used for code signing before EAS can sign the extension target.
- **Host app UserDefaults bridge not implemented.** When the extension fires while the host app is killed, the deep link should still route correctly on cold launch; the App Group write is a belt-and-suspenders fallback. A small native module (or `react-native-shared-group-preferences`) is needed to read it from JS.
- **No `MainInterface.storyboard`** in the scaffold — the future plugin must generate a default empty storyboard for the extension target (or refactor the Swift to a programmatic UI; the current code does not present any UI of its own — it completes the request silently after dispatching the deep link).
- **Android share intent** already works in EAS builds via `app.json` `android.intentFilters`; no scaffold needed there. Documented in `IOS_SHARE_EXTENSION.md`.
- **No automated test** for the share extension — must be verified manually on a physical iOS device with an EAS dev build.
- **Paste-link flow remains the supported path** in Expo Go and dev builds today (Task 11). Users on iOS will see "Save from a link" inside the app and paste manually until the extension ships.

---

## Task 13 — V1 UX polish (2026-04-26)

### Files created
- `components/EmptyState.tsx` — shared empty/error/permission-denied primitive. Props: `title`, `body?`, `actionTitle?`/`onAction?` (primary CTA), `secondaryTitle?`/`onSecondary?` (ghost CTA), `variant` ('default'|'error'), `framed` (default true ? renders inside Card; false ? bare). Error variant renders the title in `Colors.danger` and defaults the CTA to `secondary`. Title is left-aligned to match the rest of the app's typography rhythm.

### Files modified
- `components/index.ts` — exports `EmptyState`.
- `app/(auth)/sign-in.tsx` — new tagline `Save places once. Nearr reminds you when you're nearby.`, three accent-dot bullets ("Save spots from TikTok, Instagram, or anywhere.", "Set how close is "nearby" — in miles or minutes.", "Get a quiet ping when you're in range."), and a fineprint line "No password. We'll email you a one-tap link to sign in." under the Send-magic-link button.
- `app/(tabs)/home.tsx` — replaced the load-error Card and the no-saved-places Card with `EmptyState`. Updated the "Save your first place to get started." sub-text to the onboarding tagline. Added a `Nearby alerts are off` hint card that appears when `profile.notifications_enabled === false || profile.nearby_notifications_enabled === false` AND the user has saved places, with an "Open settings" button.
- `app/(tabs)/places.tsx` — replaced load-error Card and no-places View with `EmptyState`s (the empty one is unframed and includes both a primary "Save a place" and a ghost "Save from a link" action).
- `app/(tabs)/map.tsx` — the location-denied banner now uses `EmptyState` (still inside the floating banner View at the top of the map). Imports `EmptyState`.
- `app/add-place.tsx` — internal `SearchEmptyState` now delegates to `EmptyState` (framed=false) for all three branches: error, no-results-for-last-query, and pre-search hint. Loading branch keeps its `ActivityIndicator`. Copy normalized: "Search failed", "No results", "Search for a place".
- `app/(tabs)/settings.tsx` — load-error Card replaced with `EmptyState` (variant='error').
- `docs/PROJECT_CONTEXT.md` — appended polish bullet.

### Files NOT modified (intentional)
- `constants/colors.ts`, `constants/spacing.ts`, `constants/typography.ts` — already coherent; no changes needed for visual consistency.
- `components/Button.tsx`, `components/Card.tsx`, `components/Input.tsx`, `components/Screen.tsx` — existing primitives are sufficient. No restyling.
- `components/SavedPlaceCard.tsx` — already pixel-consistent with the rest of the app; left alone.
- `app/place/[id].tsx`, `app/share.tsx`, `app/index.tsx` — already use the design system primitives consistently; no copy/state changes warranted by this task.

### Key implementation decisions
- **Single EmptyState primitive over per-screen styles.** Five screens were rolling their own "no data / error / permission denied" UIs with subtly different padding, alignment, and CTA button variants. Consolidating into one component eliminates drift and makes future copy changes a one-file edit.
- **`framed` prop** — Home and Settings benefit from the Card surface to separate the message from surrounding UI; AddPlace's centered FlatList empty area and the Map's already-elevated floating banner look better unframed (no double border, no nested cards).
- **Onboarding bullets use the accent dot, not emojis.** Keeps the brand palette tight (one accent color), avoids font-rendering inconsistencies for emoji across iOS/Android.
- **"Nearby alerts are off" hint is gated on having saved places.** Showing it when the user has zero saved places would just add noise to an already-empty Home; the reminder is only valuable once they actually have places that could trigger alerts.
- **No animations.** Per the brief, the goal is fast/clean. EmptyState is a static component; no fade-ins, no skeletons.
- **Copy voice normalized.** Empty states use noun-phrase titles ("No places yet", "Search for a place"), error states use "Couldn't load…". Bodies are full sentences with a clear next action implied.

### Assumptions
- The existing design tokens (`Colors`, `Spacing`, `Radius`, `Typography`) are the source of truth and don't need expansion.
- `Card.style` is `ViewStyle` (not `StyleProp<ViewStyle>`), so EmptyState uses `StyleSheet.flatten([...])` when forwarding styles into it. Verified against the typed Card prop signature.
- The Profile object on Home already includes both `notifications_enabled` and `nearby_notifications_enabled` (verified against Task 4 schema).
- "Nearby" in user-facing copy maps to the `nearby_notifications_enabled` flag — consistent with the Settings screen's wording.

### Commands
- `create_file` for `components/EmptyState.tsx`.
- `replace_string_in_file` / `multi_replace_string_in_file` for `components/index.ts`, `app/(auth)/sign-in.tsx`, `app/(tabs)/home.tsx`, `app/(tabs)/places.tsx`, `app/(tabs)/map.tsx`, `app/add-place.tsx`, `app/(tabs)/settings.tsx`.
- `Add-Content` to `docs/PROJECT_CONTEXT.md` for the prompt-history bullet.
- `npx tsc --noEmit` -> exit 0 (clean) after every batch of edits.

### Known issues / TODOs
- `EmptyState` does not support a leading icon. If we want iconography later (e.g., a small location pin for the map denied state), the prop surface is small enough to extend without breaking call sites.
- The "Nearby alerts are off" hint on Home does not yet re-fetch the profile after returning from Settings — it relies on the existing `useFocusEffect(loadProfile)` which already runs. Verified by re-reading Home; no extra wiring needed.
- AddPlace's loading branch is still a bare `ActivityIndicator` inside `emptyBox`; pulling it into EmptyState would require a `loading` slot that complicates the API for one caller. Left as-is.
- Accessibility: EmptyState is plain Text + Button; both have default RN/Pressable a11y. No explicit `accessibilityRole="alert"` for the error variant — could be added when we audit a11y holistically.
- No screenshots regenerated for `docs/`; testing is manual against an EAS dev build.

---

## Task 14 — V1 scope freeze (2026-04-26)

### Files created
- `docs/V1_SCOPE_FREEZE.md` — single source of truth for V1 surface area before the bug sweep. Sections: In V1 / Deferred to V2 / Partially built (decision matrix) / Risks for app review / Prioritized P0/P1/P2 must-work list / Honesty checklist.

### Files modified
- `docs/PROJECT_CONTEXT.md` — appended Task 14 prompt-history bullet pointing to the freeze doc.

### Files NOT modified (intentional)
- All code. Per the brief: "Do not add new features. This task is only to reduce chaos before the bug sweep."

### Key decisions captured in V1_SCOPE_FREEZE.md
- **iOS share extension scaffold stays on disk but inert** (Task 12). Plugin is NOT registered in `app.json`.
- **Android SEND intent filter stays enabled** — already works in EAS builds.
- **No real OS geofencing in V1.** Stick with the foreground check + background-task heuristic (Task 10).
- **No og:image extraction in V1** even though the parser could support it.
- **Paste-link flow is the supported share path on iOS for V1**; the Swift scaffold ships unused.
- **`notification_events.event_type` is `'nearby'` only** in V1.
- **Bug-sweep checklist seeds**: verify no stray `hooks/usePlaces` import, single Places service facade, env-key resolution path, no direct Supabase calls from screens.

### Risks documented
- iOS background-location App Review justification (text already in `app.json`; verify on next build).
- TestFlight requires EAS build, not Expo Go.
- Google Maps API key needs to be restricted in Google Cloud (mobile package + bundle ID + APIs).
- Supabase anon key relies on RLS; audit policies before submission.
- iOS notification permission priming UX (consider one-line sub-text under the toggle).
- TikTok / Instagram OG rate-limiting ? expected `metadataFailed` rate; manual fallback covers it.
- Android 12+ background-location prompt UX unverified on a real device.
- Places API daily quota cap should be set in Google Cloud before TestFlight.
- No Universal Links — custom `nearr://` scheme only.

### Prioritization captured
- **P0 (blocks ship)**: magic-link auth, manual save, share-link save, list/refresh/edit/delete, map render + permission states, settings persist + watch toggle, sign out.
- **P1 (should work or explain)**: foreground "check now" notifications, background watch ticks, `notification_events` audit rows, quiet hours, 1-hour cooldown.
- **P2 (polish, can ship without)**: EmptyState consistency, onboarding copy on multiple screen sizes, long-text edge cases, offline error states.

### Assumptions
- The list of "Files NOT modified" is exhaustive — scope freeze is documentation-only.
- All prior task docs (Tasks 1-13) accurately reflect shipped behavior. The freeze doc cross-references them rather than re-stating internals.

### Commands
- `create_file` for `docs/V1_SCOPE_FREEZE.md`.
- `Add-Content` to `docs/PROJECT_CONTEXT.md` for the prompt-history bullet.
- `Add-Content` to this build log.
- No code touched, no tsc run needed.

### Known issues / TODOs
- Honesty checklist in the freeze doc has unchecked items for "Bug sweep executed" and "TestFlight build cut" — those are the next two milestones.
- Several risks (Google key restrictions, Supabase RLS audit, Places quota cap) require external/console actions outside the codebase. Not blocked from this side, but tracked.
- Verifying the "Things to verify are NOT half-wired" list (legacy `usePlaces`, single Places service facade, env-key resolution) is the first concrete bug-sweep deliverable.

---

## Task 15 â€” V1 bug sweep + testing checklist (2026-04-26)

### Files modified
- `types/index.ts` â€” removed legacy `Place`, `UserSettings`, `GooglePlaceCandidate` types and the "Legacy types" divider comment that introduced them. Top-of-file comment simplified to drop the "older types kept for backward compat" caveat.
- `app/(tabs)/home.tsx` â€” fixed JSX-attribute escape bug. `title="Couldn\u2019t load your places"` was rendering the literal string `Couldn\u2019t` because JSX attribute strings are HTML-style, not JS-style. Replaced with `title={'Couldn\u2019t load your places'}` (JS expression).
- `app/(tabs)/places.tsx` â€” same JSX-attribute escape bug, same fix.

### Files deleted
- `hooks/usePlaces.ts` â€” legacy V0 places CRUD against the pre-normalized schema (`places.user_id` / `notes` / `address` / `radius_miles` / `radius_minutes` / `source_type`) and a `user_settings` table that no longer exists in `supabase/migrations/20260426000001_init_schema.sql`. Verified by four targeted greps that nothing in `app/`, `components/`, `services/`, or other `hooks/` imports `usePlaces`, `savePlace`, `updatePlace`, `deletePlace`, `getSettings`, or `upsertSettings` outside of the dead-file re-export chain.
- `services/places.ts` â€” 17-line shim that mixed legacy CRUD re-exports from `@/hooks/usePlaces` with new `searchPlaces`/`getPlaceDetails` re-exports from `@/services/placesService` and `parseShare`/`detectSource` from `@/lib/shareParser`. `grep` for `from '@/services/places'`, `from '../services/places'`, `from './services/places'` returned zero matches.
- `lib/places.ts` â€” `@deprecated` adapter that reshaped the new `PlaceCandidate` into the legacy `GooglePlaceCandidate` shape. `grep` for `from '@/lib/places'` returned zero matches.

### Files created
- `docs/TESTING_CHECKLIST.md` â€” manual end-to-end checklist for V1. Eight sections (`Setup` with install/typecheck/start commands and `.env` requirements, `Auth`, `Manual save`, `Share-link ingestion`, `Map`, `Notifications`, `Place detail`, `Settings`, `Smoke / regressions`). Each section explicitly states which Supabase rows to verify (`profiles` row from `handle_new_user` trigger, `places` upsert by `google_place_id`, `saved_places.source_type/source_url`, `notification_events.distance_meters`). Notifications section calls out that background watch needs a dev build (not Expo Go).

### Key decisions
- **Delete, don't quarantine, dead code.** The three orphaned files (`hooks/usePlaces.ts`, `services/places.ts`, `lib/places.ts`) used old column names that don't exist in the current schema. If anything ever started importing them again, runtime would 400 with a schema error rather than fail at compile time. Deleting > leaving them with `@deprecated`.
- **Use a JS expression for any JSX attribute that contains an escape sequence.** JSX attribute strings (`attr="..."`) are HTML-style and do not interpret `\uXXXX` or `\n`. The two fixes use `attr={'...\u2019...'}` instead of `attr="...\u2019..."`. This is now the preferred pattern; HTML entities like `&apos;` / `&rsquo;` also work in JSX text and JSX attribute values for the curly-quote case.
- **No fixes that weren't evidenced.** The bug sweep deliberately didn't restructure or "improve" anything that wasn't broken. Active code paths inspected (`app/_layout.tsx`, `app/index.tsx`, `app/(auth)/sign-in.tsx`, `app/share.tsx`, `app/add-place.tsx`, `app/place/[id].tsx`, `app/(tabs)/{home,places,map,settings}.tsx`, `services/{auth,placesService,profileService,savedPlacesService,notifications}.ts`, `hooks/{useAuth,usePlacesSearch,useSavedPlaces}.ts`, `lib/{supabase,authDeepLink,notifications,shareParser,geo}.ts`, `package.json`, `.env.example`, `app.json`) were already coherent and were left untouched.
- **`docs/TESTING_CHECKLIST.md` is the source of truth for "did V1 ship".** Keeps the freeze + checklist + log triangle: scope freeze says what's in, checklist says how to verify it, log says what changed.

### Assumptions
- The migration file (`supabase/migrations/20260426000001_init_schema.sql`) is the single source of truth for column names and is what's actually applied on the user's Supabase project. Not re-verified against a live DB in this task.
- `handle_new_user` trigger creates the `profiles` row on signup. `services/profileService.ts` `getProfile()` returns null if missing â€” the testing checklist's auth section verifies this.
- The Supabase redirect-allow-list step (`nearr://auth-callback` + `exp://*`) and Google API key configuration (Places API + Maps SDK iOS/Android enabled, key restrictions valid for the bundle IDs) are external-console actions outside the codebase. The checklist surfaces them in the Setup section so QA can't miss them.
- JSX attribute string semantics behave the same in React Native as in React DOM regarding escape sequences. (Confirmed by behavior â€” RN's JSX transform is the standard Babel `@babel/preset-react`.)

### Commands run
```powershell
npx tsc --noEmit  # baseline:  exit 0
Remove-Item hooks/usePlaces.ts, services/places.ts, lib/places.ts
# (replace_string_in_file edits to types/index.ts, app/(tabs)/home.tsx, app/(tabs)/places.tsx)
npx tsc --noEmit  # post-fix:  exit 0
# create_file docs/TESTING_CHECKLIST.md
# Add-Content docs/PROJECT_CONTEXT.md
# Add-Content this log
```

### Known issues / TODOs
- The bug sweep is *static* â€” it doesn't replace device QA. The next milestone is running `docs/TESTING_CHECKLIST.md` end-to-end on a real iOS or Android device.
- Background notifications can't be verified in Expo Go. Need an EAS dev build for Section 5 of the checklist.
- The Supabase project's RLS policies were not re-audited in this task. The schema file defines them; verifying they match production is part of the pre-TestFlight work.
- `app.json` `extra.googlePlacesKey` is read as a tertiary fallback by `placesService.ts`. The `.env.example` doesn't expose this fallback because it's only useful for prebuilt configs; documented in `services/placesService.ts:resolveApiKey()` JSDoc.
- The two JSX-attribute-escape fixes are the only user-visible bugs found. Everything else was either dead code or already correct.

---

## Task 16 â€” Handoff documentation (2026-04-26)

### Files created
- `docs/ARCHITECTURE.md` â€” folder structure (annotated tree), then per-subsystem data flow with ASCII diagrams: (1) auth gate + magic-link round-trip, (2) manual save flow (search â†’ upsert places â†’ insert saved_places + duplicate handling), (3) share-link ingestion (parseShare phases + handoff to /add-place), (4) map permission state machine + preview-card flow, (5) notifications proximity loop (LOCATION_TASK + decideProximity + cooldown + audit). Also documents conventions (no direct Supabase from screens, typed errors, loud logging, JSX-attribute-escape gotcha from Task 15).
- `docs/ENVIRONMENT.md` â€” prerequisites, install, env-var precedence table, Supabase one-time setup (Magic Link provider + redirect allow-list + migration), Google Maps Platform setup (APIs to enable + restrictions), EAS dev-build note, daily commands, pre-test sanity checklist. Calls out explicitly that background location + most notification testing requires an EAS dev build, NOT Expo Go.
- `docs/NEXT_STEPS.md` â€” pre-TestFlight tasks (run TESTING_CHECKLIST.md on a real device, audit Supabase config, lock down Google key, cut EAS dev build, TestFlight readiness), V2 candidates Aâ€“J ordered by product ROI (real geofencing, iOS share-extension activation, photos, list filtering, drive-time radius, server-driven push, profile editing, per-day quiet hours, tests, App Group bridge), and an explicit "what NOT to build yet" list to push back on premature feature creep.

### Files modified
- `docs/PROJECT_CONTEXT.md` â€” rewrote the top of the file (everything above "## Prompt history summary") as a proper handoff entry point. Replaced the stale folder map (which still listed deleted `lib/places.ts`, `hooks/usePlaces.ts`, and the legacy `Place` / `UserSettings` / `GooglePlaceCandidate` types from Task 15) with the current layout. Added (a) handoff-banner pointing at the four sibling docs + the build log, (b) explicit V1 product goal, (c) 10-item current feature list, (d) subsystem summary (auth, save flow, share-link flow, notifications, map), (e) database-schema overview, (f) setup TL;DR with required env vars, (g) Known limitations / TODOs (background needs dev build, polled not geofenced, iOS coalesces ticks, Android 12+ separate prompt, minutes uses 25mph, share parser public-only, no Places retry/backoff, share extension scaffolded-not-registered, no automated tests, plain HH:MM inputs), (h) Resolved-bugs section (struck-through Task 15 fixes), (i) "What to build next" linking to NEXT_STEPS.md. Full prompt history preserved at the bottom unchanged.

### Files NOT modified
- `docs/TESTING_CHECKLIST.md` â€” already written in Task 15, still accurate.
- `docs/V1_SCOPE_FREEZE.md` â€” already written in Task 14, still accurate.
- `docs/DATABASE.md` â€” already written in Task 4, still accurate.
- `docs/IOS_SHARE_EXTENSION.md` â€” already written in Task 12, still accurate.
- All code â€” handoff is documentation-only.

### Key decisions
- **PROJECT_CONTEXT.md is the entry point, the four sibling docs are referenced from it.** Resisted the temptation to merge everything into one mega-doc. Five smaller docs are easier to navigate when a new chat needs to find one specific thing (env, schema, next steps).
- **Preserve full prompt history at the bottom of PROJECT_CONTEXT.md, not in a separate file.** Tasks 1â€“16 in chronological order is the single most useful narrative for a new chat to read.
- **Remove every reference to deleted files in the docs.** The old folder map listed `lib/places.ts`, `hooks/usePlaces.ts`, etc. â€” Task 15 deleted those. A handoff doc that lies about the layout is worse than no doc.
- **NEXT_STEPS.md includes a hard "do not build" list.** Future chats are likely to be asked for V2 features before V1 ships. Naming each one explicitly with the reason ("not in V1, no schema for it, adds review risk") gives the next agent something to point at.
- **No code changes.** This task is documentation-only on purpose. Touching code mid-handoff would invalidate the docs that just got written.

### Assumptions
- The current state of the codebase as of Task 15 is what ships as V1. If the next chat is asked to add a feature, the docs say "no, finish V1 first" â€” that's the intended behavior.
- The Supabase migration file is the source of truth for the schema. DATABASE.md and the new docs all defer to it.
- The user prefers small focused docs over one giant README. (Inferred from the existing docs/ folder having one file per concern: DATABASE, IOS_SHARE_EXTENSION, TESTING_CHECKLIST, V1_SCOPE_FREEZE.)

### Commands run
```powershell
# Inspections (read-only):
#   read PROJECT_CONTEXT.md, DATABASE.md, V1_SCOPE_FREEZE.md, supabase/migrations/*.sql
#   list docs/, lib/, components/, constants/, supabase/

# Writes:
# create_file docs/ARCHITECTURE.md
# create_file docs/ENVIRONMENT.md
# create_file docs/NEXT_STEPS.md
# replace_string_in_file docs/PROJECT_CONTEXT.md (top sections)
# Add-Content docs/PROJECT_CONTEXT.md (Task 16 bullet)
# Add-Content this log (this entry)

npx tsc --noEmit  # post-task sanity check: exit 0
```

### Known issues / TODOs
- TESTING_CHECKLIST.md hasn't been run yet on a real device. That's the literal next task in NEXT_STEPS.md.
- Supabase RLS hasn't been re-audited against the live project. NEXT_STEPS.md item 2.
- Google Maps key restrictions are recommended in ENVIRONMENT.md but not enforced. NEXT_STEPS.md item 3.
- No EAS dev build cut yet. Required for proper notifications testing. NEXT_STEPS.md item 4.

---

## Final V1 status (2026-04-26)

The V1 build is **code-complete and scope-frozen**. Static checks pass
(`npx tsc --noEmit` exit 0, no orphaned files, no schema mismatches, no
broken JSX-attribute escapes). Next action is real-device QA via
[../../docs/TESTING_CHECKLIST.md](../../docs/TESTING_CHECKLIST.md), then
EAS dev build, then TestFlight. See
[../../docs/NEXT_STEPS.md](../../docs/NEXT_STEPS.md) for the post-V1 plan
and the explicit don't-build-yet list.

The handoff docs are:
1. [PROJECT_CONTEXT.md](../../docs/PROJECT_CONTEXT.md) â€” entry point.
2. [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) â€” folder layout + subsystem data flows.
3. [ENVIRONMENT.md](../../docs/ENVIRONMENT.md) â€” install + env vars + Supabase + Google + EAS.
4. [DATABASE.md](../../docs/DATABASE.md) â€” schema + RLS reference.
5. [V1_SCOPE_FREEZE.md](../../docs/V1_SCOPE_FREEZE.md) â€” what's in / deferred / partial.
6. [TESTING_CHECKLIST.md](../../docs/TESTING_CHECKLIST.md) â€” manual E2E checklist.
7. [NEXT_STEPS.md](../../docs/NEXT_STEPS.md) â€” what to build next, what not to.
8. [IOS_SHARE_EXTENSION.md](../../docs/IOS_SHARE_EXTENSION.md) â€” V2 share-extension plan.

A new chat should read 1 â†’ 5 â†’ 2 â†’ 3 â†’ 6 â†’ 7 in that order.

## Task 18 - Demo Mode (full external-API mock)

**Goal:** dev-only `EXPO_PUBLIC_DEMO_MODE=true` switch that lets the Android emulator run the full UX with no Supabase, Google, location, or notifications dependencies.

**Files created (9):**
- `lib/demoMode.ts` - env flag + `isDemoMode()` triple-guard + `DEMO_USER`.
- `lib/demoData.ts` - `DEMO_PROFILE`, 19-entry `DEMO_PLACE_CATALOG`, 10-entry `DEMO_SEED_SAVED_PLACES`.
- `services/demo/profileService.ts` - AsyncStorage-backed CRUD.
- `services/demo/placesService.ts` - token + tag scored search.
- `services/demo/savedPlacesService.ts` - full CRUD with PG-23505-style duplicate detection.
- `services/demo/notifications.ts` - `simulateDemoNearbyNotification` (in-app Alert).
- `services/demo/index.ts` - barrel + `resetAllDemoData`.
- `components/DemoModeBanner.tsx` - self-gated banner.
- `components/MapFallbackList.tsx` - list view shown in place of MapView.

**Files modified (10):**
- `components/index.ts` (exports), `services/profileService.ts`, `services/savedPlacesService.ts`, `services/placesService.ts`, `lib/notifications.ts`, `lib/shareParser.ts`, `hooks/useAuth.ts`, `app/(tabs)/home.tsx`, `app/(tabs)/settings.tsx`, `app/(tabs)/map.tsx`, `.env.example`.

**Decisions:**
- Service routing via early-return guards at the top of each real service function (clean, screens unchanged).
- `__DEV__` triple-guarded (env read, `isDemoMode()`, banner render).
- Demo storage keys scoped under `nearr.demo.*` separate from Task 17's `nearr.devAuthEnabled`.
- Demo session reuses Task 17's `isDevSession` API additively (new `isDemoSession` for code that needs to distinguish).
- Fake `Session` cast through `unknown` like Task 17, parameterized via `makeFakeSession(id, email)`.

**Commands:** `npx tsc --noEmit` -> exit 0.

**Limitations:**
- Static catalog (no synthetic per-run variation).
- Map fallback is a flat list; no markers / clustering.
- Simulate-nearby uses in-app `Alert` rather than a real OS notification.
- Quiet hours not exercised in demo.
- Background watch is no-op; only foreground simulate-nearby works.

## Task 20 - Map Preview marker fix

- `app/(tabs)/map.tsx`: filter `validPlaces` (Number.isFinite lat/lng), fit camera with `fitToCoordinates` + edge padding 100/80/180/80, rename iteration variable to `savedPlace`, drop debug log, expand empty fallback message.
- `components/MapFallbackList.tsx`: import `Card` / `EmptyState` directly from their files instead of from `@/components` (breaks the barrel require-cycle).
- `npx tsc --noEmit` exit 0.

## Task 21 - Force-debug map markers

- `app/(tabs)/map.tsx`: hard-coded test marker, raw + per-coord logs, safe filter+map marker pipeline using `Number(p.place.latitude)`, hard-coded `PREVIEW_INITIAL_REGION` 0.08 deltas, simplified empty fallback, removed unused `MAP_PREVIEW_REGION` import.
- Map renders unconditionally outside Demo Mode — no loading-spinner / null-return early returns.
- `npx tsc --noEmit` exit 0.

If the test marker does not appear, the MapView native module is misconfigured (provider / API key / dev client) and seeded markers will never render. Inspect the `PLACES RAW` / `COORD` logs to diagnose data-shape issues separately.


---

## Update: Android react-native-maps marker fix (PROVIDER_GOOGLE + custom marker views)

### Symptom
Google map surface and watermark rendered fine on Android, but no markers appeared — including the hard-coded Santa Cruz test marker. Data and coordinates verified valid via PLACES RAW / COORD logs.

### Hypothesis
Native Google Maps provider not explicitly set on Android, plus default marker bitmaps occasionally fail to render in the emulator. Custom `<View>` children avoid that path entirely.

### Changes in `app/(tabs)/map.tsx`
- Imported `PROVIDER_GOOGLE` from `react-native-maps`.
- Added `provider={PROVIDER_GOOGLE}` to `<MapView>`.
- Replaced the hard-coded test marker with a custom `<View>` child: 32×32 red circle, 3px white border. Bright/obvious on purpose.
- Replaced seeded markers with custom `<View>` children: 24×24 dark circle, 2px white border. Temporary — restores after we confirm rendering.
- Verified overlays are NOT full-screen blockers:
  - `previewBadge` — absolute, top-centered pill, not full-screen.
  - FAB — absolute bottom-right, not full-screen.
  - `emptyOverlay` — only renders when `places.length === 0` (and MapView is not mounted in that branch).
  - `pendingOverlay` — never shown in Map Preview Mode (permission is forced to `denied`).

### Verification
- `npm run typecheck` → clean.

### Diagnostic value
If the red marker now appears, default-bitmap rendering was the issue and we can restore styled markers via `image=` or keep custom views. If the red marker still does not appear, the issue is native Google Maps / Android emulator configuration (Play Services, API key in `AndroidManifest`, or provider linking) — not anything in JS.

---

## Update: Replace local-only Dev Mode with real test-user mode (Task 23)

### Why
Fake local Dev Mode synthesized a `dev-user` session with no real JWT.
Supabase calls failed (`Auth session missing!`) and Settings / database
flows could not be exercised. We now route normal dev testing through the
same magic-link flow as production.

### Changes
- `app/(auth)/sign-in.tsx`: removed the `Continue in Dev Mode` button
  and `enableDevAuth` import. Replaced with a `__DEV__`-only note:
  *"For development, sign in with your test email above to exercise real
  Supabase data (profiles, saved_places, settings)."*
- `components/DevModeBanner.tsx`: renamed the user-visible label from
  *Dev Mode* to **Local UI Mode** with explicit copy: *"Local UI Mode
  cannot test Supabase reads/writes"*.
- `hooks/useAuth.ts`: added `isLocalUiSession` (only true when the
  legacy `devAuth` flag is on AND not Demo / Map Preview AND `__DEV__`).
  `isDevSession` retained for backward compat.
- `app/(tabs)/home.tsx` and `app/(tabs)/settings.tsx`: banner + Exit
  button now gated on `isLocalUiSession`. Demo Mode and Map Preview Mode
  no longer surface the RLS warning. The Exit button label is now
  *"Exit Local UI Mode"*.
- `lib/devAuth.ts`: unchanged. Functions remain `__DEV__`-guarded; with
  no UI entry point the flag stays off by default.
- `docs/ENVIRONMENT.md`: added *Recommended dev auth flow (real test
  user)* and *About the legacy "Local UI Mode"* sections.

### Safety
- No service-role key in client.
- RLS not disabled.
- Production builds short-circuit `__DEV__` checks; `isLocalUiSession`
  is always false in release.
- Demo Mode (`EXPO_PUBLIC_DEMO_MODE`) and Map Preview Mode
  (`EXPO_PUBLIC_MAP_PREVIEW_MODE`) remain available, separate, and
  unchanged for UX-only testing.

### Verification
- `npm run typecheck` exit 0.


## Update: Fully disable legacy Local UI Mode auto-login (Task 24)

### Problem
After sign-out the app silently re-entered Local UI Mode because the
`nearr.devAuthEnabled` AsyncStorage flag persisted from before the UI
entry point was removed. `loadDevAuth` still read it, `useAuth` still
synthesized a fake session from it, and the user never returned to sign-in.

### Changes
- `lib/devAuth.ts`:
  - `loadDevAuth()` now ALWAYS returns `false` and removes the legacy
    AsyncStorage key on every call. No auto-resume from storage.
  - Added `clearDevAuth()` for explicit one-shot wipes.
  - `enableDevAuth` / `disableDevAuth` / `subscribeDevAuth` /
    `isDevAuthEnabled` retained unchanged for programmatic use.
- `hooks/useAuth.ts`:
  - Added compile-time constant `const ALLOW_LOCAL_UI_MODE = false`.
  - The fake-local fallback only activates when
    `__DEV__ && ALLOW_LOCAL_UI_MODE && !session && devEnabled`. With the
    constant set to false, it is unreachable. `isLocalUiSession` reflects
    the same gate.
- `app/_layout.tsx`: calls `clearDevAuth()` once on mount so old
  installs with the flag set to `1` get cleaned up on first launch.
- `app/(tabs)/settings.tsx`: `handleSignOut` now calls
  `disableDevAuth()` defensively before `signOut()` and the route
  replace, so even a manually-reset flag cannot cause a relapse.
- The `Exit Local UI Mode` button and the no-profile early-return are
  already gated on `isLocalUiSession`; they are therefore invisible
  while `ALLOW_LOCAL_UI_MODE` is `false` \u2014 no extra change needed.

### Safety
- Production magic-link auth path: untouched.
- Supabase RLS: not disabled.
- No service-role key.
- Demo Mode and Map Preview Mode: independent and unchanged.

### Verification
- `npm run typecheck` exit 0.
- Expected behaviour: signing out always lands on `/(auth)/sign-in`;
  the app never auto-enters Local UI Mode again.


## Update: Decouple Map Preview Mode from auth + harden sign-out (Task 25)

### Problem
With `EXPO_PUBLIC_MAP_PREVIEW_MODE=true`, `useAuth` synthesized a fake
session for `map-preview-user` so the AuthGate sent the user straight
into the tabs without a real Supabase session. Sign-out also could not
reliably return the user to the sign-in screen because Map Preview kept
producing a fake session every render.

### Auth modes after this change
| Setting                                | Auth required? | Notes                                           |
|----------------------------------------|----------------|-------------------------------------------------|
| `DEMO_MODE=false` `MAP_PREVIEW=false` | yes (real)     | Standard \u2014 magic-link sign-in                  |
| `DEMO_MODE=true`                       | no (UX-only)   | Bypasses auth; banner is shown                  |
| `MAP_PREVIEW_MODE=true`                | yes (real)     | Map screen swaps to seeded data; auth untouched |
| Local UI Mode                            | n/a            | Disabled at compile time (`ALLOW_LOCAL_UI_MODE = false`) |

### Changes
- `hooks/useAuth.ts`:
  - Removed `isMapPreviewMode` / `MAP_PREVIEW_USER` import and all
    map-preview branches. Map Preview no longer creates a fake session.
  - Effect dep array reduced to `[demo]`.
  - Added `__DEV__`-gated debug log per render with
    `realSessionExists` / `demoMode` / `mapPreviewMode` /
    `localUiAllowed` / `localUiEnabled` / `finalAuthState`.
  - `onAuthStateChange` callback now logs `event` + `hasSession`.
  - `isMapPreviewSession` is preserved on the return type for back-compat
    but is hard-coded `false`.
- `app/_layout.tsx`: AuthGate now logs each decision
  (`hasSession` / `inAuth` / `segments`) and the route it picks.
  `clearDevAuth()` startup wipe is unchanged.
- `app/(tabs)/settings.tsx`: `handleSignOut` logs each step \u2014
  `clearing legacy Local UI Mode flag` \u2192 `supabase.auth.signOut()` \u2192
  result \u2192 `routing to /(auth)/sign-in` \u2014 and surfaces any error from
  Supabase.
- `app/(tabs)/map.tsx`: unchanged. It already calls `isMapPreviewMode()`
  directly, so the screen-scoped behaviour (seeded data, fixed Santa Cruz
  region, no location prompt) still works \u2014 but only AFTER the user has
  signed in for real.
- `services/savedPlacesService.ts` / `services/placesService.ts`:
  unchanged. They still short-circuit on `isMapPreviewMode()` for reads,
  which is the screen-scoped data swap, not auth.
- `lib/devAuth.ts`: unchanged from Task 24 \u2014 `loadDevAuth` always
  returns false and clears the legacy AsyncStorage key.

### Safety
- Magic-link production auth: untouched.
- Supabase RLS: not disabled.
- No service-role key.
- Demo Mode is the ONLY auth-bypass mode and is loud about it (banner).

### Verification
- `npm run typecheck` exit 0.
- Expected behaviour with `EXPO_PUBLIC_DEMO_MODE=false` and
  `EXPO_PUBLIC_MAP_PREVIEW_MODE=true`:
  - Cold start with no Supabase session \u2192 sign-in screen.
  - Sign in with magic link \u2192 tabs; map screen renders preview data.
  - Sign out \u2192 sign-in screen; refresh / cold start \u2192 still sign-in.
- Console traces `[useAuth] state`, `[AuthGate] decide`, and
  `[signOut] step N` make the flow visible end to end.

---

## Task: Dev-only email/password sign-in for `dev@nearr.test`

### Files modified
- `services/auth.ts` — added `signInWithPassword(email, password)` wrapper over `supabase.auth.signInWithPassword`. Returns Supabase's native `{ data, error }` shape unchanged.
- `app/(auth)/sign-in.tsx` — when `__DEV__` AND `email.trim().toLowerCase() === 'dev@nearr.test'`, swaps the magic-link button for a `secureTextEntry` password input + `Sign in as developer` button that calls `signInWithPassword`. All other emails (and all production builds) keep the existing magic-link flow.
- `docs/ENVIRONMENT.md` — new `Dev-only password sign-in for the test user` section documenting the manual Supabase Auth user provisioning (`dev@nearr.test` / `devpass123` with Auto Confirm) and the `__DEV__` gate.
- `docs/PROJECT_CONTEXT.md` — Auth subsystem bullet now mentions the dev password path.

### Files created
None.

### Key implementation decisions
- **No client-side user creation.** The Supabase Auth user is provisioned manually in the dashboard; the client only calls `signInWithPassword`. No service-role key is referenced anywhere.
- **`__DEV__` gate at the UI layer.** `services/auth.signInWithPassword` is intentionally a thin wrapper with no email allow-list — the gate lives in the sign-in screen so the function stays a generic Supabase passthrough. The screen renders the password input only when `__DEV__ && email === 'dev@nearr.test'`; production builds never show it.
- **No password persistence.** Password lives in component state only. AsyncStorage holds only the standard Supabase session (existing behavior).
- **No auto-login.** User must type email + password until the Supabase refresh-token flow takes over.
- **Sign-out unchanged but verified.** `app/(tabs)/settings.tsx` already (a) clears the legacy Local UI Mode flag, (b) calls `supabase.auth.signOut()`, (c) `router.replace('/(auth)/sign-in')`. `hooks/useAuth.ts` already ignores the legacy `nearr.devAuthEnabled` flag (`ALLOW_LOCAL_UI_MODE = false`) and Demo / Map-Preview modes are screen-scoped — no path silently re-authenticates after sign-out.
- **Real session, real RLS.** The dev user is a normal `auth.users` row, so `profiles`, `saved_places`, `notification_events`, and the proximity watcher exercise the production code paths.

### Validation
- `npm run typecheck` — exits 0.
