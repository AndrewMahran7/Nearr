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

## Transcription fallback

Nearr saves places from social links. Sometimes the caption doesn't include
the venue name but the video's audio does — e.g. "we're at Tacos Los Chulos".
We want a future-ready hook to transcribe that audio and feed the spoken
name into the AI extractor (so the Places query becomes
`Tacos Los Chulos Los Angeles`).

**Status: placeholder only.** No transcription provider is integrated yet.

- The abstraction lives in [lib/transcription/index.ts](lib/transcription/index.ts) with types in [lib/transcription/types.ts](lib/transcription/types.ts).
- The only implementation today is [lib/transcription/providers/placeholder.ts](lib/transcription/providers/placeholder.ts), which returns `{ status: "unavailable" }` when no provider env var is set and never throws.
- The eval harness ([scripts/evalShareExtraction.ts](scripts/evalShareExtraction.ts)) uses it: fixtures may include a `transcript` field directly, otherwise the placeholder is called and the eval logs the result without failing.
- The AI extractor ([lib/aiExtractPlace.ts](lib/aiExtractPlace.ts)) accepts an optional `transcript` and prioritizes spoken phrases like "we're at ___", "welcome to ___", "today we're trying ___".

**Production path.** The React Native client must NOT call a transcription
provider directly — that would either ship a secret API key in the Expo
bundle or require an undocumented scraping endpoint. Instead, the share
screen ([app/share.tsx](app/share.tsx)) should call a Supabase Edge Function
that wraps `transcribeSocialVideo(...)` server-side. That Edge Function is
the only place `TRANSCRIPTION_PROVIDER` / `TRANSCRIPTION_API_KEY` should
be read.

**Why no Choppity / GetTheScript integration?** As of writing there is no
documented public API or API key available for either service. We
deliberately do NOT hardcode an undocumented endpoint or scrape their UI.
When a documented API + key materialize, drop a new file under
`lib/transcription/providers/` and route to it from
`lib/transcription/index.ts` based on `TRANSCRIPTION_PROVIDER`.

Realistic future providers:

- A documented Choppity / GetTheScript REST API (if/when one exists).
- Server-side `yt-dlp`-style download + OpenAI Whisper.
- Deepgram / AssemblyAI / OpenAI Whisper fed an audio URL extracted server-side.
