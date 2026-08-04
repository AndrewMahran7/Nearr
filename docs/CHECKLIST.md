# 🧭 NEARR — VERSION GATE SYSTEM
## Feature ↔ Metric Linked Roadmap and Staged Backlog

**Last updated:** 2026-08-03  
**Current stage:** Stage 0 — Foundation / Quiet Production  
**Current launch mode:** Quiet production release, not broad public launch  
**Current downloads:** 15 / 30 Stage 0 target  
**Current download progress:** 50%

---

# 📍 CURRENT STATUS SNAPSHOT

Nearr is currently proving one narrow behavior:

> **A new user sees a food post, saves it to Nearr, gets the correct place, sees it on the map, and understands why they should use Nearr again.**

## Current Stage 0 progress

| Metric | Target | Current | Status |
|---|---:|---:|---|
| Downloads | 30 | 15 | 50% complete |
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

The current product priority is **not adding breadth**.

The current priority is:

1. Make onboarding understandable enough that a five-year-old can identify the next action.
2. Make the first save reliable.
3. Make uncertainty easy to resolve.
4. Make the saved result feel rewarding.
5. Measure the complete funnel.
6. Privately test with normal users and a small number of creators.
7. Do not broadly market until the Stage 0 acceptance gate is passed.

---

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

Nearr is operating in a validated but competitive market.

Users already:

- Save restaurant posts inside Instagram and TikTok
- Copy restaurants into Google Maps
- Keep restaurant lists in Notes
- Use Beli to track and rank restaurants
- Use Corner and similar apps to discover and organize places
- Send restaurant posts through group chats
- Forget most of what they save

This is positive because the behavior exists.

It is dangerous because:

- “Save a restaurant from social media” is not unique.
- A map of saved places is not unique.
- Nearby reminders are copyable.
- Social profiles and feeds favor competitors with existing activity.
- Restaurant ratings favor companies with years of historical data.

Nearr must not compete through feature count.

Nearr must compete through a complete behavior:

> **Nearr turns messy food content into the correct real-world place, keeps the original recommendation attached, and brings it back when the user can act.**

---

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

Nearr should not position itself as a generic organizer, social network, or AI map.

## Current public positioning

> **Save food spots from social media. See them on your map. Remember them nearby.**

## Stronger product explanation

> **Share a food post to Nearr. Nearr finds the real place, keeps the original video, and helps you remember it later.**

## Internal competitive framing

> **Beli tracks your dining life. Corner helps you discover places. Nearr turns food content into real-world action.**

Avoid investor or technical language in consumer-facing copy:

- Place-intent graph
- Social evidence extraction
- Memory-to-action layer
- Entity resolution
- AI-powered local intent

---

# 🧩 CORE LOOP

1. User sees a place online.
2. User wants to try it.
3. User shares or pastes the post into Nearr.
4. Nearr extracts available evidence.
5. Nearr identifies the place.
6. Nearr asks the user only when confidence is insufficient.
7. The user confirms or searches manually.
8. Nearr saves the place and original source.
9. The map focuses on the new place.
10. The user can reopen the source, see context, or get directions.
11. Nearr resurfaces the place later.
12. The user takes action.
13. Nearr optionally records whether the user visited.

The product should feel like:

> “I saw this restaurant online, Nearr remembered exactly what it was, and now I can actually go.”

---

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

Existing code does not override the stage gates.

## Built or mostly built

### Auth and entry

- Magic-link authentication
- Dev/test login
- Auth callback route
- Pre-auth onboarding
- Sign-in contrast cleanup
- Sign-in back navigation

### Save and extraction

- Save from link/share
- Manual paste flow
- Candidate confirmation
- Source URL storage
- Original post opening
- Save success can route to the map
- Known working Instagram, TikTok, and YouTube examples

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

### Trust and production polish

- In-app feedback
- Legal links
- Review row planned or added
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

---

# 🚫 CURRENT PRODUCT RISKS

## 1. First-save reliability risk

If the first save fails, hangs, saves the wrong restaurant, or does not visibly appear, Nearr loses trust immediately.

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

A restaurant pin without the creator, video, dish, or reason for saving becomes less valuable over time.

## 6. Competition risk

Corner and Beli are stronger in breadth, social proof, and accumulated data.

Nearr must stay narrower and prove a better content-to-action loop.

## 7. Creator distribution risk

Creators may respond positively without testing, sharing, or producing activated users.

## 8. Marketing leakage risk

Paid or creator-driven traffic can hide a broken funnel by producing installs without successful first saves or retention.

## 9. Quiet production risk

A production listing reduces TestFlight friction but makes bad first impressions more permanent.

---

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

# 🧑‍🍳 FOOD-FIRST RULE

Until Stage 5 is unlocked, food should remain the primary:

- App Store positioning
- Screenshot content
- Onboarding example
- Creator outreach wedge
- UGC topic
- Product terminology
- Benchmark dataset
- Growth market

The app may technically save other real-world places.

That does not justify broad positioning.

Food has the strongest combination of:

- Creator supply
- Repeated user intent
- Clear local action
- High visual content volume
- Restaurant and creator attribution potential
- Natural nearby value

---

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

Regular users should remain free during the early stages.

Do not add:

- Consumer subscription for core saving
- Traditional feed ads
- Paywall before first value
- Paid feature gates requiring friend invitations
- Sponsored results presented as organic recommendations

Long-term monetization may come from:

- Creator analytics
- Restaurant demand analytics
- Campaign attribution
- Reservation or ordering attribution
- Promoted intent surfaces with clear labeling
- Creator and business tools
- Aggregated market intelligence

Monetization unlocks only after the relevant behavior and demand exist.

---

# 🔥 STAGE 0 — FOUNDATION / QUIET PRODUCTION

**Current status:** Active  
**Current downloads:** 15 / 30  
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

- [ ] Clear hours.
- [ ] Open/closed state.
- [ ] Distance and travel context.
- [ ] Directions.
- [ ] Original video.
- [ ] Source creator.
- [ ] User note.
- [ ] Visited action.

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

# 🚀 STAGE 2 — EFFORTLESS CAPTURE AND EXTRACTION

**Unlock condition:** Stage 1 acceptance passed  
**Primary metric:** Share-driven save completion  
**Estimated valuation:** $750K–$2M if share behavior is repeatable

---

## 🎯 Stage 2 goal

Saving a food post becomes faster and easier than the user’s existing habit.

## 🧭 Product experience

Main feeling:

> “Whenever I see a restaurant video, I automatically share it to Nearr.”

---

## 📊 Stage 2 required metrics

- Downloads ≥ 200
- WAU ≥ 75
- Share saves ≥ 50% of saves
- Save success ≥ 80%
- Strong-evidence save time ≤ 5 seconds
- Average saves per user ≥ 5
- Wrong saves ≤ 15%
- Manual recovery completion is measured
- Second-week saving behavior is growing

---

## 🟥 P0 Stage 2 backlog

### Native share hardening

- [ ] Instagram share works reliably.
- [ ] TikTok share works reliably.
- [ ] YouTube and YouTube Shorts share works reliably.
- [ ] Paste-link fallback remains available.
- [ ] Share extension handles app-not-running state.
- [ ] Share extension handles expired authentication.
- [ ] Share extension handles duplicate taps.
- [ ] Share extension returns useful progress and completion states.
- [ ] Save completion is not lost when the app is backgrounded.

### Extraction benchmark

Maintain a versioned benchmark containing:

- [ ] Clear restaurant-name posts
- [ ] Address-only posts
- [ ] Caption-only names
- [ ] Multiple restaurants
- [ ] Restaurant roundups
- [ ] Chain ambiguity
- [ ] Wrong or misleading location tags
- [ ] Generic captions
- [ ] Creator-only hints
- [ ] Posts with no usable restaurant
- [ ] Closed or renamed restaurants
- [ ] Instagram, TikTok, and YouTube examples

For each benchmark run, record:

- Correct place
- Correct address
- Candidate set quality
- Confidence behavior
- Processing time
- Recovery behavior
- Cost

### Evidence and ranking

- [ ] Use platform-provided evidence when available.
- [ ] Use caption and description evidence.
- [ ] Use creator and location context.
- [ ] Use transcript or OCR fallback only when practical and legal.
- [ ] Rank candidates consistently.
- [ ] Separate “no evidence” from “conflicting evidence.”
- [ ] Use confirmation when uncertainty remains.
- [ ] Do not silently degrade to a generic nearby business.

### Reliability and recovery

- [ ] Retry transient failures.
- [ ] Normalize timeout behavior.
- [ ] Queue long-running processing safely.
- [ ] Notify users when a delayed result is ready, only with permission.
- [ ] Support manual name search.
- [ ] Support map selection where useful.
- [ ] Preserve pending saves across app restarts.
- [ ] Prevent duplicate database records.

---

## 🟧 P1 Stage 2 backlog

### Speed optimization

- [ ] Fast path for high-confidence evidence.
- [ ] Cache platform metadata where permitted.
- [ ] Cache place resolution where safe.
- [ ] Avoid repeating expensive work.
- [ ] Instrument processing phases.
- [ ] Optimize the slowest proven bottleneck first.

### Import and migration experiments

Only if user demand appears:

- [ ] Import a small list from Google Maps or CSV.
- [ ] Import existing copied links.
- [ ] Batch-process a limited saved-post export when technically possible.
- [ ] Do not build a giant migration system without demand.

### User corrections as training data

- [ ] Record candidate rejection.
- [ ] Record manual replacement.
- [ ] Record chain-location correction.
- [ ] Record multi-place selection.
- [ ] Use aggregate corrections to improve ranking.
- [ ] Do not expose personal user data in public analytics.

---

## 🟨 P2 Stage 2 backlog

- [ ] Better “add Nearr to favorites” education.
- [ ] Share-extension visual polish.
- [ ] Background completion notification.
- [ ] Save receipts or lightweight confirmation history.
- [ ] Platform-specific tutorial clips.

---

## 📣 Stage 2 marketing unlock

Allowed:

- Repeated UGC concept tests
- More creator promotion experiments
- Local geographic concentration
- Small paid creative tests
- Founder-content cadence
- Referral links for attribution

Scale only when one or more concepts repeatedly produce:

- Correct first saves
- Multiple saves
- Retention
- Acceptable acquisition cost

---

## ✅ Stage 2 acceptance tests

- [ ] Share is the dominant save method.
- [ ] High-confidence posts complete quickly.
- [ ] Ambiguous posts ask clearly.
- [ ] No-evidence posts recover honestly.
- [ ] Benchmark accuracy improves between releases.
- [ ] Save failures are categorized and measurable.
- [ ] Marketing traffic does not materially reduce first-save success.

---

## 🚫 Locked in Stage 2

- Social feed
- Public user profiles
- Full creator dashboard
- Restaurant dashboard
- Paid acquisition at scale
- Generic AI discovery
- Broad category expansion

---

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

- [ ] Ask “Did you go?” only after a meaningful action or reasonable time.
- [ ] Options:
  - Yes, loved it
  - Yes, not for me
  - Not yet
- [ ] Do not require a public review.
- [ ] Mark visited.
- [ ] Preserve visit timestamp.
- [ ] Allow correction.
- [ ] Use visit feedback to reduce irrelevant reminders.

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

# 🌐 STAGE 8 — CATEGORY-NEUTRAL PLACE-INTENT PLATFORM

**Unlock condition:** Food wedge remains strong and Stage 7 business value is proven  
**Primary metric:** New categories retain without weakening food  
**Strategic status:** Long-term option, not current roadmap permission

---

## 🎯 Stage 8 goal

Expand Nearr from food into any real-world place while preserving the same source-to-action advantage.

## Expansion sequence

### Stage 8A — Category-neutral foundation

- Generalize place types.
- Remove food-only assumptions from data models.
- Preserve food-specific UX where useful.
- Ensure reminders and actions support different place categories.

### Stage 8B — Generalized extraction

Potential categories:

- Hotels
- Hikes
- Attractions
- Shops
- Gyms
- Events
- Services

Each category must have:

- A repeated source-content behavior
- A clear real-world action
- Sufficient extraction reliability
- A retention reason
- A measurable business or user value

### Stage 8C — Category-aware product experience

Different categories may need different:

- Details
- Actions
- Reminder timing
- Decision factors
- Visit states
- Source context

Do not force every category into restaurant UX.

### Stage 8D — Creator vertical expansion

Explicitly postponed until the underlying place system works across categories.

Do not expand creator verticals merely because the database supports them.

---

# 📈 CORE METRIC PROGRESSION

- Stage 0: Correct first saves
- Stage 1: Recall and second saves
- Stage 2: Effortless share-driven capture
- Stage 3: Retention and resurfacing
- Stage 4: Weekly Active Deciders
- Stage 5: Creator-sourced food growth
- Stage 6: Socially caused saves and decisions
- Stage 7: Attribution and business value
- Stage 8: Category expansion without dilution

---

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

## Stage 1 additions

- saved_library_opened
- saved_search_used
- saved_filter_used
- place_reopened
- note_added
- place_archived
- place_marked_visited
- second_save_completed

## Stage 2 additions

- share_extension_opened
- share_extension_completed
- extraction_phase_timing
- retry_triggered
- delayed_save_completed
- candidate_rejected
- manual_correction_completed

## Stage 3 additions

- reminder_scheduled
- reminder_sent
- reminder_opened
- reminder_snoozed
- reminder_disabled
- weekly_summary_sent
- weekly_summary_opened
- visit_response

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

---

# 📣 MARKETING GATE SYSTEM

## Stage 0 — Research, not scale

Allowed:

- Personalized outreach
- Private creator evaluations
- Founder-led product demonstrations
- User interviews
- Small unpaid organic posts
- App Store conversion improvements

Not allowed:

- Large paid UGC volume
- Major creator launch
- Broad press
- Paid acquisition at scale
- “Official launch” language

## Stage 1 — Controlled growth experiments

Allowed:

- Small UGC batches
- Several creator promotion tests
- Campus or local community launch
- Landing-page and App Store creative tests

Success metric:

> Cost or effort per activated user who completes another meaningful action.

## Stage 2 — Repeatable acquisition search

Allowed:

- Larger creative testing matrix
- Multiple creators
- Small paid tests
- Geographic concentration
- Referral and creator attribution links

Scale only after repeated retention.

## Stage 3 — Full-loop marketing

Marketing may demonstrate:

- Save
- Reminder
- Visit

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

---

# 🎥 UGC TESTING FRAMEWORK

Test concepts, not only creators.

## Problem angles

- Saved posts are impossible to search.
- Users forget where restaurants are.
- Creators do not name the restaurant clearly.
- Saved videos do not become plans.
- Users remember a place only after leaving the area.

## Demonstration angles

- Clear post → instant save
- Vague post → correct identification
- Multiple possible places → easy confirmation
- Original video attached to the pin
- Nearby reminder → restaurant visit

## Presentation styles

- Founder story
- Screen recording
- Challenge
- Friend recommendation
- Day-in-the-life
- Before and after
- Creator demonstration
- Real nearby payoff

## UGC success metrics

Do not optimize primarily for:

- Views
- Likes
- Comments
- Installs

Optimize for:

- Correct first-save rate
- Cost per activated user
- Second-save rate
- Day-3 retention
- Day-7 retention
- Action rate

---

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

## Suggested headline

> Save food spots from social media. Remember them when you’re nearby.

## How it works

1. See a restaurant online
2. Share it to Nearr
3. Nearr finds the place
4. See it on your map
5. Get reminded later
6. Go try it

## Locked until creator and user demand exists

- Full web app
- Restaurant dashboards
- Creator analytics pages
- Public restaurant trend pages
- SEO content farm
- Generic city-guide blog
- Fake testimonials

## Future public-web differentiation

When the data is real, public pages should emphasize:

- Which creator drove saves
- Which posts generated intent
- Geographic demand
- Save-to-directions behavior
- Trend over time

Do not merely clone generic restaurant popularity pages.

---

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
- Permission copy that does not guarantee reminders
- Claims that do not guarantee extraction accuracy
- No implication of affiliation with social platforms, creators, or restaurants
- Permission for creator content used in marketing
- Data retention and deletion behavior documented

## Creator content caution

Public creator videos may be used only with permission or under a clearly valid licensed use.

Internal testing may use public examples, but marketing should use:

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

Nearr should not claim a confirmed visit unless the evidence supports it.

---

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

## Metrics

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
- Crashes:
- Top failure reason:

## User learning

- Most common confusion:
- Most common save failure:
- Most requested feature:
- Most valuable successful moment:
- Strongest reason users return:
- Strongest reason users leave:

## Current decisions

- P0 item being solved:
- Metric expected to improve:
- Experiment:
- Success threshold:
- Stop condition:
- Feature explicitly not being built:

---

# 🚨 FINAL RULES

1. Metrics unlock stages.
2. Acceptance tests unlock stages.
3. Deadlines do not unlock stages.
4. Built features do not unlock stages.
5. Competitor features do not unlock stages.
6. Spending does not unlock stages.
7. Creator interest is not distribution until it creates activated users.
8. Installs are not growth if users do not complete correct saves.
9. Do not broaden before the food loop works.
10. Do not monetize regular users early.
11. Do not build social features before there is useful activity to share.
12. Do not claim visits without evidence.
13. Preserve source context as a first-class product object.
14. Wrong silent saves are worse than asking.
15. Make one save feel magical before chasing scale.
