# 🧭 NEARR — VERSION GATE SYSTEM (FEATURE ↔ METRIC LINKED)

## 🚨 MASTER RULE

You do NOT build the next version until ALL metrics are hit.

Every feature MUST directly improve a tracked metric.

Deadlines do not unlock stages. Metrics unlock stages.

If a deadline passes and metrics are not hit, metrics still win.

Valuation estimates in this document are rough, traction-dependent, and not guaranteed.

Estimated valuation means: if metrics are real, retention is healthy, and growth is believable.

## FEATURE MATURITY DEFINITIONS

- Built: code exists, but it may still be rough, beta-only, unreliable, or not central to the user promise.
- Beta-tested: tested with real users or real devices enough to expose the obvious failures.
- Productized: reliable enough to be part of the core UX promise.
- Metric-unlocked: proven to improve the current stage metric enough to justify more investment.

Built does not equal unlocked.

## PRODUCT EXPERIENCE RULE

The product experience section describes what the app should feel like at a stage.

It does not unlock the stage by itself.

The app must still hit the required metrics before moving forward.

## CURRENT BUILD REALITY

- Core save loop: magic-link auth, `dev@nearr.test` password login in all builds, save from link/share/manual, source URL saving, saved places, place detail, and save -> focused map via `savedPlaceId`.
- Map/place management: saved-place list, map pins and radius zones, focused show-on-map flows, dismissible selected-place bottom card, directions, notes, original-post viewing, and place filters.
- Reminder infrastructure: reminder toggle, distance settings, notification setup, test notification, foreground/background proximity checks, geofencing, and setup reminder UI. Built for beta testing, not yet proven as a retention engine.
- Auth/legal/ops: file-backed auth-callback route, account/profile recovery, legal scaffolding present but disabled for beta, website/landing-page planning.
- UI/onboarding: dark/orange refresh, How Nearr Works onboarding, activation progress card, settings checklist, crash/performance cleanup.

## ROADMAP DRIFT RULE

If a feature is built early, it must still be assigned to the stage metric it is supposed to improve. Early implementation does not move the company to that stage.

Examples:
- Geofencing built in Stage 0 does not mean Stage 3 is unlocked.
- Legal scaffolding built in Stage 0 does not mean public launch readiness.
- Places filters built in Stage 0 do not mean decision-layer behavior exists.
- Dark UI built in Stage 0 does not mean retention is solved.

## 2026-05-03 PRODUCT STATUS UPDATE

### Current product vision

Nearr is a memory-to-action app for real-world places.

Core loop:

- See a place online
- Want to try it
- Save it
- Nearr remembers it
- Nearr reminds you when you are nearby
- You open the saved place on the map and decide what to do next

The product should not feel like a generic map app. It should feel like: “I saw this place online, Nearr helped me remember it at the right moment, and now I can actually go.”

### Product rules

- Wrong silent saves are worse than asking the user to choose.
- Nearr should not ask for confirmation constantly.
- Auto-save when evidence is strong.
- Ask only when evidence is weak or conflicting.
- Regular users should never pay and should never see traditional ads.
- Later monetization should come from creators, restaurants, and businesses that benefit from real-world intent and attribution.

### Shipping now

- Restaurant extraction v2: evidence-based extraction, address-first bias, exact-name verification through Places, careful poster identity reading, and candidate-picker fallback when evidence is weak.
- `@` handles are treated as evidence, not truth. Influencer vs restaurant distinction is part of the extraction decision.
- Nearby reminders group overlapping saved-place zones into one notification instead of sending separate alerts.

### Partial or still needing validation

- Native iOS share-extension silent save still needs real-device verification in the current environment.
- Background reminder reliability and geofencing still need real-device validation; do not treat simulator or Expo Go behavior as proof.

### Future, not built yet

- Nearby opportunity screen after notification tap
- Visited completion state
- Archived state after missed opportunities
- Archive / Visited filters in Places

### Future ideas to log, not build yet

- Adaptive ellipse/blob zones for overlapping saved places
- More advanced cluster geometry beyond simple circle intersection
- Audio transcription fallback for restaurant names
- Tagged-account profile inspection
- Restaurant / creator attribution dashboard
- Archived / visited map visibility controls
- Social maps
- Creator dashboards
- Restaurant campaign reports
- Monetization through restaurants, creators, and businesses, not regular users

---

# 🔥 STAGE 0 — FOUNDATION (v1 BETA)

**Target deadline:** May 2026  
**Estimated valuation:** $0-$250K if metrics are real and retention is healthy  
**Valuation logic:** Prototype/beta value only. Not fundable at meaningful terms unless there is unusual user pull.

## 🎯 Goal
User can save a place → see it → understand it

## 🧭 Product Experience

Nearr should feel understandable. A new user should know what the app does within 30 seconds. They should be able to save a place, see it on the map, open details, and understand why it saved. The app can still feel beta, but it should not feel broken.

Main feeling: “Oh, I get it. This saves places I want to try.”

## 💸 Expected Monthly Spend

**Expected monthly spend:** $50-$300/month

**Normal costs:**
- AI tools: $20-$100
- Supabase/hosting: $0-$50
- Resend/email: $0-$20
- domain: $10-$30/year
- website/domain/static hosting: $0-$50/month
- Apple Developer: $99/year
- Google Maps/Places: low or free-tier unless usage spikes
- marketing: $0-$100
- legal: $0-$500 one-time using templates or basic review

## 📊 REQUIRED METRICS

- Downloads ≥ 30  
- WAU ≥ 15  
- WAU / Downloads ≥ 40%  

- Avg saves per user ≥ 3  
- Save success rate ≥ 70%  
- Wrong saves ≤ 20%  

- Crash rate < 5%  
- Understanding ≥ 70%

---

## 🧱 FEATURES UNLOCKED

### Auth + Entry
- Magic-link auth + SMTP reliability
- Dev/test password login
- Auth callback works with no unmatched-route failure

👉 Drives:
- Save start rate
- Understanding
- Crash rate

---

### Capture + Save
- Save from link
- Manual save
- Native/share entry works, with iOS silent-save still requiring real-device verification
- Basic extraction
- Candidate selection
- Saved places persist correctly
- Save success focuses the saved place on Map

👉 Drives:
- Save success rate
- Saves per user

---

### Map + View
- Map loads correctly
- Pins display correctly
- Place detail is understandable
- Original post/source can be opened

👉 Drives:
- Map load success
- User understanding

---

### UX Basics
- Loading states
- Clear confirmation
- Error handling
- How Nearr Works onboarding
- Basic settings and setup checklist
- Crash/performance fixes
- Basic reminder infrastructure testing, but not as the core metric

👉 Drives:
- Understanding %
- Save success rate

---

## ✅ STAGE 0 BETA ACCEPTANCE

- Magic link works reliably.
- No unmatched-route auth callback failure.
- Save flow works end-to-end from link/share.
- Wrong saves stay under the stage threshold.
- Map and place details are understandable.
- App does not crash while idle during normal beta use.

---

## 🚫 LOCKED FEATURES
- Social  
- Notification-driven habit loop  
- Visited/photos  
- Recommendations  

---

# ⚡ STAGE 1 — CORE LOOP

**Target deadline:** June 15, 2026  
**Estimated valuation:** $250K-$750K if metrics are real and retention is healthy  
**Valuation logic:** Early proof of value, but still fragile without repeat usage and real reopen behavior.

## 🎯 Goal
User saves → remembers → sees value

## 🧭 Product Experience

Nearr should feel useful after a few saves. The user should be able to reopen the app and remember why they saved each place. Original post and source recall should feel obvious. Place details should feel human, not like database rows.

Main feeling: “I’m glad I saved this.”

## 💸 Expected Monthly Spend

**Expected monthly spend:** $100-$500/month

**Normal costs:**
- AI tools: $20-$120
- Supabase/hosting: $0-$80
- email/auth delivery: $0-$30
- website/domain/static hosting: $0-$100/month
- Apple Developer and domain amortization: low fixed cost
- Google Maps/Places: low, but monitor usage
- analytics/crash tooling: $0-$50
- lightweight user research or testing incentives: $0-$150
- legal/company: usually still minimal if remaining in closed beta

## 📊 REQUIRED METRICS

- Downloads ≥ 75  
- WAU ≥ 25  
- 3-day retention ≥ 25%  

- Avg saves per user ≥ 4  
- Reopen rate ≥ 40%  
- Map success ≥ 95%

---

## 🧱 FEATURES UNLOCKED

### Save → Recall Loop
- “Open original video”
- Better place detail view
- Stronger source recall and context

👉 Drives:
- Reopen rate
- Retention

---

### UI System
- Clean colors + layout
- Cleaner detail pages
- Less confusion in the save → map → detail flow

👉 Drives:
- Retention
- User clarity

---

### Extraction Improvements
- Better parsing logic
- Improved save accuracy
- Better user understanding of what got saved

👉 Drives:
- Save success rate

---

### Reminder Positioning
- Reminder infrastructure may be present for beta testing.
- Stage 1 success is still save → remember → reopen, not full habit automation.

👉 Drives:
- Product clarity
- Correct roadmap focus

---

## 🚫 LOCKED FEATURES
- Notification-driven habit loop  
- Social  
- Visited/photos  

---

# 🚀 STAGE 2 — FRICTION REMOVAL

**Target deadline:** August 1, 2026  
**Estimated valuation:** $750K-$2M if metrics are real and retention is healthy  
**Valuation logic:** Stronger if share-driven saving is clearly working, but still pre-habit and not yet a durable network.

## 🎯 Goal
Saving becomes effortless

## 🧭 Product Experience

Saving should feel fast and natural. Sharing or pasting a link should rarely require thinking. If extraction is uncertain, the app should help the user choose quickly. Wrong saves and failed saves should feel rare.

Main feeling: “Saving to Nearr is effortless.”

## 💸 Expected Monthly Spend

**Expected monthly spend:** $250-$1,000/month

**Normal costs:**
- AI tools: $40-$150
- Supabase/hosting: $25-$150
- email/SMTP: $10-$50
- website/domain/static hosting: $0-$100/month
- Google Maps/Places: $25-$200 depending on save volume
- analytics/crash reporting: $0-$100
- transcription if used: $0-$250
- design/assets/testing incentives: $0-$150
- public launch website design/assets if needed: $100-$500 one-time
- contractor or implementation help if needed: $0-$500

## 📊 REQUIRED METRICS

- Downloads ≥ 200  
- WAU ≥ 75  

- Share saves ≥ 50%  
- Save success ≥ 80%  
- Time to save ≤ 5s  

- Saves/user ≥ 5  

---

## 🧱 FEATURES UNLOCKED

### Share Flow
- Native share improvements
- Faster parsing
- Save in under 5 seconds becomes the bar

👉 Drives:
- Share %
- Saves/user

---

### Performance
- Faster UI
- Reduced loading time
- Faster save completion from app open to saved place

👉 Drives:
- Save completion rate

---

### Extraction Stack
- Harden extraction stack
- Fallback parsing
- Source parsing reliability
- Fewer wrong saves

👉 Drives:
- Save success %
- Wrong saves

---

### Reliability
- Retry system
- Fewer failed saves

👉 Drives:
- Save success %

---

## 🚫 LOCKED FEATURES
- Notification-driven habit loop  
- Social  
- Visited/photos  

---

# 🔥 STAGE 3 — HABIT LOOP

**Target deadline:** September 15, 2026  
**Estimated valuation:** $2M-$5M if metrics are real and retention is healthy  
**Valuation logic:** First stage where investor interest becomes more credible if user pull is obvious and users come back on their own.

## 🎯 Goal
Productize reminders and completion loop

## 🧭 Product Experience

Nearr should start bringing users back without them manually remembering. Nearby reminders should feel timely and useful, not spammy. Users should start completing the loop by visiting places. The app should make saved vs visited feel satisfying.

Main feeling: “Nearr reminded me at the right moment.”

## 💸 Expected Monthly Spend

**Expected monthly spend:** $500-$2,500/month

**Normal costs:**
- AI tools: $50-$200
- Supabase/hosting: $50-$300
- email/notification infrastructure: $20-$100
- Google Maps/Places: $50-$300
- analytics/crash tooling: $20-$150
- transcription or other AI processing: $50-$400
- design/content/community ops: $0-$300
- paid testing or small-scale growth experiments: $0-$500
- company formation/legal may be $500-$2,000 one-time if not done yet

## 📊 REQUIRED METRICS

- Downloads ≥ 500  
- WAU ≥ 150  
- WAU / Downloads ≥ 30%  

- 3-day retention ≥ 35%  
- 7-day retention ≥ 20%  

- % open without sharing ≥ 30%  
- Action rate ≥ 10–15%  
- Notification CTR ≥ 15%

Basic reminder infrastructure may exist earlier for testing, but Stage 3 is where it becomes a metric-owned product loop.

Reminder infrastructure may be built earlier, but Stage 3 requires evidence that reminders create return behavior.

---

## 🧱 FEATURES UNLOCKED

### Notification-Driven Habit Loop
- “You’re near X”
- “You saved this recently”
- Real-device reminder reliability on real iPhones
- Notification quality, timing, and copy
- Meaningful notification CTR and reopen behavior

👉 Drives:
- WAU
- Retention
- Notification CTR

---

## 🆕 COMPLETION LOOP

### “Mark as Visited”
- Timestamp stored
- Completion action after reminder

👉 Drives:
- Retention
- Habit formation
- Action rate

---

### Photo Capture
- Optional photo

👉 Drives:
- Emotional attachment
- Return usage

---

### Visual Progress
- Visited vs saved

👉 Drives:
- Repeat engagement

---

## 🚫 LOCKED FEATURES
- Decision layer  
- Social posts  
- Feed  
- Followers  

---

# 🌍 STAGE 4 — DECISION LAYER

**Target deadline:** December 31, 2026  
**Estimated valuation:** $5M-$12M if metrics are real and retention is healthy  
**Valuation logic:** Nearr starts to look like a real decision product, not just a save utility, especially if WAD behavior is real.

## 🎯 Goal
User uses Nearr to decide where to go

## 🧭 Product Experience

Nearr should help users decide where to go now. Map, filters, ranking, and nearby context should feel like decision tools. The app should shift from “things I saved” to “what should I do?” Getting directions should become a core action.

Main feeling: “Nearr helps me choose.”

## 💸 Expected Monthly Spend

**Expected monthly spend:** $1,500-$7,500/month

**Normal costs:**
- AI tools and developer tooling: $100-$400
- backend/hosting/database: $150-$1,000
- email and lifecycle messaging: $25-$150
- Google Maps/Places: $150-$1,000
- analytics/crash/reporting stack: $50-$300
- transcription/ML services if active: $100-$1,000
- design/assets/content production: $100-$750
- legal/company/accounting: $100-$1,000
- contractors/freelancers: $0-$3,000
- marketing tests and ambassadors: $250-$2,000

## 📊 REQUIRED METRICS

- Downloads ≥ 2,000  
- WAU ≥ 500  

- Sessions/week ≥ 2  
- Non-share sessions ≥ 40%  
- Session time ≥ 60–90s  

Basic map, filters, and search can exist earlier. Stage 4 is when they become decision tools.

---

## 🧱 FEATURES UNLOCKED

### Decision UI
- “Near me”
- Filters
- Ranking
- Map/search/filtering used to choose where to go now

👉 Drives:
- Session time
- Decision rate

---

### Action Layer
- “Go here”
- Open directions
- Start navigation becomes the north-star behavior

👉 Drives:
- Weekly Active Deciders (WAD)

---

### Core Metric Unlock

**WAD (Weekly Active Deciders)**  
Users who:
- tap “go”
- open maps
- start navigation

👉 This becomes your NORTH STAR

---

## 🚫 LOCKED FEATURES
- Social feed  
- Public sharing  

---

# 🧩 STAGE 5 — EXPANSION

**Target deadline:** June 30, 2027  
**Estimated valuation:** $10M-$25M if metrics are real and retention is healthy  
**Valuation logic:** Expansion is valuable only if the core loop stays clean while new categories widen usage without adding confusion.

## 🎯 Goal
More use cases without confusion

## 🧭 Product Experience

Nearr should work beyond restaurants without becoming confusing. Activities, stores, events, and other places should fit naturally. Food should still work well. The product should feel broader but not bloated.

Main feeling: “I can save anything I want to do later.”

## 💸 Expected Monthly Spend

**Expected monthly spend:** $5,000-$20,000/month

**Normal costs:**
- engineering and AI tools: $150-$700
- backend/database/hosting: $300-$2,500
- email/lifecycle tooling: $50-$250
- Google Maps/Places and related APIs: $300-$2,500
- analytics/crash/data tooling: $100-$600
- design/content/assets: $250-$1,500
- legal/accounting/compliance: $250-$2,000
- contractors/freelancers: $1,000-$8,000
- marketing, creators, ambassadors: $1,000-$8,000

## 📊 REQUIRED METRICS

- Downloads ≥ 10,000  
- WAU ≥ 2,000  

- Non-food saves ≥ 20%  
- Retention stable  

---

## 🧱 FEATURES UNLOCKED

Expansion only matters if the food loop stays stable.

### Categories
- Activities
- Events
- Stores

👉 Drives:
- Saves/user
- WAU

---

### Search + Discovery
- Global search

👉 Drives:
- Session depth

---

## 🚫 LOCKED FEATURES
- Social feed  

---

# 🧑‍🤝‍🧑 STAGE 6 — SOCIAL

**Target deadline:** December 31, 2027  
**Estimated valuation:** $25M-$75M if metrics are real and retention is healthy  
**Valuation logic:** Social can re-rate the company fast, but only if influence, viewing, and follow behavior are authentic rather than superficial.

## 🎯 Goal
People influence each other

## 🧭 Product Experience

Social should feel like useful influence, not a feed for its own sake. Users should discover places through friends, creators, or shared maps. Profiles and following should make the app more useful, not more distracting. Private saved-place behavior must still remain strong.

Main feeling: “People I trust help me find places.”

## 💸 Expected Monthly Spend

**Expected monthly spend:** $15,000-$75,000/month

**Normal costs:**
- product and AI tooling: $250-$1,000
- backend/infrastructure/database: $1,000-$8,000
- messaging/email/notification systems: $100-$800
- maps/places APIs: $1,000-$10,000
- analytics/data/crash tooling: $250-$1,500
- trust, moderation, and support operations: $500-$5,000
- design/content/community: $500-$4,000
- legal/privacy/accounting: $500-$5,000
- contractors or hires: $5,000-$30,000
- paid growth, creators, partnerships: $5,000-$40,000

## 📊 REQUIRED METRICS

- Downloads ≥ 50,000  
- WAU ≥ 10,000  

- Following ≥ 25%  
- Social viewing ≥ 30%  

---

## 🧱 FEATURES UNLOCKED

Social only matters if private saved-place behavior is already strong.

### Profiles
- Public maps

👉 Drives:
- Social engagement

---

### Following
- Friends/influencers

👉 Drives:
- Retention

---

### Shared Maps
- Group planning

👉 Drives:
- WAU

---

### Photo Socialization
- Visited photos visible

👉 Drives:
- Content creation

---

# 🧠 STAGE 7 — INTELLIGENCE

**Target deadline:** June 30, 2028  
**Estimated valuation:** $75M-$250M+ if metrics are real and retention is healthy  
**Valuation logic:** This only matters if recommendations consistently drive action. Without that, AI story alone is worth very little.

## 🎯 Goal
Nearr predicts what you should do

## 🧭 Product Experience

Nearr should feel predictive. The app should recommend what to do based on intent, context, history, and location. Recommendations should drive real actions, not just clicks. AI should feel invisible and useful, not gimmicky.

Main feeling: “Nearr knows what I’d probably want to do.”

## 💸 Expected Monthly Spend

**Expected monthly spend:** $50,000+/month

**Normal costs:**
- AI/ML/model usage and tooling: $2,000+
- infrastructure/database/backend: $5,000+
- maps/places and third-party APIs: $3,000+
- analytics/data platform/crash/reporting: $1,000+
- privacy/security/compliance: $1,000+
- legal/accounting: $1,000+
- team, contractors, and recruiting: major cost center
- growth and partnerships: major cost center

## 📊 REQUIRED METRICS

- Downloads ≥ 200,000  
- WAU ≥ 50,000  

- Recommendation CTR ≥ 20%  
- Action rate ≥ 15%

---

## 🧱 FEATURES UNLOCKED

AI only matters if recommendations drive real actions, not just clicks.

### AI Recommendations
- Personalized suggestions

👉 Drives:
- WAD

---

### Intent Graph
- Predict behavior

👉 Drives:
- Retention

---

# 🚨 FINAL RULES

## 1. ALL metrics must pass

## 2. If metrics fail
DO NOT BUILD FEATURES  
Fix the stage

## 3. Deadlines do not unlock stages
Metrics unlock stages.

## 4. Valuation estimates are conditional
Valuation estimates assume real users, clean retention, and believable growth. Vanity downloads do not count.

## 5. Core metric progression

- Stage 0–2 → Saves
- Stage 3 → Retention
- Stage 4+ → **WAD (Decisions)**

## 6. Spend rules

- Expenses should scale with validated usage, not ambition.
- Spending more than the normal range before hitting stage metrics is a warning sign unless there is a specific bottleneck.
- Metrics unlock stages. Spending does not unlock stages.
- Deadlines do not unlock stages.
- Raising money should happen only when money accelerates a validated loop.

## 7. Roadmap drift rule

- Early implementation does not unlock a stage.
- Built infrastructure still belongs to the stage metric it is meant to improve.
- Do not let code already written fool you into claiming product maturity you have not earned.

---

# 🌐 WEBSITE / LANDING PAGE GATE

The website supports trust and conversion. It does not prove product-market fit.

## Timing

- Create a simple website soon after closed beta starts.
- The website is for credibility, explanation, beta signups, legal/support pages later, and eventual public-launch support.
- The website must support the mobile app loop, not distract from it.

## Core rule

- The website should NOT delay the beta.
- If the app is not stable, fix the app first.
- Do not spend more than one evening on the first version.

## Closed beta website requirements

- One-page landing page
- Clear headline
- Join beta CTA
- Contact/support email
- Basic privacy and terms links if available

How it works should explain Nearr in 10 seconds:
1. See a place online
2. Share it to Nearr
3. See it on your map
4. Get reminded nearby
5. Go try it

Suggested first headline:
“Save places from Instagram and TikTok. Remember them when you’re nearby.”

Suggested CTA:
“Join the beta”

## Public launch website requirements

- Landing page
- App Store link
- Privacy Policy
- Terms of Service
- Support/contact
- Account deletion instructions
- Short FAQ
- Screenshots or demo video

## Fundraising / press website requirements

- Strong product positioning
- Clean visuals and screenshots
- Metrics or traction if public
- Founder/contact info
- Press kit optional later

## Do NOT build yet

- Login/dashboard
- Blog
- SEO content farm
- Complex CMS
- Fake testimonials
- Web version of the app
- Recommendation pages
- Anything that distracts from mobile app usage

---

# 💸 FUNDING GUIDANCE

- Self-fund through Stages 0-2 unless costs become painful.
- Consider angels/pre-seed around Stage 3 if retention and user pull are real.

---

# ⚖️ BUSINESS / LEGAL GATE SYSTEM

Closed beta can happen before incorporation.

Public launch should ideally happen after incorporation if Nearr is intended to be a venture-backed startup.

Company formation protects the project. It does not prove product-market fit.

## Required legal/product readiness before public launch

- Terms of Service
- Privacy Policy
- beta disclaimer while the product is still unstable
- account deletion/contact process
- data/privacy review for location, notifications, accounts, saved links, source URLs, and diagnostics
- permission copy that does not promise reminder delivery or extraction accuracy
- Legal scaffolding and in-app acceptance flows can be built before public launch.
- Beta should not force production legal acceptance unless there is a specific risk reason.

## Company Formation Stage

Form the company before:
- public App Store launch
- revenue collection
- partnerships
- paid marketing at scale
- giving equity
- raising money

Recommended structure:
- Delaware C-Corp if pursuing the venture-backed startup path
- LLC only if intentionally staying small, cash-flow oriented, or self-funded

## Founder / team legal basics

- Founder IP assignment should be explicit
- Use signed contractor, advisor, and cofounder agreements
- Do not promise equity casually in messages or calls
- If there are cofounders, set vesting and paperwork early
- If founder stock is issued, 83(b) usually must be filed within 30 days; consult a lawyer or accountant

## Brand / risk basics

- Do a basic trademark and domain search before public launch
- Consider a formal trademark later if traction warrants it
- Review app claims so Nearr does not promise guaranteed reminders, guaranteed extraction accuracy, or affiliation with third-party platforms or restaurants
- VC becomes more realistic around Stage 4+ when Nearr has decision behavior/WAD, not just saves.
- Do not raise just to build features. Raise when money clearly accelerates a validated loop.

---

# 🎯 EARLY SUCCESS

If you cannot hit:
- 50 downloads  
- 25 WAU  

You have a PRODUCT problem.