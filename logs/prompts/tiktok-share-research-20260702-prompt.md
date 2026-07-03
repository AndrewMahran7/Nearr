# TikTok Share Research & Fix — Prompt

> Logged 2026-07-02. Task: research and fix TikTok sharing into Nearr
> (staged, safe, no auto-save loosening, manual fallback acceptable).

## Goal

Research and fix TikTok sharing into Nearr. When a user shares a TikTok
video link into Nearr, the app should: receive the URL correctly;
normalize TikTok short/full URLs; fetch whatever public metadata is
safely available; extract caption/title/address evidence; return
auto_save / candidate_confirmation / multi_candidate_confirmation /
manual_fallback safely; and if TikTok metadata is insufficient, open
manual search instead of crashing or showing a dead-end alert.

## Constraints (summary)

- No fragile-scraping-only required path; no auto-save loosening; no
  silent save from weak TikTok metadata; do not break Instagram / Android
  intent / iOS share extension; no TikTok provider integration unless
  absolutely necessary; no transcription; no broad extraction rewrites;
  staged + testable; manual fallback acceptable when metadata is
  unavailable; expected failure → manual search, not root crash; never
  log secrets/tokens/headers/cookies/full HTML.

## Phases

1. Diagnose current failure + add `[tiktok-share]` logs.
2. URL normalization (accept www/m/vm/vt hosts, strip tracking, follow
   redirects server-side, preserve canonical, time out, never crash) +
   tests.
3. Metadata fetch: OG → TikTok oEmbed → page title/desc → manual fallback
   (official/safe only).
4. Evidence + decision through the same deterministic resolver as
   Instagram (no TikTok-specific safety shortcut).
5. Tests A–I + validation commands + remote tests + deploy.

See logs/prompts/tiktok-share-research-20260702-output.md for the report.
