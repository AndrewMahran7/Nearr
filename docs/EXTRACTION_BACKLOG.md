# Nearr Extraction Backlog

## Purpose

This document tracks known issues, future work, and cleanup plans for Nearr's social-link extraction system.

It exists to keep extraction work organized, reduce one-off bug chasing, and avoid overfitting fixes to isolated examples instead of improving the system as a whole.

## Current Product Principle

- Correct candidate confirmation is better than manual fallback.
- Clean manual fallback is better than a wrong candidate.
- Wrong auto-save is the worst outcome.
- The model can propose a place, but deterministic code decides save/candidate/manual fallback.

## Known Problems

### A. Cross-platform bio extraction

We need a consistent way to pull bios and profile metadata from:

- Instagram
- TikTok
- Twitter/X
- YouTube

Notes:

- This will most likely start with third-party APIs.
- Later, we may build parts in-house if cost or reliability requires it.
- Do not rely on live Instagram scraping in the user save flow because it often hits rate limits.
- Profile bio data should be evidence, not automatic truth.
- Profile evidence is strong only when it includes business or restaurant classification plus extracted name and address or city.

### B. Cross-platform transcript extraction

We need a consistent way to pull transcripts and audio-derived text from:

- Instagram
- TikTok
- Twitter/X video
- YouTube

Notes:

- This will most likely start with third-party APIs.
- Later, we may build in-house with downloaded audio and Whisper or another speech-to-text system.
- Transcripts matter when the caption is generic but the video or audio says the place name.
- Transcript evidence should be stored with source, confidence, and timestamp if possible.

### C. Model/provider comparison

Research OpenAI, xAI, Anthropic, and Gemini models for Nearr extraction.

Hypothesis:

Model speed is correlated with the amount and cleanliness of data fed into the model. The model seems slowest when it receives noisy social-wrapper data or ambiguous evidence.

Testing should compare:

- speed
- structured JSON reliability
- extraction accuracy
- reasoning quality
- cost
- timeout rate
- ability to reject weak evidence
- candidate ranking quality

Important:

- Use Nearr's own real link batches, not generic benchmarks.

### D. Background processing for slow extractions

If extraction takes too long, run it in the background.

Notes:

- Low priority for now.
- Do not remove tool-level timeouts.
- Eventually: user submits link, backend processes job, user gets notification or in-app update when saved, needs confirmation, or requires manual fallback.
- This is more of a UX and product-flow fix than an extraction-quality fix.

### E. Clean evidence preprocessing before AI

Build a preprocessing layer that separates:

- poster or creator
- caption text
- tagged handles
- venue candidates
- address or city hints
- hashtags
- profile metadata
- transcript metadata
- Places candidates

Goal:

The model should not have to infer wrapper text every time. It should receive clean evidence.

### F. Structured batch evaluation

Improve the remote tester so batch results can export CSV and JSON with:

- url
- expected place
- actual place
- decision
- safeToAutoSave
- candidate names
- model used
- model latency
- total latency
- reasoning
- warnings
- correct / incorrect / unknown
- notes

Goal:

Make model and provider comparisons data-driven.

### G. Gold test set

Maintain a growing test set of 30-100 real social links with expected outcomes:

- should find exact place
- should show candidate confirmation
- should manual fallback
- should never save
- should reject wrong candidates

### H. Provider abstraction

Create interfaces before deep provider integrations:

- SocialProfileProvider
- SocialTranscriptProvider
- SocialMetadataProvider
- ModelProvider

Goal:

Avoid hardcoding Instagram, TikTok, YouTube, and Twitter provider logic everywhere.

### I. Separate extraction from save decision

Hard architecture rule:

- Model extracts or proposes the place.
- Deterministic safety gate decides saved, candidate_confirmation, manual_fallback, or failed.

### J. Multi-candidate UX

Improve handling when multiple candidates are plausible.

Example:

Lalla Grill may return multiple Monterey candidates. The app should show both clearly rather than pretending one is certain.

### K. Prompt/model version tracking

Every extraction result should keep:

- promptVersion
- model
- provider
- tools used
- reasoning
- safety decision
- final status

## Things to Remove, Reduce, or Quarantine

### A. Live Instagram profile scraping in the user flow

Current live profile fetch often hits `http_429`. It should be best-effort only or replaced by a provider-backed profile system.

### B. Noisy social-wrapper Places queries

Places should never receive full social wrapper text like:

- "Creator Name on Instagram: ..."
- "Travel Influencer on TikTok: ..."

Places should receive clean queries like:

- "Crystal Fish Monterey"
- "The C Restaurant Monterey CA"
- "Old Fisherman's Grotto Monterey"

### C. Aggressive timeout recovery

Timeout recovery must stay conservative.

It should never return candidates from weak or generic tokens like:

- media
- food
- eats
- cafe
- restaurant
- breakfast
- travel
- lifestyle
- creator

### D. Auto-save during beta

Auto-save should remain disabled or feature-flagged until batch evals are strong.
Candidate confirmation is safer for now.

### E. Legacy extraction pipeline

Eventually remove or quarantine:

- old regex query builders
- duplicated client/server extraction logic
- legacy generic query gates
- client-side AI fallback
- over-specific one-off rules

Do not remove yet. Only remove after the agent path and batch eval system are stable.

## Near-Term Priorities

1. Add CSV/JSON export to remote tester.
2. Build and maintain gold test set.
3. Improve clean evidence preprocessing.
4. Research and test third-party bio providers.
5. Research and test transcript providers.
6. Compare Gemini, OpenAI, Anthropic, and xAI models using Nearr batches.
7. Keep auto-save off or feature-flagged until the eval set proves reliability.
8. Consider background jobs after accuracy is better understood.

## Success Criteria

Extraction system is ready for broader beta when:

- 0 wrong auto-saves in test set.
- 0 unrelated candidates in test set.
- Most explicit venue or address posts become candidate confirmation or safe save.
- Generic or no-evidence posts become clean manual fallback.
- Debug output clearly explains why each result happened.
- Model and provider changes can be compared using exported eval results.

## Open Questions

- Which third-party bio provider is most reliable and affordable?
- Which transcript provider is best for Instagram, TikTok, YouTube, and Twitter?
- Which model is best when input evidence is clean?
- Should background jobs come before or after transcript integration?
- What is the threshold for enabling auto-save?
- How many successful batch links are enough before enabling auto-save?