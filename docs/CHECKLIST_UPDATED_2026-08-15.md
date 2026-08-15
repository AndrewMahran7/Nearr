# 🧭 NEARR — VERSION GATE SYSTEM
## Feature ↔ Metric Linked Roadmap and Staged Backlog

**Last updated:** 2026-08-15  
**Current stage:** Stage 0 — Foundation / Quiet Production  
**Current launch mode:** Quiet production release, not broad public launch  
**Current downloads:** ~23 / 30 Stage 0 target  
**Current download progress:** ~77%

---

# 📍 CURRENT STATUS SNAPSHOT

Nearr is still in Stage 0, but the product thesis is becoming sharper.

The current app already attempts the full loop:

> **Social video → identify the real place → save it → keep the original source → resurface it later → help the user go.**

The immediate product job is still reliability. The new strategic hypothesis is that the strongest acquisition hook may be:

> **Find any place you see in a video. Then actually go there.**

This is not yet permission to abandon the existing product. The working model is:

- **Detective / “Shazam for videos” = acquisition and magic moment**
- **Save → map → reminder → original video → directions → visit = retention and long-term utility**

## Current Stage 0 progress

| Metric | Target | Current | Status |
|---|---:|---:|---|
| Downloads | 30 | ~23 | ~77% complete |
| WAU | 15 | Not recorded here | Measure |
| WAU / downloads | 40% | Not recorded here | Measure |
| First-save attempt rate | 50% | Not recorded here | Instrument |
| First-save success rate | 70% | Not recorded here | Instrument |
| Average saves per user | 3 | Not recorded here | Instrument |
| Wrong saves | ≤20% | Not recorded here | Instrument |
| Post-save map focus | 90% | Not recorded here | Instrument |
| Understanding | 70% | Qualitative testing underway | Measure |
| Crash rate | <5% | Not recorded here | Measure |

## Current priority

The current priority is **not broad growth yet**.

The current order is:

1. Fix all core-loop bugs and friction.
2. Make the place-detail and nearby experiences enjoyable enough that users want to reopen them.
3. Preserve and surface the original video and a useful AI “why you saved this” note.
4. Reduce map clutter and make filters actually change what the user sees.
5. Make video/media ingestion reliable across Instagram, TikTok, YouTube Shorts, Facebook Reels, and Snapchat when technically and legally supportable.
6. Prove that queue depth makes Nearr slower, not less accurate.
7. Add one bounded automatic retry for transient “no usable candidate” outcomes.
8. Run the Detective Mode validation experiment before treating “Shazam for videos” as the company-wide pivot.
9. Only then push UGC harder.

## Current known product-quality work

### Core reliability

- [ ] Physically verify queue-item navigation on iPhone after the current queue fix ships in a build.
- [ ] Ensure a queue item never opens to a generic error when the underlying job exists and is readable.
- [ ] Verify completed queue items open the saved place on the map.
- [ ] Verify candidate jobs show persisted candidates immediately.
- [ ] Verify media failure cannot erase already-valid metadata candidates.
- [ ] Add the cheapest safe one-time retry when a transient resolution failure produces no usable candidate.

### Place-detail quality

- [ ] Redesign the individual place experience around a strong hero image, useful metadata, source context, and actions.
- [ ] Add grounded AI “why you saved this” copy without overwriting user notes.
- [ ] Show useful metadata such as open/closed state and today’s closing time when available.
- [ ] Keep original video prominent.
- [ ] Make nearby reminder controls compact rather than dominating the page.
- [ ] Make the nearby-reminder landing experience feel like the normal place screen with extra nearby context, not a system alert.
- [ ] After “I went here,” test one lightweight follow-up such as thumbs up / thumbs down rather than a full review flow.

### Media and map polish

- [ ] Make the photo carousel update the active/bright image immediately enough to feel responsive.
- [ ] Replace unproductive map chips with filters that materially reduce clutter.
- [ ] Keep all top-level map controls aligned and visually coherent.
- [ ] Add clustering / density behavior or another proven clutter solution if filters alone are insufficient.
- [ ] Preserve a fast path to “View All” / personal library without covering the map with controls.

## Current operating rule

At ~23 downloads, the primary constraint is still **product reliability and magic**, not acquisition volume.

Do not use growth to hide product failures.

# 🚨 MASTER RULE

You do **not** build the next stage merely because the current backlog is finished.

A stage unlocks only when its required metrics and acceptance tests are satisfied.

Every feature must do at least one of the following:

1. Improve a tracked metric
2. Reduce a meaningful product, legal, reliability, trust, or distribution risk
3. Make the save → map → action loop easier to understand
4. Preserve data required for a later validated business model
5. Remove a proven bottleneck observed in real user behavior

Deadlines do not unlock stages.

Competitor features do not unlock stages.

Founder excitement does not unlock stages.

A feature request from one person does not unlock a stage unless it reveals a core usability or reliability issue.

If a deadline passes and metrics are not hit, the stage remains locked.

---

# 🧱 FEATURE MATURITY DEFINITIONS

A feature being coded early does not mean Nearr has earned the right to invest in it.

- **Backlog:** Defined, but not approved for development.
- **Allowed:** May be built because it directly supports the active stage.
- **Built:** Code exists, but may be incomplete or unreliable.
- **Instrumented:** Relevant events and failure states are measurable.
- **Real-device tested:** Tested on enough physical devices to expose obvious failures.
- **Production-visible:** Available in the production app.
- **Productized:** Reliable enough to be part of the public product promise.
- **Metric-proven:** Demonstrably improves the metric it was intended to affect.
- **Stage-unlocked:** The required stage metrics and acceptance tests are satisfied.

**Built does not equal productized.**

**Productized does not equal metric-proven.**

**A future-stage feature built early remains a future-stage feature.**

Examples:

- Reminder infrastructure existing in Stage 0 does not mean the Stage 3 habit loop is proven.
- A feedback form existing does not mean retention is solved.
- An App Store release does not mean Nearr has publicly launched.
- A creator liking the concept does not mean creator distribution is repeatable.
- A creator dashboard mockup does not mean creators need a dashboard.
- A social profile screen does not mean Nearr has social activity worth displaying.
- An AI recommendation demo does not mean Nearr has enough behavior data to recommend anything useful.

---

# 🏷️ BACKLOG PRIORITY DEFINITIONS

Each stage uses the following priority labels.

## P0 — Stage blocker

Must be completed or explicitly disproven before the stage can unlock.

P0 work normally includes:

- Core loop failures
- Onboarding confusion
- Wrong saves
- Missing analytics
- Crashes
- Authentication failures
- App Review or legal blockers
- Broken post-save behavior

## P1 — Metric driver

Directly improves the active stage’s required metrics.

P1 work should be backed by:

- User observations
- Funnel data
- Failure reports
- Repeated feedback
- A clear hypothesis

## P2 — Quality improvement

Useful polish that improves trust or usability but is not currently blocking a metric.

Build P2 work only after P0 is under control.

## P3 — Future option

Strategically interesting, but not justified by current evidence.

P3 items remain documented so they are not forgotten. They are not permission to build.

## Rejected for now

A feature that conflicts with current positioning, creates a cold-start problem, or copies competitors without strengthening Nearr’s core advantage.

Rejected does not necessarily mean “never.” It means “not without new evidence.”

---

# 🧭 PRODUCT EXPERIENCE RULE

The product experience section describes how Nearr should feel at each stage.

Feeling correct does not unlock a stage by itself.

The metrics and acceptance tests must still pass.

However, a stage should not unlock if the metrics were achieved through a confusing, misleading, spammy, or fragile experience.

---

# 🧒 FIVE-YEAR-OLD USABILITY STANDARD

This is a Stage 0 design standard, not a literal target demographic.

A new user should be able to understand the main action without knowing:

- What extraction means
- What a candidate is
- What geofencing means
- What confidence scoring means
- What metadata means
- How the backend works
- Why permissions exist before the benefit is shown

## Required interaction standard

At every important screen, the user should understand:

1. What just happened?
2. What should I do next?
3. What will happen when I tap the main button?
4. How do I recover if Nearr is wrong?

## Language standard

Prefer:

- “Is this the restaurant?”
- “We found two possible places.”
- “Search for the restaurant.”
- “Added to your map.”
- “Open the original video.”
- “Remind me when I’m nearby.”
- “We couldn’t find the restaurant.”

Avoid:

- Candidate confirmation
- Extraction result
- Resolve location
- Manual fallback
- Processing state
- Evidence source
- Confidence threshold
- Geofence configuration
- Entity resolution

## Visual hierarchy standard

Each screen should normally have:

- One obvious primary action
- No more than one secondary action competing with it
- A clear back or cancel path
- Plain-language status
- A visible recovery path when something fails

---

# 🧠 CURRENT STRATEGIC REALITY

Nearr is operating in a validated but competitive behavior category.

Users already:

- Save restaurant and travel videos inside Instagram, TikTok, YouTube, Facebook, and Snapchat.
- Screenshot places they cannot identify.
- Ask “where is this?” in comments.
- Copy places into Google Maps.
- Keep restaurant lists in Notes.
- Use Beli to track restaurants.
- Use Corner and similar apps to discover and organize places.
- Forget most of what they save.

The old product promise is useful but not uniquely compelling enough on its own:

> **Save places from social media to a map.**

The stronger strategic hypothesis is:

> **Find the real place behind a video, even when the video does not make it obvious. Then save it and help the user actually go.**

This changes the competitive frame.

Nearr should not try to win by having the largest map, social graph, ratings database, or editorial operation.

Nearr should try to win at:

1. **Cross-platform video-to-place understanding**
2. **Multi-signal investigation when the location is unclear**
3. **Transparent ranked leads when certainty is impossible**
4. **Preserving the original source and reason for saving**
5. **Turning the result into persistent real-world intent**
6. **Closing the loop with reminders, directions, and visits**

## New wedge hypothesis

The Detective Mode / “Shazam for videos” concept is potentially a better acquisition hook because it naturally creates curiosity and demonstration content:

> “Send me a video. I’ll tell you where it is.”

But it is not yet proven to be a repeat behavior.

The biggest strategic risk is building a technically impressive one-time gimmick that users do not repeat.

The product must prove that people start forwarding Nearr **multiple videos they genuinely want identified**, not merely try it once because it looks cool.

## Competitive watch

Re-verify competitors before major strategic or pricing decisions because capabilities change quickly.

### Google Lens / visual search

Threat:

- Massive distribution
- General visual search
- Place/landmark recognition
- Increasing integration into video and mobile browsing

Nearr must not depend on “AI can recognize a place” as its moat.

### GeoSeer / Picarta / GeoSpy-style geolocation products

Threat:

- Dedicated image/video geolocation
- Strong technical geolocation positioning
- Paid professional or power-user demand

Nearr’s differentiation should be the consumer workflow:

> social video → all available clues → exact real-world place or ranked leads → save → map → reminder → action

### Corner / Beli

Threat:

- Better-developed consumer place organization, social proof, or restaurant tracking

Nearr should not copy their breadth prematurely.

## Working strategic conclusion

Do **not** pivot Nearr into a generic AI geolocation company.

Pivot the story first:

> **Old:** Save places you see on social media.
>
> **Working new story:** Find any place you see in a video. Then actually go there.

Detective Mode gets attention.

The existing Nearr loop must create retention.

# 🧲 COMPETITIVE BOUNDARY

## Corner is strongest at

- Place discovery
- Social identity
- Curated maps
- Friend and creator influence
- Broad place categories
- Cultural brand and content

## Beli is strongest at

- Restaurant tracking
- Personal rankings
- Taste data
- Friend recommendations
- Post-visit engagement
- Restaurant-specific organization

## Nearr must become strongest at

- Food-content-to-place extraction
- Difficult and ambiguous post handling
- Fast share-to-map behavior
- Transparent uncertainty
- Preserving the original creator and post
- Nearby and contextual resurfacing
- Source → save → action attribution
- Providing value without friends, followers, or rating history

## Features Nearr must eventually match at a basic level

These are category expectations, not differentiation:

- Reliable saved-place map
- Searchable personal library
- Basic filters
- Notes
- Original source access
- Simple visited state
- Directions
- Shareable place or shortlist
- Stable onboarding and authentication

## Features Nearr should differentiate on

- Correctly identifying unnamed or unclear restaurants
- Explaining ambiguity in plain language
- Keeping creator and source context visible
- Resurfacing saved intent at useful moments
- Measuring creator-driven saves and actions
- Remaining useful from the first save
- Avoiding forced social participation

## Features Nearr should not copy early

- Social feed
- Public user profiles
- Restaurant ratings
- Pairwise restaurant ranking
- Taste-match percentages
- Public leaderboards
- Saving streaks
- Generic AI discovery
- Broad city guide operation
- Large editorial team
- Full reservation marketplace
- Broad non-food positioning

---

# 🎯 CURRENT POSITIONING

Nearr should not position itself as a generic organizer, social network, generic AI map, or universal geolocation engine.

## Current production positioning

Until the Detective Validation Gate passes, keep the proven food-oriented explanation simple:

> **Save food spots from social media. See them on your map. Remember them nearby.**

## Working Detective Mode positioning to test

Test, do not yet assume:

> **Find any place you see in a video. Then actually go there.**

Alternative test copy:

> **Shazam for places in videos.**

> **Share a video. Nearr follows the clues and finds the place.**

> **See a place online but cannot find it? Send the video to Nearr.**

## Product architecture framing

There are two paths through the same product:

### Easy path

The post clearly names or tags the place.

Nearr should save it quickly with minimal ceremony.

### Detective path

The post is unclear, hidden, ambiguous, or incomplete.

Nearr should investigate clues, retrieve real candidate places, explain the best leads, and ask only when necessary.

Do not slow obvious saves down just to make Detective Mode feel dramatic.

## Internal competitive framing

> **Beli tracks your dining life. Corner helps you discover places. Generic geolocation tools guess where media was captured. Nearr turns social video into an exact place and then into real-world action.**

Avoid investor or technical language in consumer-facing copy:

- Place-intent graph
- Social evidence extraction
- Entity resolution
- Confidence threshold
- Multimodal geolocation pipeline
- Resolver
- Candidate ranking
- AI-powered local intent

# 🕵️ DETECTIVE MODE VALIDATION GATE

Detective Mode is strategically important enough to test early, but **full product investment is gated by evidence**.

## What the product may promise during testing

Allowed:

> “Send us a video and we’ll try to find the place or give you the best leads we can find.”

Not allowed:

> “Nearr can identify any place on Earth from any video.”

Top-3 candidate success is a valid outcome for genuinely hard cases.

## Cheapest serious validation experiment

Use approximately **100 difficult public/permissioned videos** across categories and platforms.

Include:

- Restaurants
- Cafes
- Hotels
- Hikes
- Beaches
- Attractions
- Stores
- Scenic locations
- Videos with the exact name visible
- Videos with name only in caption
- Videos with name only in audio
- Videos with name only in comments
- Videos with partial signs or menu text
- Videos with no explicit name
- Chain locations
- Misleading tags
- Multiple-place videos
- Truly unresolvable videos

## Required Detective metrics

Track:

- Top-1 exact-place accuracy
- Top-3 contains-correct-place accuracy
- Wrong confident answer rate
- No-answer / manual rate
- Median and P95 time to result
- Cost per investigation
- Percentage that require media download
- Percentage recovered by one automatic retry
- Percentage where comments materially change the answer
- Percentage where user selects a candidate
- Percentage where identified place is saved
- Percentage of users who submit a second detective video
- Percentage of users who submit 3+ detective videos
- Result-share rate
- Willingness to pay / credit-purchase intent

## Pivot gate

Do not call this the company pivot until the experiment shows both:

1. **Technical value:** the correct place is usually returned in a useful top result or short candidate list.
2. **Behavioral value:** users repeatedly submit additional videos without founder prompting.

A one-time “wow” reaction is not enough.

## Early success hypothesis

A promising early result would look something like:

- Top-1 accuracy strong on explicit or semi-explicit videos
- Top-3 materially stronger on hard videos
- Wrong confident answers rare
- Meaningful repeat-submission behavior
- Users save the identified place rather than treating the result as trivia

Do not hard-code arbitrary target percentages until the first benchmark establishes a baseline.

---

# 🔎 DETECTIVE EVIDENCE STACK

The LLM should be the **investigator and reasoning layer**, not the database of truth.

The system should gather evidence, form hypotheses, retrieve real places, and verify candidates.

## Tier 1 — explicit identity clues

Highest-value signals:

- [ ] Caption / description
- [ ] Explicit place or business tag
- [ ] Visible storefront name
- [ ] Menu header / branded menu text
- [ ] Address visible in frame
- [ ] Phone number / area code
- [ ] Website / domain
- [ ] Receipt or branded packaging
- [ ] Spoken place name in transcript
- [ ] Creator reply naming the place
- [ ] Highly liked comment naming the place

## Tier 2 — strong narrowing clues

- [ ] City / neighborhood mentioned in caption
- [ ] Hashtags
- [ ] Street names
- [ ] Transit station / route names
- [ ] Local chain / logo
- [ ] Sports team / university / venue branding
- [ ] Language
- [ ] Currency
- [ ] Driving side
- [ ] Road signs / road markings
- [ ] License-plate style where legally and safely useful
- [ ] Landmark / skyline
- [ ] Distinctive natural feature
- [ ] Creator’s public location context when relevant and appropriate

## Tier 3 — supporting visual clues

- [ ] Architecture
- [ ] Vegetation
- [ ] Terrain
- [ ] Coastline
- [ ] Weather / climate cues
- [ ] Interior design
- [ ] Dish / menu style
- [ ] Store layout
- [ ] Nearby businesses visible in frames
- [ ] Event / seasonal context

## External retrieval and verification

Evidence must be grounded against real candidate places using available sources such as:

- [ ] Google Places / Maps data
- [ ] Search/web context where compliant
- [ ] Business websites
- [ ] Public business photos
- [ ] Menus
- [ ] Addresses
- [ ] Hours
- [ ] Category
- [ ] Candidate storefront/interior imagery when available

## Comments rule

When comments are technically accessible and platform-compliant:

- Prefer creator replies and highly liked comments.
- Look for repeated place names, city hints, or corrections.
- Treat comment consensus as evidence, not unquestionable truth.
- If the **only** strong evidence comes from comments, prefer user confirmation before silently saving.

## Evidence-to-result contract

- 0 plausible candidates → manual search / “help us track it down”
- exactly 1 plausible candidate with no real contradiction → save
- exactly 1 candidate with a genuine contradiction/blocker → quick check
- 2+ plausible candidates → ranked candidate picker

Do not reintroduce arbitrary confidence thresholds after only one plausible candidate remains.

---

# 🏷️ BRAND / NAME TRANSITION BACKLOG

The current Nearr name should not become a deliberate “wait for a cease-and-desist” strategy.

Treat naming as a risk-reduction project before major marketing spend.

## Naming criteria

The new name should ideally be:

- Short
- Pronounceable
- Easy to spell after hearing it once
- Broad enough to survive category expansion
- Suggestive of clues, finding, scenes, or place discovery without being generic
- Protectable enough to justify building a brand around it
- Available or realistically obtainable across app stores, domains, and major social handles

## Working brainstorm — not trademark cleared

- Cluvia
- PlaceCue
- SeenHere
- SpotTrace
- WhereFrame
- Locavio
- PlaceTrace
- FindFrame
- CueMap
- SceneScout

None of these should be adopted until clearance work is done.

## Clearance checklist

Before committing to a replacement brand:

- [ ] USPTO knockout search
- [ ] Broader common-law web search
- [ ] App Store / Play Store search
- [ ] Domain availability / practical acquisition cost
- [ ] Major social-handle search
- [ ] Search for confusingly similar companies in maps, travel, AI, video, discovery, geolocation, and local recommendations
- [ ] Attorney review before meaningful paid brand investment if ambiguity remains
- [ ] Plan migration of bundle-facing copy, website, social accounts, App Store listing, and legal documents

Do not rush the rename during Stage 0 bug fixing unless legal risk requires it.

---

# 🧩 CORE LOOP

The product should support both obvious and difficult videos without forcing every save into the same amount of work.

## Core loop

1. User sees a real-world place in a video or post.
2. User wants to know where it is or wants to remember it.
3. User shares or pastes the post into Nearr.
4. Nearr captures easy evidence first.
5. If the place is obvious, Nearr resolves it quickly.
6. If the place is unclear, Detective Mode gathers additional clues from the video and context.
7. Nearr retrieves real candidate places and verifies them against the evidence.
8. Nearr saves automatically only when one plausible place remains without a genuine contradiction.
9. Otherwise Nearr shows the best short list or manual search.
10. Nearr saves the place and original source.
11. The map focuses on the result.
12. The place page preserves:
   - visual context
   - why it was saved
   - original video
   - creator/source
   - hours/open status when available
   - distance
   - directions
13. Nearr resurfaces the place later when useful.
14. The user reopens the source, checks hours, gets directions, or decides not to go yet.
15. Nearr optionally asks whether the user went.
16. If visited, Nearr may ask one lightweight satisfaction signal such as thumbs up / thumbs down.

The product should feel like:

> **“I saw this place online, Nearr figured out what it was, reminded me why I cared, and helped me actually go.”**

## Fast-path rule

Do not make obvious posts wait for expensive detective analysis.

Metadata and explicit names should win quickly when sufficient.

## Hard-case rule

Do not pretend certainty when the video is genuinely ambiguous.

A useful top-3 with reasons is better than a confident wrong answer.

# 📏 METRIC DEFINITIONS

These definitions should remain stable so stage comparisons are meaningful.

## Download

A unique App Store or Play Store installation where available. Do not substitute landing-page visits.

## Signed-in user

A user who successfully completes authentication and creates a usable account session.

## First-save attempt rate

Unique signed-in users who start a share, paste, or manual-save attempt divided by unique signed-in users.

## First-save success rate

Unique users whose first attempt produces a correctly saved, usable place divided by users who attempt a first save.

A save is not successful merely because a database row exists.

It must:

- Represent the correct place
- Be visible to the user
- Be retrievable later
- Preserve the source when available
- Not leave the interface in a misleading state

## Wrong save

A save that confidently stores the wrong real-world place without clearly asking the user to confirm.

A low-confidence result that asks the user to choose is not a wrong save.

## Map focus success

The saved place appears and is focused or highlighted after save completion.

## Reopen rate

Percentage of activated users who reopen Nearr in the measured retention window.

## Second-save rate

Percentage of users with one successful save who successfully save another place.

## Action rate

Percentage of active users who perform a meaningful real-world-intent action:

- Open directions
- Start navigation
- Open reservation or ordering
- Mark visited
- Reopen the original source to decide
- Use a decision flow that results in a selected place

## Weekly Active Decider

A weekly active user who makes at least one saved-place decision or action.

## Creator-sourced activation

A user attributed to a creator who installs, signs in, and completes a correct first save.

Creator impressions and installs alone do not count.

---

# 🧪 CURRENT BUILD REALITY

Some features already exist even though Nearr remains in Stage 0.

Existing code does not override stage gates.

## Built or mostly built

### Auth and entry

- Magic-link authentication
- Dev/test login
- Auth callback route
- Pre-auth onboarding
- Sign-in contrast cleanup
- Sign-in back navigation

### Async share-job foundation

- Durable `share_jobs` queue as the user-facing source of truth
- Queue UI
- Async metadata processing
- Candidate/manual-help states
- Realtime queue updates
- Lease/claim model for background work
- Bounded attempts and recovery behavior
- Push/background-completion infrastructure

This is a major asset for Detective Mode because hard investigations can continue without trapping the user in a foreground spinner.

### Save and extraction

- Save from link/share
- Manual paste flow
- Candidate confirmation
- Source URL storage
- Original post opening
- Save success can route to the map
- Existing metadata-based resolver
- Instagram media fallback infrastructure
- Railway media worker
- Video download / temporary processing architecture
- Frame extraction
- Audio/transcript path
- LLM/media evidence analysis
- Google Places resolution
- Candidate persistence

### Recent reliability behavior

- Persist metadata candidates before media fallback.
- Do not let later media failure erase already-valid candidates.
- Parent job remains the user-facing source of truth.
- Failed media should degrade to retry/review/manual behavior rather than silent wrong saves.
- Queue depth is being treated as a correctness question, not merely a speed question.

### Map and place view

- Map
- Search
- Nearby / Recent / Saved chips
- Saved-place list
- Place bottom card
- Expanded place details
- Directions
- Notes
- Saved-from-source label
- Remove from saved
- View All
- Selected place persistence has been scoped

Current design work still needs to improve:

- place-detail fun/visual quality
- grounded AI note
- hours/open state
- compact reminder controls
- original-video prominence
- carousel responsiveness
- map clutter/filter usefulness

### Reminder infrastructure

- Notification permission flow
- Location permission setup
- Nearby reminder toggle
- Distance settings
- Test notification
- Foreground/background checks
- Geofencing infrastructure
- Setup checklist

This is infrastructure, not proof of retention.

### Platform media support reality

Current media-depth support is not yet equally strong across platforms.

Target before aggressive UGC:

- [ ] Instagram reliable
- [ ] TikTok reliable
- [ ] YouTube Shorts reliable
- [ ] Facebook Reels reliable
- [ ] Snapchat public-share flow reliable where technically possible

Do not assume a platform is supported because URL parsing works. Media retrieval, evidence extraction, retries, and user-facing fallback must all work.

### Trust and production polish

- In-app feedback
- Legal links
- In-app account deletion
- Server-side hard deletion
- Runtime diagnostics gated
- Testing section gated
- App Store screenshot planning
- Quiet production release process

### Onboarding and education

- Pre-auth intro
- Share Favorites explanation
- Share-to-Nearr explanation
- Nearby reminder explanation
- First-save actions
- Tutorial video planning

## Current infrastructure warning

EAS Update channels were not baked into earlier production binaries.

The next suitable native build should intentionally configure update channels so future JS-only fixes can ship without requiring a fresh TestFlight/App Store build each time.

# 🚫 CURRENT PRODUCT RISKS

## 1. First-save reliability risk

If the first save fails, hangs, saves the wrong place, or does not visibly appear, Nearr loses trust immediately.

## 2. Understanding risk

Users may understand the general idea but still not know:

- Where to start
- How to share
- What permissions are for
- Whether the save succeeded
- How to fix a wrong result

## 3. Empty-product risk

A map with few saves can feel unfinished. The first successful save must create a visible reward.

## 4. Permission trust risk

Location and notification access can feel invasive if asked before value is demonstrated.

## 5. Source-memory risk

A pin without the creator, original video, dish/experience, or reason for saving becomes less valuable over time.

## 6. Competition risk

Nearr is squeezed from multiple directions:

- Google-class visual search can commoditize basic recognition.
- Dedicated geolocation products can outperform on pure image/video location inference.
- Corner/Beli-like products can outperform on social/place-library breadth.

Nearr needs the integrated source → investigation → place → action loop.

## 7. Detective gimmick risk

Users may love a demo but never use it twice.

Repeat detective submissions matter more than “wow” comments.

## 8. Detective accuracy risk

A confident wrong location can be worse than no answer.

Top-3 candidate presentation and transparent uncertainty are product features, not failures.

## 9. Cost and latency risk

Deep video investigation may require:

- media download
- OCR
- transcript
- multiple frames
- LLM calls
- external retrieval
- candidate verification

The system must escalate only when cheaper evidence is insufficient.

## 10. Platform dependency risk

Social platforms can change URL formats, access controls, media delivery, comments availability, or anti-bot behavior.

Do not build the company around brittle unofficial access assumptions.

## 11. Burst correctness risk

If many saves arrive quickly, latency may rise.

Accuracy must not materially fall simply because queue depth increased.

Accepted jobs must never disappear.

## 12. Creator distribution risk

Creators may respond positively without testing, sharing, or producing activated users.

## 13. Marketing leakage risk

Paid or creator-driven traffic can hide a broken funnel by producing installs without successful first saves or retention.

## 14. Brand / trademark risk

Do not invest heavily in a brand name while knowingly leaving a plausible trademark conflict unresolved.

## 15. Sensitive-location risk

A “find where this video was taken” product can create safety and privacy problems.

Do not position Detective Mode as a tool for exposing intentionally hidden private residences, vulnerable people, restricted infrastructure, sensitive wildlife locations, or dangerous/illegal access points.

The initial product should focus on public businesses, attractions, destinations, and other places people reasonably expect visitors to find.

# 🚦 LAUNCH MODE DEFINITIONS

## Development build

Founder and internal testing.

## Quiet production release

Nearr is available through the App Store but is not broadly promoted.

Purpose:

- Remove TestFlight friction
- Give testers a normal installation path
- Test real production authentication
- Test real share behavior
- Collect structured feedback
- Improve onboarding and first-save reliability
- Conduct private creator evaluations

This is still a beta internally.

## Controlled growth test

Small, measured promotion to limited audiences.

Examples:

- One creator test
- A few UGC videos
- A campus or local-community test
- A small organic content batch

Controlled growth requires:

- Stage 0 acceptance passed
- Attribution links or campaign codes
- First-save funnel instrumentation
- Ability to stop quickly
- Clear test budget
- No broad launch claims

## Public launch

Nearr is actively promoted through repeated creator posts, sustained UGC, paid acquisition, press, Product Hunt, or broad announcements.

Public launch requires Stage 1 acceptance unless an unusual organic opportunity justifies an earlier controlled experiment.

---

# 🧑‍🍳 FOOD-FIRST ACQUISITION, CATEGORY-NEUTRAL DETECTION RULE

Food remains the best early acquisition and benchmarking wedge unless real usage disproves it.

Until the Detective Validation Gate passes, food should remain the primary:

- App Store example
- Onboarding example
- Creator outreach wedge
- UGC baseline
- Benchmark category
- Nearby-reminder demonstration

However, the **detector architecture should not be artificially food-only**.

Detective Mode may technically attempt public real-world places such as:

- restaurants
- cafes
- hotels
- hikes
- beaches
- attractions
- stores
- gyms
- scenic locations

This does not automatically unlock broad marketing or category-specific product investment.

## Rule

> **Food-first acquisition. Category-neutral place understanding. Category expansion only when behavior proves it.**

Food still has the strongest early combination of:

- Creator supply
- Repeated user intent
- Clear local action
- High visual content volume
- Restaurant and creator attribution potential
- Natural nearby value

Do not force non-food results into restaurant-specific metadata or UX.

# 📣 CREATOR AND UGC RULES

## Private creator evaluation

Allowed in Stage 0.

Purpose:

- Understand creator value
- Observe whether creators understand the product
- Learn how their followers currently save posts
- Test Nearr against real creator content

Do not ask for promotion during the first interaction.

## Creator promotion

Allowed only after Stage 0 acceptance and a reliable production first-save loop.

A creator should not risk their reputation on an experience that still requires founder assistance.

## UGC testing

Allowed as a small controlled test after Stage 0 acceptance.

Do not scale UGC because a video receives views.

Scale only when a creative produces:

- Qualified installs
- Successful first saves
- Correct saves
- Second saves
- Retained users

## Creator funnel expectations

A realistic early funnel may look like:

- 100 personalized creators contacted
- 10–25 replies
- 5–15 evaluations
- 3–8 meaningful product conversations
- 1–3 controlled promotion tests
- A smaller number of activated and retained users

The response rate is less important than learning whether a repeatable creator value proposition exists.

## Current creator outreach standard

Each outreach should ideally include:

- A specific reference to the creator’s content
- One of their posts tested in Nearr
- A short personalized screen recording
- One narrow ask
- A clear time requirement
- Compensation when substantial evaluation work is requested

---

# 💸 MONETIZATION RULE

Core consumer saving, maps, reminders, and ordinary place recall should remain free during the early stages.

Do not add:

- Paywall before first value
- Consumer subscription for basic saving
- Traditional feed ads
- Paid feature gates requiring friend invitations
- Sponsored results presented as organic recommendations

## Detective Mode monetization hypothesis

Detective Mode may eventually justify consumer payment because deep investigations can have real marginal cost and episodic high value.

Do **not** charge before proving repeat demand.

### Preferred sequence

1. Give the user a free magic moment.
2. Measure how often users submit another difficult video.
3. Measure actual per-investigation cost.
4. Test willingness to pay.
5. Prefer credits / packs if usage is episodic.
6. Consider a subscription only if a meaningful segment uses Detective Mode repeatedly enough for recurring value.

### Potential future model

Free:

- Easy identification
- Core saving
- Maps
- Reminders
- A limited number of deep detective searches

Paid deep-detective credits:

- More expensive multi-pass investigation
- Additional frame/OCR/transcript analysis
- Comments/web clue retrieval when compliant
- Candidate verification
- Additional model/provider pass
- Batch investigations

Power-user / creator tier may be tested later if creators actually need repeated or batch analysis.

## Monetization gate

Do not charge for Detective Mode merely because competitors charge for geolocation.

Charge only when:

- users repeat the behavior
- the result creates enough value
- marginal cost is understood
- free alternatives do not make the paid value trivial
- payment does not destroy the acquisition hook

Long-term non-consumer monetization may still come from:

- Creator analytics
- Restaurant demand analytics
- Campaign attribution
- Reservation or ordering attribution
- Promoted intent surfaces with clear labeling
- Creator and business tools
- Aggregated market intelligence

# 🔥 STAGE 0 — FOUNDATION / QUIET PRODUCTION

**Current status:** Active  
**Current downloads:** ~23 / 30  
**Launch mode:** Quiet production  
**Primary metric:** Correct first saves  
**Estimated valuation:** $0–$250K if usage is real and retention is healthy

---

## 🎯 Stage 0 goal

A new user can understand Nearr, complete a correct first save, see it on the map, and know what to do next without founder assistance.

## 🧭 Product experience

Nearr should feel understandable within 30 seconds.

Main feeling:

> “Oh, I get it. I share restaurant videos here, and Nearr puts the real place on my map.”

---

## 📊 Stage 0 required metrics

### Distribution and activity

- Downloads ≥ 30
- WAU ≥ 15
- WAU / downloads ≥ 40%

### Activation

- Sign-in completion is measurable
- First-save attempt rate ≥ 50% of signed-in users
- First-save success rate ≥ 70%
- Average saves per user ≥ 3
- Second-save behavior is measured, even if not yet gated

### Accuracy and trust

- Wrong saves ≤ 20%
- Low-confidence saves ask the user instead of silently saving
- Post-save map focus success ≥ 90%

### Reliability

- Crash rate < 5%
- Auth callback works reliably
- Share and paste flows never hang indefinitely
- Failed saves always provide a recovery action

### Understanding

- At least 7/10 users can explain Nearr after onboarding
- At least 7/10 users know how to start a save
- At least 7/10 users understand where a successful save went
- At least 7/10 users can recover from a failed or ambiguous result

---

## 🟥 P0 Stage 0 backlog — stage blockers

### Current stabilization pass — immediate P0

- [ ] Ship and physically verify the queue-item opening fix.
- [ ] Completed queue item opens the saved place on the map.
- [ ] Candidate queue item opens persisted candidates instead of a generic failure.
- [ ] Place-detail redesign feels visual and rewarding on a physical iPhone.
- [ ] Grounded AI note appears when available.
- [ ] AI note never overwrites the user’s note.
- [ ] Open/closed state and useful hours appear where place data supports them.
- [ ] Original video remains obvious from the place page and nearby-reminder flow.
- [ ] Nearby reminder card is compact and does not crowd out the place itself.
- [ ] “I went here” is easy to report without requiring a rating/review.
- [ ] Photo carousel active image brightens/updates without noticeable lag.
- [ ] Map clutter is reduced through meaningful filters and/or clustering.
- [ ] Replace or redesign Nearby / Recent / Saved chips if they do not materially help the user understand what is shown.
- [ ] Keep top map controls aligned; “View All” should not feel detached from the control system.
- [ ] Confirm EAS Update channel configuration in the next appropriate native production build.

### Correctness under bursts — immediate P0

Phase 2-style reliability work is allowed early because it protects the Stage 0 core loop.

Required invariant:

> **Queue depth may make Nearr slower, but it must not make Nearr materially less accurate.**

- [ ] Run identical ~20–30 post set serially and in bursts.
- [ ] Compare exact-place/top-candidate outcomes, not just job completion.
- [ ] Measure queue latency and media latency.
- [ ] Confirm accepted jobs never disappear.
- [ ] Confirm provider degradation produces retries/backpressure/review rather than silent wrong saves.
- [ ] Measure worker CPU/RAM/disk/subprocess behavior.
- [ ] Test concurrency 1 vs 2 vs 4 rather than guessing.
- [ ] Understand the interaction between worker concurrency and claim batch size.
- [ ] Test multi-worker safety before adding replicas.
- [ ] Add failure injection for provider timeout / 429 / malformed response where practical.
- [ ] Measure cost per share and cost per media fallback.
- [ ] Record percentage of saves escalating from metadata to media.
- [ ] Establish minimum observability before UGC traffic increases.


### Onboarding clarity

- [ ] Replace feature-heavy onboarding with a single clear story:
  1. See a restaurant video
  2. Share it to Nearr
  3. Nearr finds the place
  4. It appears on the map
  5. Nearr helps later
- [ ] Use realistic product screenshots or short demonstrations rather than abstract illustrations where possible.
- [ ] Make the primary CTA on every onboarding screen obvious.
- [ ] Remove competing CTAs.
- [ ] Make back navigation predictable.
- [ ] Make sign-in feel like the next step, not a separate product.
- [ ] Explain location and notifications only after the user understands the benefit.
- [ ] Add a visible “Save your first place” action.
- [ ] Test onboarding without explaining it verbally.
- [ ] Record where each tester pauses, mis-taps, or asks a question.

### First-save entry

- [ ] Make Share to Nearr the primary method.
- [ ] Keep Paste Link as a clear fallback.
- [ ] Make platform instructions specific to Instagram, TikTok, and YouTube.
- [ ] Ensure users know they must add Nearr to share favorites when relevant.
- [ ] Provide a sample post or guided first-save option if opening another app creates too much friction.
- [ ] Return users to the correct state after authentication or app switching.
- [ ] Ensure a user cannot accidentally create duplicate save attempts through repeated taps.

### Processing state

- [ ] Show immediate acknowledgement that Nearr received the post.
- [ ] Use plain-language progress:
  - Finding the restaurant
  - Checking the location
  - Adding it to your map
- [ ] Never show an indefinite spinner.
- [ ] Define a maximum foreground wait time.
- [ ] Allow long-running work to continue without trapping the user.
- [ ] Show a usable result, confirmation request, or recovery state.

### Correctness and ambiguity

- [ ] Treat a wrong silent save as worse than asking.
- [ ] Show “Is this the restaurant?” when confidence is insufficient.
- [ ] Show restaurant name, photo, neighborhood, address, and map context.
- [ ] Support multiple possible places.
- [ ] Support multiple restaurant posts with a clear selection flow or explicitly defer them.
- [ ] Make chain-location selection obvious.
- [ ] Make “None of these” available.
- [ ] Route “None of these” to search or manual map selection.
- [ ] Record why the user rejected a candidate where practical.
- [ ] Ensure manual correction replaces or cancels the incorrect candidate cleanly.

### Failure recovery

- [ ] Replace technical errors with plain-language explanations.
- [ ] Every failure state must offer at least one next action.
- [ ] Support:
  - Search by restaurant name
  - Paste another link
  - Try again
  - Report the problem
- [ ] Preserve the original URL when recovery begins.
- [ ] Avoid forcing the user to restart authentication or onboarding.
- [ ] Prevent failed attempts from appearing as successful saves.

### Post-save reward

- [ ] Route immediately to the saved place.
- [ ] Focus or animate the map to the place.
- [ ] Highlight the new pin.
- [ ] Show “Added to your map.”
- [ ] Display restaurant name and key location context.
- [ ] Keep “Open original video” visible.
- [ ] Offer Directions as a secondary action.
- [ ] Offer Save another as a natural continuation.
- [ ] Ensure the place remains visible after leaving and reopening the app.

### Production trust

- [ ] Hide all dev, reviewer, diagnostic, and testing UI.
- [ ] Remove technical copy from production.
- [ ] Verify Terms, Privacy, Support, and Account Deletion.
- [ ] Verify location and notification usage descriptions.
- [ ] Verify no public creator content is used without permission.
- [ ] Confirm production auth, share extension, deep links, and callbacks.
- [ ] Add a clear in-app feedback path.
- [ ] Add a failed-save report path with useful context attached.

### Instrumentation

- [ ] Track onboarding started.
- [ ] Track onboarding completed.
- [ ] Track sign-in started.
- [ ] Track sign-in completed.
- [ ] Track first-save entry method.
- [ ] Track save attempt started.
- [ ] Track extraction completed.
- [ ] Track confirmation shown.
- [ ] Track candidate selected.
- [ ] Track manual fallback used.
- [ ] Track save completed.
- [ ] Track save failed with normalized failure reason.
- [ ] Track post-save map focus.
- [ ] Track original source opened.
- [ ] Track directions opened.
- [ ] Track feedback submitted.
- [ ] Create a Stage 0 funnel report.

---

## 🟧 P1 Stage 0 backlog — metric drivers

### Empty states

- [ ] Empty map explains what will appear.
- [ ] Empty Saved screen includes a Save your first place CTA.
- [ ] Empty Nearby state explains that saved places appear when relevant.
- [ ] Empty states use food examples.

### Source preservation

- [ ] Save source platform.
- [ ] Save source URL.
- [ ] Save creator identity when reliably available.
- [ ] Save caption or summary when legally and technically appropriate.
- [ ] Save thumbnail or preview only when permitted.
- [ ] Make original post reopening reliable.

### Basic place-card hierarchy

Every place card should answer:

1. What is it?
2. Where is it?
3. Why did I save it?
4. What can I do now?

- [ ] Restaurant name is primary.
- [ ] Distance or neighborhood is visible.
- [ ] Source creator or platform is visible.
- [ ] Directions and original video are obvious.
- [ ] Secondary metadata is hidden until expanded.

### Permission timing

- [ ] Do not ask for Always Location before the reminder benefit is understood.
- [ ] Do not ask for notifications before the user understands what notifications will contain.
- [ ] Allow users to continue without permissions.
- [ ] Provide a clear setup path later.
- [ ] Avoid implying reminder delivery is guaranteed.

---

## 🟨 P2 Stage 0 backlog — quality improvements

- [ ] Selected-place state persists across Settings navigation.
- [ ] Map card transitions feel stable.
- [ ] Swipe-to-dismiss behavior is predictable.
- [ ] Light and dark modes have sufficient contrast.
- [ ] Haptics reinforce save success where appropriate.
- [ ] Tutorial video is concise and optional.
- [ ] App Store screenshots tell the full problem → action → payoff story.
- [ ] Review prompt appears only after a successful value moment, not immediately after install.

---

## 🧪 Stage 0 research backlog

### Normal-user usability

- [ ] Observe at least 10 users who did not build the app.
- [ ] Do not teach them during the first attempt.
- [ ] Ask them to explain Nearr in their own words.
- [ ] Ask them to save one real restaurant post.
- [ ] Record completion, confusion, and recovery behavior.
- [ ] Repeat after major onboarding changes.

### Creator evaluation

- [ ] Privately test with 5–10 food creators.
- [ ] Use one of each creator’s own posts.
- [ ] Ask for a 10-minute observed test.
- [ ] Ask what value Nearr could provide their followers.
- [ ] Ask what would make them unwilling to recommend it.
- [ ] Do not ask them to post yet unless the app independently passes the Stage 0 acceptance gate.

---

## ✅ Stage 0 acceptance tests

Stage 0 unlocks only when all of the following are true:

- [ ] 30 downloads reached.
- [ ] WAU and activation metrics meet thresholds.
- [ ] Ten-user comprehension test reaches at least 7/10.
- [ ] Ten-user save test reaches at least 7/10 correct first saves without help.
- [ ] Known-working Instagram, TikTok, and YouTube posts succeed.
- [ ] Ambiguous examples ask rather than silently save the wrong place.
- [ ] Failed saves have usable recovery.
- [ ] Successful saves visibly appear on the map.
- [ ] Production diagnostics and test UI are hidden.
- [ ] App Store listing clearly communicates the food wedge.
- [ ] Stage 0 funnel is measurable.
- [ ] No unresolved severe crash, auth, deletion, or privacy blocker remains.

---

## 🚫 Locked in Stage 0

Do not make major product investments in:

- Social feed
- Public user profiles
- Restaurant ratings
- Taste matching
- Creator dashboards
- Restaurant dashboards
- Collaborative lists
- Generic recommendations
- AI discovery chat
- Group maps
- Visit-photo social layer
- Broad non-food marketing
- Consumer monetization
- Paid acquisition at scale
- Large creator promotion
- Android expansion unless required by a proven distribution opportunity

---

# ⚡ STAGE 1 — RECALL AND PERSONAL LIBRARY

**Unlock condition:** Stage 0 acceptance passed  
**Primary metric:** Reopen and second-save behavior  
**Estimated valuation:** $250K–$750K if usage and retention are real

---

## 🎯 Stage 1 goal

A user with several saves can quickly find, understand, and reuse them.

## 🧭 Product experience

Main feeling:

> “I’m glad I saved this here instead of losing it inside Instagram.”

The app should become useful as a private restaurant library before becoming social.

---

## 📊 Stage 1 required metrics

- Downloads ≥ 75
- WAU ≥ 25
- 3-day retention ≥ 25%
- Average saves per user ≥ 4
- Second-save rate ≥ 25%
- Reopen rate ≥ 40%
- Map success ≥ 95%
- Post-save map focus ≥ 95%
- Original-source reopen is measurable
- At least 10 users have 3+ correct saves
- At least 5 users reopen without a founder prompt

---

## 🟥 P0 Stage 1 backlog

### Saved-place library

- [ ] Dedicated Saved view works as a true library.
- [ ] Search by restaurant name.
- [ ] Sort by newest.
- [ ] Sort by nearest.
- [ ] Show basic city or neighborhood context.
- [ ] Remove or archive with undo.
- [ ] Avoid duplicate saves or merge them clearly.
- [ ] Keep map and list state consistent.

### Source recall

- [ ] Original video or link is prominent.
- [ ] Creator identity is displayed when available.
- [ ] Show why the place was saved:
  - Caption excerpt
  - Dish mentioned
  - User note
  - Creator recommendation
- [ ] Opening the source works after time has passed.
- [ ] Provide graceful fallback if the original post is deleted or unavailable.

### Simple lifecycle states

Start with:

- Saved
- Visited
- Archived

- [ ] State changes are reversible.
- [ ] Visited places remain searchable.
- [ ] Archived places do not clutter the default map.
- [ ] Do not require a rating.

### Reopen experience

- [ ] Reopening Nearr lands on useful personal content.
- [ ] Recent saves are visible.
- [ ] Last selected place does not disappear unexpectedly.
- [ ] The user can move from list → map → details without losing context.

---

## 🟧 P1 Stage 1 backlog

### Lightweight organization

- [ ] Basic filters:
  - Nearby
  - City
  - Cuisine
  - Creator
  - Saved / Visited
- [ ] Optional notes.
- [ ] Optional “what to order” note.
- [ ] Simple collections only if users request grouping repeatedly.
- [ ] Do not build complex folder hierarchies.

### Better place details

The place page should re-spark the desire that caused the save.

- [ ] Strong hero photo / visual.
- [ ] Clear hours.
- [ ] Open/closed state and closing time when available.
- [ ] Distance and travel context.
- [ ] Category / useful place metadata without clutter.
- [ ] Grounded AI “why you saved this” note.
- [ ] Original video thumbnail / obvious reopen action.
- [ ] Source creator.
- [ ] User note.
- [ ] Directions as the primary action when appropriate.
- [ ] Visited action.
- [ ] “Not yet” preserves intent without feeling like rejection.
- [ ] After “I went,” test one lightweight feedback signal such as thumbs up / thumbs down.
- [ ] Nearby-reminder entry should use this normal place-detail hierarchy rather than a separate crowded utility screen.

### Feedback and trust

- [ ] Report wrong restaurant.
- [ ] Report closed place.
- [ ] Report missing source.
- [ ] Preserve enough diagnostics to investigate failures.
- [ ] Ask for reviews only after repeated successful saves or actions.

---

## 🟨 P2 Stage 1 backlog

- [ ] Basic monthly recap:
  - Places saved
  - Creators saved from
  - Cities or neighborhoods
- [ ] Share a single saved place through a normal link.
- [ ] Improve App Store previews using real value moments.
- [ ] Improve the map’s visual reward as saves accumulate.

---

## 📣 Stage 1 marketing unlock

Allowed:

- Personalized outreach to creators
- Controlled creator evaluation
- A small number of creator promotion tests
- Small UGC batches
- Founder-led organic content
- Local or campus testing
- Basic landing-page experiments

Required measurement:

- Source or campaign
- Install
- Sign-in
- First-save attempt
- Correct first save
- Second save
- Day-3 reopen

Do not scale based on views or installs alone.

---

## ✅ Stage 1 acceptance tests

- [ ] Users can find a saved place without remembering its exact name.
- [ ] Users understand why they saved a place months later.
- [ ] Original source remains accessible or fails gracefully.
- [ ] At least 25% of one-save users complete a second save.
- [ ] Reopen behavior meets the threshold.
- [ ] Library usage is measurable.
- [ ] No major duplicate, missing-save, or state-sync issue remains.

---

## 🚫 Locked in Stage 1

- Social feed
- Public user profiles
- Full creator dashboards
- Restaurant monetization
- Pairwise rankings
- Taste profiles
- Heavy recommendation investment
- Broad category expansion
- Paid acquisition at scale

---

# 🚀 STAGE 2 — MULTIMODAL VIDEO-TO-PLACE DETECTIVE + EFFORTLESS CAPTURE

**Unlock condition:** Stage 1 acceptance passed, except reliability work required to protect Stage 0 may be pulled forward  
**Primary metric:** Correct share-driven place resolution and repeat detective use  
**Estimated valuation:** $750K–$3M if video-to-place behavior is repeatable and users keep the result

---

## 🎯 Stage 2 goal

Nearr becomes the fastest way to turn a social video into a real-world place, including difficult posts where the location is not obvious.

The user should begin thinking:

> **“If I cannot figure out where a video is, I send it to Nearr.”**

and:

> **“If the place is obvious, sharing it to Nearr is still faster than manually saving it elsewhere.”**

## 🧭 Product experience

Easy video:

> “Nearr instantly knew the place and saved it.”

Hard video:

> “Nearr looked through the clues and gave me the best leads.”

The detective experience may be fun and visual, but it must reflect real processing rather than fake progress theater.

---

## 📊 Stage 2 required metrics

Keep the existing capture metrics and add detective-specific metrics.

### Capture

- Downloads ≥ 200
- WAU ≥ 75
- Share saves ≥ 50% of saves
- Save success ≥ 80%
- Strong-evidence save time ≤ 5 seconds where technically achievable
- Average saves per user ≥ 5
- Wrong confident saves ≤ 10–15%
- Manual recovery completion is measured
- Second-week saving behavior is growing

### Detective

After baseline measurement, establish explicit gates for:

- Top-1 exact-place accuracy
- Top-3 contains-correct-place accuracy
- Wrong confident detective answer rate
- No-answer rate
- Candidate-selection completion
- Median / P95 detective latency
- Cost per detective run
- One-retry recovery rate
- Save-after-detect rate
- Second detective submission rate
- 3+ detective submission rate
- Result-share rate

The most important behavioral metric is **repeat detective submission without founder prompting**.

---

## 🟥 P0 Stage 2 backlog

### Cross-platform ingestion

Support should mean the complete pipeline works, not merely URL recognition.

- [ ] Instagram public video/reel path reliable.
- [ ] TikTok public video path reliable.
- [ ] YouTube Shorts path reliable.
- [ ] Facebook Reels path reliable.
- [ ] Snapchat public-share path reliable where technically possible.
- [ ] Preserve paste-link fallback.
- [ ] Platform adapters feed one platform-neutral media/evidence interface.
- [ ] Avoid scattering platform-specific logic through the resolver.
- [ ] No login-cookie/private-content bypass product requirement.
- [ ] Graceful unsupported/private/deleted/challenge fallback.

### Native share hardening

- [ ] Share extension works when app is not running.
- [ ] Share extension handles expired authentication.
- [ ] Share extension handles duplicate taps.
- [ ] Share extension dismisses quickly after durable acceptance.
- [ ] Long-running detective work continues asynchronously.
- [ ] Completion is not lost when app is backgrounded.
- [ ] Queue item always opens the appropriate result/help state.

### Detective benchmark

Maintain a versioned gold set containing:

- [ ] Clear explicit place-name posts
- [ ] Caption-only names
- [ ] Audio-only names
- [ ] OCR/storefront names
- [ ] Menu-only clues
- [ ] Address/phone/website clues
- [ ] Comments-only clues
- [ ] Creator-location hints
- [ ] Landmark/geography clues
- [ ] Multiple restaurants / places
- [ ] Restaurant roundups
- [ ] Chain ambiguity
- [ ] Wrong or misleading location tags
- [ ] Generic captions
- [ ] No usable place
- [ ] Closed or renamed places
- [ ] Instagram examples
- [ ] TikTok examples
- [ ] YouTube Shorts examples
- [ ] Facebook Reels examples
- [ ] Snapchat examples where supported
- [ ] Non-food public places for detector generality

For each benchmark run, record:

- Correct exact place
- Correct address / branch
- Correct place in top 3
- Candidate set quality
- Evidence used
- Evidence dropped
- Processing stages
- Time
- Cost
- Retry behavior
- Recovery behavior

### Evidence extraction

- [ ] Caption / description first.
- [ ] Platform location/business tag when available.
- [ ] Transcript/audio.
- [ ] OCR across selected frames.
- [ ] Storefront signs.
- [ ] Menu text.
- [ ] Street names / addresses / phone numbers / domains.
- [ ] Landmarks / visual geography.
- [ ] Creator public context when relevant.
- [ ] Comments, creator replies, and liked comments when compliant and accessible.
- [ ] Keep evidence provenance so the finalizer can explain why a candidate exists.

### Candidate retrieval and verification

- [ ] Convert evidence into grounded search hypotheses.
- [ ] Retrieve real places rather than asking the LLM to invent a location.
- [ ] Search by explicit name before vague geography.
- [ ] Use city/neighborhood constraints only when evidence supports them.
- [ ] Compare candidate address/category/name against evidence.
- [ ] Verify candidate imagery/menu/storefront where available and worth the cost.
- [ ] Deduplicate duplicate Google place representations where safe.
- [ ] Preserve truly distinct branches.
- [ ] Show ranked leads for genuine ambiguity.

### Retry policy

Add **one bounded automatic retry** when the first run produces no usable candidate and there is no permanent reason to stop.

Retry the cheapest failed stage first:

- [ ] Provider lookup failure → retry provider lookup.
- [ ] Empty/malformed LLM structure → retry structure step.
- [ ] Media evidence exists but resolution returns nothing → rerun resolution on existing evidence first.
- [ ] Only redownload/reprocess media if evidence itself is missing/incomplete.
- [ ] Do not retry private/deleted/unsupported/permanent failures blindly.
- [ ] Record retry reason and retry outcome.
- [ ] Never create an unbounded retry loop.

### Reliability under load

- [ ] Same gold set produces materially equivalent results serially and under bursts.
- [ ] Queue depth may increase latency, not materially reduce accuracy.
- [ ] Accepted jobs never disappear.
- [ ] Existing candidates survive later provider/media failure.
- [ ] Idempotent finalization.
- [ ] Durable leases / recovery.
- [ ] Measure concurrency 1/2/4.
- [ ] Measure multi-worker behavior before scaling replicas.
- [ ] Track provider-specific failures.
- [ ] Track timeout stage.
- [ ] Track shared-state contamination / cross-job leakage.
- [ ] Measure CPU/RAM/disk/subprocess pressure.

### Detective UI

- [ ] Entry screen explains “find a place from a video” in one sentence.
- [ ] Easy saves bypass unnecessary detective theater.
- [ ] Hard investigations show real clue categories found/being checked.
- [ ] Candidate results explain the strongest evidence in consumer language.
- [ ] Avoid raw confidence engineering language.
- [ ] Show top matches with useful photos/location/category.
- [ ] Allow quick selection.
- [ ] Allow “none of these.”
- [ ] Successful result transitions directly into normal Nearr place experience.
- [ ] “Case closed” / celebratory language may be tested, but do not make the app childish.

---

## 🟧 P1 Stage 2 backlog

### Cost-aware escalation

- [ ] Metadata-first fast path.
- [ ] Only download video when easier evidence is insufficient or enrichment is valuable.
- [ ] Only run OCR on selected frames.
- [ ] Only escalate to additional model/provider passes when uncertainty remains.
- [ ] Cache place/provider results where safe.
- [ ] Avoid repeating expensive work.
- [ ] Track cost per stage.

### Comments as a clue source

- [ ] Test whether top comments materially improve top-1/top-3 accuracy.
- [ ] Prioritize creator replies and highly liked comments.
- [ ] Detect explicit “this is X” / “where is this?” answer patterns.
- [ ] Preserve comment evidence separately from creator/caption evidence.
- [ ] Require confirmation when comments are the only strong identity evidence.

### User corrections as training / ranking data

- [ ] Record candidate rejection.
- [ ] Record manual replacement.
- [ ] Record chain-location correction.
- [ ] Record multi-place selection.
- [ ] Record “none of these.”
- [ ] Aggregate corrections to improve retrieval/ranking.
- [ ] Do not expose personal user data in public analytics.

### Import and migration experiments

Only if user demand appears:

- [ ] Import a small list from Google Maps or CSV.
- [ ] Import existing copied links.
- [ ] Batch-process a limited saved-post export when technically possible.
- [ ] Do not build a giant migration system without demand.

---

## 🟨 P2 Stage 2 backlog

- [ ] Better “add Nearr to favorites” education.
- [ ] Share-extension visual polish.
- [ ] Background completion notification.
- [ ] Detective result-share card.
- [ ] Save receipts / lightweight confirmation history.
- [ ] Platform-specific tutorial clips.
- [ ] Optional expanded “how we found it” evidence after the user already has the answer.

---

## 💸 Stage 2 monetization research

Allowed only as a test after repeat Detective usage exists:

- [ ] Ask what users would expect to pay for a hard location solve.
- [ ] Measure deep-run marginal cost.
- [ ] Test credits before subscription if usage is episodic.
- [ ] Keep first magic result free.
- [ ] Never paywall the ordinary save/map/reminder loop at this stage.

Do not turn on a consumer paywall just because the feature is expensive to build.

---

## 📣 Stage 2 marketing unlock

Allowed:

- Repeated UGC concept tests
- “Impossible video” detective challenges
- More creator promotion experiments
- Local geographic concentration
- Small paid creative tests
- Founder-content cadence
- Referral links for attribution

Scale only when creatives repeatedly produce:

- Correct first results
- Additional saves or detective submissions
- Retention
- Acceptable acquisition cost

A viral “wow” video with no repeat product use does not unlock scale.

---

## ✅ Stage 2 acceptance tests

- [ ] Share is a dominant capture method.
- [ ] Easy posts resolve quickly.
- [ ] Hard posts use additional evidence rather than immediately failing.
- [ ] Correct place is frequently present in a useful short list when exact certainty is impossible.
- [ ] Wrong confident answers are rare enough to preserve trust.
- [ ] No-evidence posts recover honestly.
- [ ] One-time automatic retry measurably recovers transient misses or is removed if it does not.
- [ ] Benchmark accuracy does not materially degrade under bursts.
- [ ] Save failures are categorized and measurable.
- [ ] Users submit additional detective videos without founder prompting.
- [ ] Detective results lead to saves, not merely curiosity.
- [ ] Marketing traffic does not materially reduce result quality.

---

## 🚫 Locked in Stage 2

- Social feed
- Public user profiles
- Full creator dashboard
- Restaurant dashboard
- Paid acquisition at scale
- Generic AI discovery chat
- Universal “we can find any place” marketing claim
- Aggressive consumer subscription

# 🔔 STAGE 3 — RETENTION AND RESURFACING

**Unlock condition:** Stage 2 acceptance passed  
**Primary metric:** Useful return behavior  
**Estimated valuation:** $2M–$5M if users return without prompting from the founder

---

## 🎯 Stage 3 goal

Nearr brings saved intent back at the right moment and closes the loop after a visit.

## 🧭 Product experience

Main feeling:

> “Nearr reminded me about something I actually wanted to do.”

---

## 📊 Stage 3 required metrics

- Downloads ≥ 500
- WAU ≥ 150
- WAU / downloads ≥ 30%
- 3-day retention ≥ 35%
- 7-day retention ≥ 20%
- Non-share opens ≥ 30%
- Action rate ≥ 10–15%
- Notification CTR ≥ 15%
- Notification disable rate is monitored
- At least one meaningful resurfacing loop is proven

---

## 🟥 P0 Stage 3 backlog

### Nearby reminders

- [ ] Real-device background behavior is reliable enough to promise.
- [ ] Reminder radius is configurable.
- [ ] Reminder frequency is controlled.
- [ ] Repeated reminders for the same place are suppressed.
- [ ] Closed restaurants are filtered when practical.
- [ ] Notification includes why the user saved the place.
- [ ] Notification opens a useful action screen.
- [ ] Users can snooze or disable reminder types.
- [ ] Reminder copy avoids guaranteed-delivery claims.

Example:

> You saved HiroNori from @creator’s spicy tuna video. It’s nearby and open.

### Weekly resurfacing

- [ ] Weekly summary is useful, not generic.
- [ ] Surface a small number of relevant saved places.
- [ ] Consider:
  - Nearby this weekend
  - Open now
  - Saved a while ago
  - Recently added
- [ ] Allow easy opt-out.
- [ ] Measure open and downstream action.

### Completion loop

The nearby reminder should re-spark desire before asking for data.

When a user opens a nearby reminder, prioritize:

1. Strong photo / visual
2. Place name and distance
3. Open/closed state and useful hours
4. “Why you saved this” AI/source context
5. Original video
6. Directions
7. Visit reporting

Do not lead with reminder configuration.

- [ ] Nearby notification includes why the user saved the place when possible.
- [ ] Nearby notification avoids interruptive/spammy frequency.
- [ ] Nearby tap opens a normal attractive place-detail experience with nearby context.
- [ ] Original video is prominent.
- [ ] Open/closed state is visible when trustworthy.
- [ ] Directions remain the primary pre-visit action.
- [ ] Ask “Been here already?” or similar when the user has not yet shown intent to travel.
- [ ] After directions / likely arrival / later reopen, test “Did you make it?”
- [ ] Options should remain lightweight:
  - I went
  - Not yet
- [ ] After “I went,” optionally ask one simple value signal:
  - thumbs up
  - thumbs down
- [ ] Do not require a written or public review.
- [ ] Mark visited.
- [ ] Preserve visit timestamp.
- [ ] Allow correction.
- [ ] Use visit feedback to reduce irrelevant reminders.
- [ ] Visited state should give the user a personal benefit such as cleaner reminders/history, not merely collect data for Nearr.

### Action instrumentation

- [ ] Track notification sent.
- [ ] Track notification opened.
- [ ] Track place detail opened.
- [ ] Track original source reopened.
- [ ] Track directions opened.
- [ ] Track reservation or order opened if available.
- [ ] Track marked visited.
- [ ] Track reminder disabled.

---

## 🟧 P1 Stage 3 backlog

### Contextual resurfacing

Test one at a time:

- [ ] Weekend planning
- [ ] Entering a saved city
- [ ] Revisiting a neighborhood
- [ ] Saved a long time ago
- [ ] Multiple saved places nearby
- [ ] Open-now opportunity

### Personal progress

- [ ] Saved vs. visited count.
- [ ] Places finally visited.
- [ ] Time between save and visit.
- [ ] Monthly recap.
- [ ] Avoid artificial streaks.

### Notification preference center

- [ ] Nearby reminders.
- [ ] Weekly summary.
- [ ] Delayed-save completion.
- [ ] Radius.
- [ ] Frequency.
- [ ] Quiet hours.

---

## 🟨 P2 Stage 3 backlog

- [ ] Optional visit photo.
- [ ] Optional favorite dish.
- [ ] Personal “worth returning” marker.
- [ ] Revisit reminder only if users request it.

---

## 📣 Stage 3 marketing unlock

Allowed:

- Larger creator tests
- Repeatable UGC engine
- Local launch campaigns
- Partnerships with food communities
- Controlled paid acquisition
- Retargeting based on privacy-safe campaign attribution

Marketing claims may now show the full loop:

> See it → save it → remember it nearby → go.

---

## ✅ Stage 3 acceptance tests

- [ ] Nearby reminders work on real devices.
- [ ] Notification CTR meets threshold.
- [ ] Notifications create directions, source reopens, or visits.
- [ ] Users do not broadly disable reminders due to spam.
- [ ] Non-share reopen behavior grows.
- [ ] Visit state improves organization and reminder quality.

---

## 🚫 Locked in Stage 3

- Broad social feed
- Public user profiles
- Heavy creator dashboard
- Restaurant dashboard
- Generic AI recommendations
- Broad non-food expansion

---

# 🧭 STAGE 4 — DECISION LAYER

**Unlock condition:** Stage 3 acceptance passed  
**Primary metric:** Weekly Active Deciders  
**Estimated valuation:** $5M–$12M if decisions and actions are real

---

## 🎯 Stage 4 goal

Nearr helps users decide where to go, not merely remember what they saved.

## 🧭 Product experience

Main feeling:

> “When I need somewhere to eat, I check Nearr.”

---

## 📊 Stage 4 required metrics

- Downloads ≥ 2,000
- WAU ≥ 500
- Sessions per active user ≥ 2 per week
- Non-share sessions ≥ 40%
- Direction or action rate ≥ 15%
- Weekly Active Deciders tracked and growing
- Saved-library search and filtering are meaningfully used
- Decision sessions produce selected places

---

## 🟥 P0 Stage 4 backlog

### “Where should I go?” experience

- [ ] Nearby saved restaurants.
- [ ] Open now.
- [ ] Distance or travel time.
- [ ] Cuisine.
- [ ] Visited vs. unvisited.
- [ ] Source creator.
- [ ] Clear shortlist.
- [ ] One-tap directions.

### Decision ranking

Rank only the user’s saved intent first.

Possible factors:

- Distance
- Open status
- Save recency
- Unvisited status
- Repeated source engagement
- User preferences inferred from actions
- Reservation availability where available

Do not pretend the ranking is universally best.

### Lightweight planning and sharing

- [ ] Share one place.
- [ ] Share a shortlist.
- [ ] Recipient can view without immediate sign-up.
- [ ] Optional “Which one?” voting experiment.
- [ ] Avoid building a full social network.

### Action integrations

Test based on demand:

- [ ] Directions
- [ ] Reservation link
- [ ] Order link
- [ ] Website
- [ ] Call
- [ ] Calendar plan

---

## 🟧 P1 Stage 4 backlog

- [ ] Weekend planning screen.
- [ ] “Saved near this destination.”
- [ ] Trip shortlist from personal saves.
- [ ] Contextual open-now recommendations from saved places.
- [ ] Better decision explanations:
  - You saved this recently
  - Three saved places are nearby
  - Open for another hour

---

## 🟨 P2 Stage 4 backlog

- [ ] Collaborative shortlist experiment.
- [ ] Simple voting.
- [ ] Calendar integration.
- [ ] Reservation availability alerts if a partner or reliable source exists.

---

## NORTH STAR

**WAD — Weekly Active Deciders**

A Weekly Active Decider performs at least one meaningful decision action:

- Opens directions
- Starts navigation
- Selects a place from a shortlist
- Opens a reservation or ordering path
- Marks visited after a decision session

---

## ✅ Stage 4 acceptance tests

- [ ] Users open Nearr specifically to choose somewhere.
- [ ] Decision screens increase actions.
- [ ] Ranking is useful without requiring a social graph.
- [ ] Sharing produces meaningful recipient engagement.
- [ ] WAD grows with WAU.

---

## 🚫 Locked in Stage 4

- Social feed
- Public user profiles as a major investment
- Restaurant monetization without inbound demand
- Broad editorial content operation
- Generic place recommendation engine

---

# 🧑‍🍳 STAGE 5 — FOOD WEDGE DOMINATION AND CREATOR DISTRIBUTION

**Unlock condition:** Stage 4 acceptance passed  
**Primary metric:** Creator-sourced activated users and food-save dominance  
**Estimated valuation:** $10M–$25M if Nearr becomes associated with food-content saving

---

## 🎯 Stage 5 goal

Nearr becomes the default save action for food content in a concentrated market.

## 🧭 Product experience

Main feeling:

> “When I see a restaurant video, I save it to Nearr.”

---

## 📊 Stage 5 required metrics

- Downloads ≥ 10,000
- WAU ≥ 2,000
- Food remains the majority of saves
- At least 1,000 users have 3+ food saves
- Creator-sourced activation is measurable
- At least 25 creators have completed a real product test
- At least 10 creators have shared Nearr or a Nearr-powered map
- At least 3 creators repeatedly drive activated users
- Creator-driven users retain at an acceptable rate

---

## 🟥 P0 Stage 5 backlog

### Creator identity and attribution foundation

- [ ] Reliable creator identity where available.
- [ ] Source post attached to place.
- [ ] Creator → post → place → save event chain.
- [ ] Campaign attribution.
- [ ] Directions and action attribution.
- [ ] Privacy-safe aggregation.
- [ ] Clear rules for deleted or changed posts.

### Public creator pages

A creator page may include:

- [ ] Creator identity
- [ ] Restaurants featured
- [ ] Original posts
- [ ] Public map
- [ ] Recent recommendations
- [ ] Most-saved recommendations
- [ ] Save to Nearr CTA
- [ ] Shareable link

Creator pages should be useful to nonusers.

### Creator collections

- [ ] Automatically group a user’s saves by creator.
- [ ] Let users browse all saved places from a creator.
- [ ] Preserve source context.
- [ ] Avoid implying official creator affiliation without permission.

### Creator analytics lite

Only after creators repeatedly ask for it.

Possible initial metrics:

- [ ] Saves
- [ ] Unique savers
- [ ] Directions taps
- [ ] Top posts
- [ ] Top restaurants
- [ ] Geographic interest

Do not claim visits without sufficient evidence.

---

## 🟧 P1 Stage 5 backlog

### Shareable intent objects

- [ ] Creator map.
- [ ] Restaurant card showing source creator.
- [ ] “Saved from this creator” collection.
- [ ] Campaign-specific save page.
- [ ] Simple embed or bio link.

### Food-specific library polish

- [ ] Cuisine filters.
- [ ] Dish context.
- [ ] Restaurant-specific detail.
- [ ] “Been meaning to try.”
- [ ] Neighborhood and city groupings.
- [ ] Best saved spots nearby.

### Growth system

- [ ] Personalized creator outreach workflow.
- [ ] UGC brief library.
- [ ] Creative testing taxonomy.
- [ ] Creator onboarding materials.
- [ ] Campaign attribution dashboard.
- [ ] Cost per activated retained user.

---

## 🟨 P2 Stage 5 backlog

- [ ] Creator verification.
- [ ] Creator-owned edits to public maps.
- [ ] Permissioned creator media kit.
- [ ] Restaurant collaboration experiments.
- [ ] Public trend pages only if data density is meaningful.

---

## ✅ Stage 5 acceptance tests

- [ ] Users naturally say “save it to Nearr.”
- [ ] Creator pages generate saves or installs.
- [ ] At least several creators repeatedly drive activated users.
- [ ] Creator analytics answer a real recurring question.
- [ ] Food retention remains strong as growth increases.

---

## 🚫 Locked in Stage 5

- Broad social feed
- Full restaurant ad marketplace
- Complex enterprise dashboard
- Non-food expansion that weakens food retention
- Vanity creator metrics without action data

---

# 🧑‍🤝‍🧑 STAGE 6 — USEFUL SOCIAL LAYER

**Unlock condition:** Stage 5 acceptance passed  
**Primary metric:** Saves and decisions caused by trusted people  
**Estimated valuation:** $25M–$75M if social behavior produces real action

---

## 🎯 Stage 6 goal

People and creators help one another make better real-world decisions.

## 🧭 Product experience

Main feeling:

> “People I trust help me find places I actually want to visit.”

Social must improve saving or deciding.

It must not exist merely to imitate Corner or Beli.

---

## 📊 Stage 6 required metrics

- Downloads ≥ 50,000
- WAU ≥ 10,000
- At least 25% of active users follow a creator or person
- Social viewing ≥ 30%
- Shared maps and pages drive saves
- Socially sourced saves create actions
- Collaborative features show repeat usage

---

## 🟥 P0 Stage 6 backlog

### Following

Start with:

- Creators
- Friends by direct invitation
- Curated public profiles

Do not immediately build broad follower mechanics.

- [ ] Follow creator.
- [ ] View creator map.
- [ ] Save a creator-recommended place.
- [ ] Measure saves and actions caused by follows.

### Shared maps and collections

- [ ] Public creator maps.
- [ ] Private shared lists.
- [ ] Group trip or dinner shortlist.
- [ ] Simple roles and permissions.
- [ ] Link viewing without forced sign-up.

### Social proof

- [ ] Friend saved this.
- [ ] Creator featured this.
- [ ] People you follow saved this.
- [ ] Keep individual saves private by default.
- [ ] Avoid fake popularity counts.

---

## 🟧 P1 Stage 6 backlog

- [ ] Collaborative editing.
- [ ] Friend recommendations.
- [ ] Useful activity summaries.
- [ ] Optional profile with public collections.
- [ ] Mutual place overlap.
- [ ] Group decision flow.

---

## 🟨 P2 Stage 6 backlog

A feed may be tested only if:

- Profiles and maps already generate repeat behavior.
- Enough activity exists to avoid emptiness.
- Feed views cause saves or decisions.
- Feed investment does not weaken the core capture loop.

Possible feed scope:

- New creator places
- Friend visits
- Shared map updates
- No generic entertainment feed

---

## ✅ Stage 6 acceptance tests

- [ ] Following creates saves.
- [ ] Shared maps create decisions.
- [ ] Social features retain users rather than merely increasing screen time.
- [ ] Privacy defaults are understood.
- [ ] Social activity does not make the app confusing for private users.

---

## 🚫 Locked in Stage 6

- Entertainment-first feed
- Vanity follower races
- Forced invites
- Public-by-default personal saves
- Social features with no connection to save or action behavior

---

# 🧠 STAGE 7 — INTELLIGENCE, ATTRIBUTION, AND BUSINESS VALUE

**Unlock condition:** Stage 6 acceptance passed  
**Primary metric:** Recommendations and attribution that cause measurable action  
**Estimated valuation:** $75M–$250M+ if data creates repeatable business value

---

## 🎯 Stage 7 goal

Nearr predicts relevant actions and proves how content creates local demand.

## 🧭 Product experience

Consumer feeling:

> “Nearr understands what I might actually want to do.”

Creator and business feeling:

> “Nearr shows what content creates real intent.”

---

## 📊 Stage 7 required metrics

- Downloads ≥ 200,000
- WAU ≥ 50,000
- Recommendation CTR ≥ 20%
- Action rate ≥ 15%
- Creator attribution is repeatedly used
- Business or restaurant interest is inbound or repeatable
- Attributed campaigns produce measurable outcomes
- Data quality is sufficient for trustworthy reporting

---

## 🟥 P0 Stage 7 backlog

### Intent graph

Maintain the chain:

- Source platform
- Creator
- Source post
- Extracted place
- Confidence
- User confirmation
- Save
- Resurfacing
- Source reopen
- Directions
- Reservation or order
- Visit evidence

### Personalized decision intelligence

- [ ] Rank saved places by current context.
- [ ] Explain why a place is recommended.
- [ ] Avoid black-box claims.
- [ ] Let users correct preferences.
- [ ] Use private behavior responsibly.
- [ ] Measure downstream action, not clicks alone.

### Creator analytics

- [ ] Save attribution.
- [ ] Action attribution.
- [ ] Geographic demand.
- [ ] Post comparison.
- [ ] Trend over time.
- [ ] Privacy thresholds.
- [ ] Export or reporting only if creators need it.

### Restaurant and business tools

Only after inbound demand:

- [ ] Demand reports.
- [ ] Creator campaign attribution.
- [ ] Post-to-save analytics.
- [ ] Save-to-directions analytics.
- [ ] Campaign comparison.
- [ ] Promoted intent surfaces with clear labels.
- [ ] Reservation or ordering attribution.

---

## 🟧 P1 Stage 7 backlog

- [ ] Recommendation quality experiments.
- [ ] Contextual “go now” suggestions.
- [ ] Restaurant trend detection.
- [ ] Creator-audience fit.
- [ ] Campaign matching.
- [ ] Privacy-safe aggregate benchmarks.

---

## ✅ Stage 7 acceptance tests

- [ ] Recommendations create actions.
- [ ] Attribution reports are trusted by creators.
- [ ] Businesses repeatedly use or pay for insights.
- [ ] Monetization does not degrade consumer trust.
- [ ] Promoted content is clearly labeled.
- [ ] Claims remain proportional to evidence.

---

# 🌐 STAGE 8 — CATEGORY EXPANSION PRODUCTIZATION

**Unlock condition:** Food/initial wedge remains strong and new-category detector usage shows repeat behavior  
**Primary metric:** New categories retain and create real-world actions without weakening the core loop  
**Strategic status:** Long-term productization option; detector may technically support broader places earlier

---

## 🎯 Stage 8 goal

Turn earlier category-neutral detection capability into intentionally designed category experiences.

Detective Mode may identify non-food public places well before Stage 8.

Stage 8 is about **marketing and productizing** those categories, not merely proving the backend can return them.

## Expansion sequence

### Stage 8A — Category validation

For each proposed category, prove:

- repeated source-content behavior
- repeated detective/save behavior
- clear real-world action
- acceptable resolution accuracy
- a retention reason

Potential categories:

- Hotels
- Hikes
- Beaches
- Attractions
- Shops
- Gyms
- Events
- Services

### Stage 8B — Category-aware product experience

Different categories may need different:

- Metadata
- Details
- Actions
- Reminder timing
- Decision factors
- Visit states
- Source context

Examples:

- Restaurant → hours, cuisine, reservation/order
- Hike → trailhead, difficulty, daylight/weather/safety context
- Hotel → dates, booking
- Attraction → opening hours/tickets

Do not force every place into restaurant UX.

### Stage 8C — Category-specific acquisition

Only expand marketing into a category after its retention/action behavior is proven.

### Stage 8D — Creator vertical expansion

Explicitly postponed until the underlying place system and category behavior are proven.

Do not expand creator verticals merely because the database supports them.

# 📈 CORE METRIC PROGRESSION

- Stage 0: Correct first saves + core reliability
- Stage 1: Recall and second saves
- Stage 2: Video-to-place accuracy + repeat detective submissions + effortless share capture
- Stage 3: Retention, resurfacing, and completed visits
- Stage 4: Weekly Active Deciders
- Stage 5: Creator-sourced wedge growth
- Stage 6: Socially caused saves and decisions
- Stage 7: Attribution and business value
- Stage 8: Category expansion without dilution

# 📊 REQUIRED ANALYTICS BACKLOG

## Stage 0 minimum events

- onboarding_started
- onboarding_completed
- auth_started
- auth_completed
- save_entry_opened
- save_attempt_started
- extraction_completed
- confirmation_shown
- candidate_selected
- manual_recovery_started
- save_completed
- save_failed
- map_focus_completed
- source_opened
- directions_opened
- feedback_submitted
- queue_item_opened
- queue_item_open_failed

## Stage 1 additions

- saved_library_opened
- saved_search_used
- saved_filter_used
- place_reopened
- ai_note_viewed
- hours_viewed
- note_added
- place_archived
- place_marked_visited
- visit_sentiment_submitted
- second_save_completed

## Stage 2 additions

### Capture / pipeline

- share_extension_opened
- share_extension_completed
- extraction_phase_timing
- media_fallback_started
- media_download_completed
- frame_extraction_completed
- transcript_completed
- ocr_completed
- retry_triggered
- retry_stage
- retry_outcome
- delayed_save_completed
- candidate_rejected
- manual_correction_completed

### Detective

- detective_started
- detective_easy_path_completed
- detective_deep_path_started
- detective_clue_found
- detective_comment_evidence_used
- detective_candidate_set_created
- detective_top1_selected
- detective_non_top1_selected
- detective_none_selected
- detective_completed
- detective_failed
- detective_result_saved
- detective_result_shared
- detective_second_submission
- detective_third_submission

### Reliability / cost

- queue_wait_ms
- media_processing_ms
- provider_failure
- provider_rate_limited
- finalizer_outcome
- serial_burst_test_run
- cost_estimate_per_share
- cost_estimate_per_deep_detective

## Stage 3 additions

- reminder_scheduled
- reminder_sent
- reminder_opened
- reminder_snoozed
- reminder_disabled
- weekly_summary_sent
- weekly_summary_opened
- visit_prompt_shown
- visit_response
- visit_sentiment_response

## Stage 4 additions

- decision_screen_opened
- shortlist_created
- shortlist_shared
- place_selected
- reservation_opened
- order_opened
- weekly_active_decider

## Stage 5+ additions

- creator_page_viewed
- creator_followed
- creator_place_saved
- creator_attributed_install
- creator_attributed_activation
- creator_attributed_action
- shared_map_viewed
- shared_map_save
- campaign_attributed_action

# 📣 MARKETING GATE SYSTEM

## Stage 0 — Research, not scale

Allowed:

- Personalized outreach
- Private creator evaluations
- Founder-led product demonstrations
- User interviews
- Small unpaid organic posts
- App Store conversion improvements
- Small Detective Mode concept tests after core P0 reliability is acceptable

Not allowed:

- Large paid UGC volume
- Major creator launch
- Broad press
- Paid acquisition at scale
- “Official launch” language
- Claiming Nearr can find any place from any video

## Stage 1 — Controlled growth experiments

Allowed:

- Small UGC batches
- Several creator promotion tests
- Campus or local community launch
- Landing-page and App Store creative tests
- Side-by-side testing of “save places” positioning vs “find the place in any video” positioning

Success metric:

> Cost or effort per activated user who completes another meaningful action.

## Stage 2 — Repeatable acquisition search

Allowed:

- Larger creative testing matrix
- “Impossible video” detective challenges
- Multiple creators
- Small paid tests
- Geographic concentration
- Referral and creator attribution links

Scale only after repeated retention / repeat detective usage.

Do not scale because a detective video gets views.

## Stage 3 — Full-loop marketing

Marketing may demonstrate:

> Mystery video → Nearr finds it → save → reminder → original video → go → mark visited

The campaign must prove the payoff, not only the extraction trick.

## Stage 4 — Decision utility marketing

Market Nearr as a tool for choosing from places the user already wants.

## Stage 5 — Creator distribution engine

Creators receive:

- Useful public maps
- Save behavior
- Attribution
- A reason to link Nearr from their profiles

## Stage 6+ — Network and business growth

Social and business growth should amplify existing user action, not manufacture empty engagement.

# 🎥 UGC TESTING FRAMEWORK

Test concepts, not only creators.

## Problem angles

- Saved posts are impossible to search.
- Users forget where restaurants are.
- Creators do not name the place clearly.
- Comment sections contain the answer but finding it is annoying.
- Saved videos do not become plans.
- Users remember a place only after leaving the area.
- “I saw this place in a video and have no idea where it is.”

## Demonstration angles

- Clear post → instant save
- Vague post → Detective Mode
- Caption clue + video clue + comments clue → exact place
- Multiple possible places → ranked short list
- Original video attached to the pin
- Nearby reminder → open/closed + why saved + original video → directions
- “I went” closes the loop

## Presentation styles

- Founder story
- Screen recording
- Challenge
- Friend recommendation
- Day-in-the-life
- Before and after
- Creator demonstration
- Real nearby payoff
- Head-to-head “can it find this?”

## Three priority UGC concepts

### 1. “There’s no way it finds this”

Structure:

1. Start on a public video that does not obviously reveal the place.
2. Say: “This video never tells me where this is. Let’s see if Nearr can find it.”
3. Share to Nearr.
4. Show real clue discovery quickly:
   - caption
   - sign/menu text
   - city clue
   - comment/creator clue if available
5. Reveal the result / top candidates.
6. Verify against the real place.
7. End with a simple line such as:

> “Shazam, but for places.”

Measure product actions, not comments saying “that’s crazy.”

### 2. “My saved videos are a graveyard”

Structure:

1. Show a huge Instagram/TikTok saved collection.
2. “I have hundreds of places saved and no idea where most of them are.”
3. Share several into Nearr.
4. Show map filling up.
5. Later show nearby notification.
6. Open place page:
   - hero image
   - open now / hours
   - why saved
   - original reel
7. Tap directions.
8. Cut to the actual visit.
9. Tap “I went.”

This markets the retention loop, not only Detective Mode.

### 3. “AI location detective challenge”

Structure:

1. Friend chooses 3 difficult public-place videos.
2. Nearr gets one point if the real place is in its top 3.
3. Video 1: explicit-ish clue.
4. Video 2: partial menu/sign/neighborhood clue.
5. Video 3: hard visual/geographic clue.
6. Reveal and verify each answer.
7. Keep failures in the content when useful. Honest misses build trust and teach the product boundary.

## Additional creative hypotheses

- “The comments knew the answer before the caption did.”
- “Can Nearr beat me at finding this restaurant?”
- “I sent it a video with the restaurant name blurred.”
- “Three videos from three different platforms.”
- “I saved this six months ago and Nearr reminded me when I was two miles away.”
- “Nearr found the wrong branch first. Here’s how it corrected itself.”

## UGC success metrics

Do not optimize primarily for:

- Views
- Likes
- Comments
- Installs

Optimize for:

- Correct first-result rate
- Cost per activated user
- Save-after-detect rate
- Second detective submission rate
- Second-save rate
- Day-3 retention
- Day-7 retention
- Original-source reopen
- Directions/action rate
- Visit response

A high-view Detective video with no repeat submissions is marketing entertainment, not product-market evidence.

# 💸 SPEND RULES

Expenses should scale with validated usage, not ambition.

## Stage 0 expected monthly spend

$50–$300

## Stage 1 expected monthly spend

$100–$500

## Stage 2 expected monthly spend

$250–$1,000

## Stage 3 expected monthly spend

$500–$2,500

## Stage 4 expected monthly spend

$1,500–$7,500

## Stage 5 expected monthly spend

$5,000–$20,000

## Stage 6 expected monthly spend

$15,000–$75,000

## Stage 7 expected monthly spend

$50,000+

Spend above the range requires a written explanation of:

- The proven bottleneck
- The expected metric impact
- The experiment duration
- The stopping condition
- The maximum loss

Do not raise money merely to build a longer feature list.

Raise when money accelerates a validated loop.

---

# 🌐 WEBSITE AND PUBLIC WEB GATE

## Quiet production requirements

- Landing page
- App Store link
- Privacy Policy
- Terms of Service
- Support or contact
- Account deletion instructions
- Short FAQ
- Screenshots or short demo video

## Current safe headline

> **Save food spots from social media. Remember them when you’re nearby.**

## Detective headline to test after validation

> **Find any place you see in a video. Then actually go there.**

Alternative:

> **Share a video. We’ll follow the clues and find the place.**

Do not switch the entire brand/website to the detective promise until the benchmark and repeat-use experiment support it.

## Current how it works

1. See a place online
2. Share it to Nearr
3. Nearr finds the place or best leads
4. See it on your map
5. Keep the original source and reason you saved it
6. Get reminded later
7. Check hours / reopen video / get directions
8. Go try it

## Locked until creator and user demand exists

- Full web app
- Restaurant dashboards
- Creator analytics pages
- Public restaurant trend pages
- SEO content farm
- Generic city-guide blog
- Fake testimonials

## Future public-web differentiation

When the data is real, public pages may emphasize:

- Which creator drove saves
- Which posts generated intent
- Geographic demand
- Save-to-directions behavior
- Trend over time
- Detective success examples using permissioned/public-safe media

Do not merely clone generic restaurant popularity pages.

# ⚖️ BUSINESS AND LEGAL GATES

## Required before broad public launch

- Terms of Service
- Privacy Policy
- Support/contact
- Account deletion
- Data review for:
  - Location
  - Notifications
  - Accounts
  - Saved links
  - Source URLs
  - Creator identifiers
  - Diagnostics
  - Feedback
  - Attribution
  - Detective evidence metadata
  - Comments if collected
  - Temporary media processing
- Permission copy that does not guarantee reminders
- Claims that do not guarantee extraction/detective accuracy
- No implication of affiliation with social platforms, creators, or restaurants
- Permission for creator content used in marketing
- Data retention and deletion behavior documented

## Trademark / naming gate

Before major paid marketing or a broad launch:

- [ ] Resolve whether Nearr is a defensible brand to continue using.
- [ ] Do not intentionally rely on waiting for a cease-and-desist as the long-term strategy.
- [ ] Complete a practical clearance process for replacement candidates.
- [ ] Update legal/app-store/website assets coherently if renamed.

## Platform/media-access gate

For each supported social platform:

- [ ] Document what public data/media Nearr accesses.
- [ ] Avoid product requirements that depend on bypassing login/private/challenge controls.
- [ ] Do not promise comments/media access if platform behavior makes it unreliable.
- [ ] Degrade gracefully when the source cannot be retrieved.

## Detective safety gate

Do not design or market Detective Mode as an adversarial deanonymization tool.

Initial supported intent should focus on public destinations and businesses.

Add policies/guardrails for requests involving:

- private residences
- intentionally hidden personal location
- vulnerable people
- stalking/harassment context
- sensitive wildlife areas
- restricted infrastructure
- dangerous/illegal access

## Creator content caution

Public creator videos may be used in marketing only with permission or under a clearly valid licensed use.

Internal testing may use appropriate public examples, but marketing should prefer:

- Founder-created content
- Permissioned creator content
- Licensed demo content
- Generic recreated examples

## Attribution caution

Nearr may accurately claim:

- Save
- Source reopen
- Directions tap
- Reservation click
- User-marked visit

Nearr should not claim a confirmed physical visit unless the evidence supports it.

# 🏢 COMPANY AND COFOUNDER GATE

Form the company before:

- Broad public launch
- Revenue collection
- Partnerships
- Paid marketing at meaningful scale
- Issuing equity
- Raising money

Recommended venture structure:

- Delaware C-Corp if pursuing venture financing
- Appropriate founder stock and IP assignment
- Vesting for all founders
- 83(b) filings when applicable
- Contractor and advisor agreements

## Growth cofounder rule

Do not grant major equity based only on résumé, friendship, or theoretical availability.

Before a major cofounder grant:

- Complete a structured working trial.
- Define ownership of acquisition, activation, retention, brand, and analytics.
- Observe reliability and initiative.
- Confirm long-term commitment.
- Use vesting and a one-year cliff.
- Document decision rights and IP ownership.

---

# 🎯 EARLY SUCCESS DEFINITION

If Nearr cannot reach:

- 50 downloads
- 25 WAU
- 20 users with at least one correct save
- 10 users with at least three correct saves
- 5 users who reopen without being asked
- Several users who naturally share a second post

then Nearr has a product, positioning, or target-user problem.

It does not have a scale problem.

Do not solve this by buying more installs.

---

# 🧾 WEEKLY OPERATING REVIEW

Update this section or maintain it in a linked operating document.

## Core metrics

- Downloads:
- Signed-in users:
- WAU:
- First-save attempts:
- Correct first saves:
- Wrong silent saves:
- Second saves:
- Average saves per user:
- Reopens:
- Directions:
- Reminder opens:
- Visits marked:
- Crashes:
- Top failure reason:

## Detective metrics

- Detective submissions:
- Repeat detective users:
- Users with 3+ detective submissions:
- Top-1 benchmark accuracy:
- Top-3 benchmark accuracy:
- Wrong confident detective results:
- Manual/no-answer rate:
- One-retry recovery rate:
- Median detective latency:
- P95 detective latency:
- Cost per deep detective run:
- Save-after-detect rate:
- Result-share rate:
- Most useful clue source this week:
- Most common evidence-loss point:

## Reliability metrics

- Queue depth peak:
- Queue wait P50/P95:
- Media worker utilization:
- Provider failures by provider:
- Serial vs burst accuracy delta:
- Jobs accepted but lost/disappeared: **must be 0**
- Media failures that clobbered existing candidates: **must be 0**

## User learning

- Most common confusion:
- Most common save failure:
- Most common detective failure:
- Most requested feature:
- Most valuable successful moment:
- Strongest reason users return:
- Strongest reason users leave:
- Did anyone naturally submit another detective video?
- Did anyone naturally show Nearr to someone else?

## Current decisions

- P0 item being solved:
- Metric expected to improve:
- Experiment:
- Success threshold:
- Stop condition:
- Feature explicitly not being built:
- Current biggest constraint:

# 🚨 FINAL RULES

1. Metrics unlock stages.
2. Acceptance tests unlock stages.
3. Deadlines do not unlock stages.
4. Built features do not unlock stages.
5. Competitor features do not unlock stages.
6. Spending does not unlock stages.
7. Creator interest is not distribution until it creates activated users.
8. Installs are not growth if users do not complete correct saves/results.
9. Detective Mode is a hypothesis until users repeatedly submit videos without founder prompting.
10. Do not promise “any place from any video.” Honest top-3 candidates are acceptable for hard cases.
11. Easy explicit saves should remain fast; do not force every video through expensive detective processing.
12. The LLM should reason over evidence and retrieval, not invent places from memory.
13. Preserve evidence provenance so failures can be diagnosed.
14. Pull comments only when technically accessible and compliant; comment-only identity should usually require confirmation.
15. Use at most one bounded automatic retry for transient no-candidate outcomes, and retry the cheapest failed stage first.
16. Queue depth may increase latency; it must not materially reduce accuracy.
17. Accepted jobs must never disappear.
18. Provider degradation must create retry/backpressure/review, not silent wrong saves.
19. Wrong silent saves are worse than asking.
20. Preserve source context as a first-class product object.
21. The place page should answer: what is it, is it open, why did I save it, can I see the original, how do I go?
22. Visit reporting must give the user value, not feel like analytics work for Nearr.
23. Core saving/maps/reminders remain free early.
24. Test paid Detective credits only after repeat demand and marginal cost are understood.
25. Do not build social features before there is useful activity to share.
26. Do not claim visits without evidence.
27. Food remains the initial acquisition wedge unless real usage disproves it; detector architecture may remain category-neutral.
28. Do not turn Nearr into a generic geolocation company if the save → map → reminder → action loop is what creates retention.
29. Do not invest heavily in a knowingly risky brand name without a clearance plan.
30. Avoid sensitive/private-location deanonymization positioning.
31. Make one save or detective solve feel magical before chasing scale.
32. The company-level thesis should be updated by evidence, not founder excitement.

