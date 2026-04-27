# Nearr

Save the spots you want to visit. Get pinged when you're nearby.

## Quick start

1. `npm install`
2. Create a Supabase project, then run `supabase/schema.sql` in the SQL editor.
3. In Supabase Auth settings, enable email magic links and add `nearr://auth-callback` as a redirect URL.
4. Get a Google Maps Platform key with Places API + Maps SDK enabled.
5. Copy `.env.example` to `.env` and fill values, then put the same values into `app.json` `extra` and `config` fields (or replace `$VARS` with literals for now).
6. `npm run start` and open in Expo Go (note: background location + native maps require a dev build).

## Stack

- Expo + Expo Router
- Supabase (auth + Postgres with RLS)
- Google Places + react-native-maps
- expo-location + expo-notifications + expo-task-manager

See `docs/PROJECT_CONTEXT.md` for the full picture.
