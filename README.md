# Nearr

Nearr helps people save places they discover online, see them on a personal map, and optionally get reminded when they are nearby.

## Current beta reality

- Auth is Supabase magic-link based.
- `/auth-callback` is a real route in the app.
- `dev@nearr.test` password login exists for the dedicated test account in all builds.
- Save flows route to Map focused on the saved place using `savedPlaceId`.
- Notifications, background proximity checks, and geofencing exist in code.
- iOS share extension is enabled in config but still needs real-device verification for the silent-save path.
- Legal acceptance scaffolding exists, but acceptance is disabled for beta.

## Quick setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create `.env` from `.env.example`.

3. Set at least:

   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

4. Configure Supabase Auth redirect URLs to include:

   - `nearr://auth-callback`
   - `nearr:///auth-callback`
   - `exp://*/--/auth-callback`

5. Apply migrations:

   ```sh
   supabase db push
   ```

6. Start the app:

   ```sh
   npm run start
   ```

## Native / build commands

- Android local run: `npm run android`
- iOS local run: `npm run ios`
- Type check: `npm run typecheck`
- Share-eval script: `npm run eval:share-extraction`

For real background location, Android share intent, iOS share extension, and geofencing, use a native build rather than Expo Go.

## Important env / infra notes

- Native Google Maps keys are injected through [app.config.js](app.config.js), not hardcoded in [app.json](app.json).
- Supabase custom SMTP / Resend configuration is external to this repo.
- `process-share-link` code exists in the repo, but deployment is environment-specific.
- iOS share extension silent save depends on App Group setup, native build provisioning, deployed Edge Function, and the shared auth token bridge.

## Where docs live

- [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md): current product and feature reality
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): auth/save/map/notification/share flows
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md): env vars, Supabase, EAS, native requirements
- [docs/DATABASE.md](docs/DATABASE.md): migration-backed schema
- [docs/TESTING_CHECKLIST.md](docs/TESTING_CHECKLIST.md): current beta test pass list
- [docs/IOS_SHARE_EXTENSION.md](docs/IOS_SHARE_EXTENSION.md): current iOS share-extension status and setup
- [docs/V1_SCOPE_FREEZE.md](docs/V1_SCOPE_FREEZE.md): what is shipping vs partial vs disabled vs deferred
- [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md): current validation and release priorities
- [docs/ANALYTICS_QUERIES.md](docs/ANALYTICS_QUERIES.md): current SQL queries for product metrics

## Beta caveats

- Treat the iOS share extension as partial until it is re-verified on a fresh native build.
- Background reminders and geofencing need a real device.
- Transcription is not a shipping feature yet.
