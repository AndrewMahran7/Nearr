# 🧭 NEARR — VERSION GATE SYSTEM  
## Feature ↔ Metric Linked Roadmap

**Last updated:** 2026-07-10  
**Current stage:** Stage 0  
**Current launch mode:** Quiet production release, not broad public launch

---

## 🚨 MASTER RULE

You do **not** build the next version until the current stage metrics are hit.

Every feature must either:

1. Improve a tracked metric
2. Reduce a meaningful product, legal, reliability, or distribution risk
3. Make the core save → map → action loop easier to understand

Deadlines do not unlock stages. Metrics unlock stages.

If a deadline passes and metrics are not hit, the stage does **not** unlock.

Valuation estimates in this document are rough, traction-dependent, and not guaranteed. Estimated valuation means: if metrics are real, retention is healthy, and growth is believable.

---

## 🧱 FEATURE MATURITY DEFINITIONS

A feature being built early does **not** mean Nearr has unlocked the stage that feature belongs to.

- **Built:** Code exists. It may still be rough, untested, dev-only, unreliable, or not central to the user promise.
- **Real-device tested:** Tested on real iOS/Android devices enough to expose obvious failures.
- **Production-visible:** Available in the production app, but not necessarily proven.
- **Productized:** Reliable enough to be part of the core UX promise.
- **Metric-unlocked:** Proven to improve the stage metric enough to justify more investment.

**Built does not equal unlocked.**

Examples:
- Reminder infrastructure existing in Stage 0 does not mean Stage 3 habit loop is unlocked.
- Feedback form existing in Stage 0 does not mean retention is solved.
- App Store release does not mean public launch has happened.
- Competition existing does not mean Nearr has product-market fit.
- Creator interest does not mean creator distribution is repeatable.

---

## 🧭 PRODUCT EXPERIENCE RULE

The product experience section describes what the app should feel like at a stage.

It does not unlock the stage by itself.

The app must still hit the required metrics before moving forward.

---

## 🧠 CURRENT STRATEGIC REALITY

Nearr is no longer operating in an imaginary market.

There is visible market validation for the broad need:

- People want to save places from social media.
- Multiple apps are already attacking some version of this behavior.
- Competitors include broad save/organize apps, travel/place map apps, and social-video-to-place apps.
- Known competitor examples include Albo, Mio, Mapstr, Doko, Places, Found, Nomiq, and similar “save places” tools.

This is good and bad.

### Good

- The problem is real.
- Users already understand saving things from online content.
- Creators already create real-world intent.
- Food and travel content are natural acquisition wedges.

### Bad

- Nearr is not early to the broad “save places” category.
- “Save places from TikTok/Instagram” is not unique by itself.
- Nearr cannot win by being a worse broad save-anything app.
- Nearr must win by being more focused, faster, and better at the place-action loop.

---

## 🎯 CURRENT POSITIONING

Nearr should not position itself as a generic organizer.

Nearr’s wedge is:

> **Save food spots and real-world places from social media, see them on your map, and remember them when you’re nearby.**

The early niche should be food first.

Food is the right first wedge because:

- Food creators already generate high-intent recommendations.
- Users frequently save restaurant videos and forget them.
- The action is concrete: go eat there.
- The value of a nearby reminder is obvious.
- Creator partnerships can eventually produce a distribution loop.

Nearr can expand later, but the first domination goal is:

> **Become the best app for saving restaurants from TikTok, Instagram, YouTube Shorts, and links.**

---

## 🧩 CORE LOOP

Nearr’s core loop:

1. See a place online
2. Want to try it
3. Share/paste/save it to Nearr
4. Nearr finds the place
5. User confirms if needed
6. Place is saved
7. Map opens to the saved place
8. User remembers it later
9. Nearr resurfaces it nearby
10. User opens directions or visits

The product should feel like:

> “I saw this place online, Nearr helped me remember it, and now I can actually go.”

---

## 🧪 CURRENT BUILD REALITY

Some features have already been built even though Nearr is still Stage 0. These features remain assigned to the metrics they are supposed to improve.

### Built or mostly built

#### Auth + Entry
- Magic-link auth
- Dev/test login
- Auth callback route
- Pre-auth onboarding / public intro flow
- Sign-in contrast cleanup
- Sign-in back navigation to onboarding

#### Save + Extraction
- Save from link/share
- Manual/paste link flow
- Candidate confirmation
- Source URL saving
- Original post/source opening
- Save success can route/focus the saved place on the map
- Known working example videos exist for Instagram, TikTok, and YouTube

#### Map + Place View
- Map view
- Search
- Nearby / Recent / Saved chips
- Saved-place list
- Place bottom card
- Expanded place details
- Directions button
- Notes field
- Saved-from-source label
- Remove from saved
- View All
- Selected place persistence when returning from Settings has been scoped as production polish

#### Reminders
- Notification permission flow
- Location/Always Location setup
- Nearby reminder toggle
- Distance settings
- Test notification
- Foreground/background proximity checks
- Geofencing infrastructure
- Setup checklist

This is infrastructure. It does **not** mean the habit loop is proven.

#### Feedback / Trust / Production Polish
- In-app feedback entry point
- Legal links
- Review row planned or added
- Runtime diagnostics hidden or gated for production
- Testing section gated for development
- App Store screenshot planning
- Quiet production release plan

#### Onboarding / Education
- Pre-auth onboarding intro
- Share Favorites explanation
- Share-to-Nearr explanation
- Nearby reminders explanation
- First-save challenge/actions
- Tutorial video plan for Instagram/TikTok/YouTube

---

## 🚫 CURRENT PRODUCT RISKS

These are the risks that matter before broad growth.

### 1. First-save reliability risk
If a user shares a link and Nearr fails, saves the wrong place, or does not focus the saved place on the map, the app loses trust immediately.

### 2. Understanding risk
Users must understand the app before signing up. Pre-auth onboarding reduces this risk, but the App Store page and first save still have to make the loop obvious.

### 3. Competition risk
Competitors are ahead in polish and breadth. Nearr must be narrower and better at food/place action.

### 4. Permission trust risk
Location and notification permissions must be asked at the right time with clear copy. Do not ask too early.

### 5. Creator distribution risk
Creators may like the idea, but that does not mean they will promote it. The creator loop must be proven manually.

### 6. Quiet production risk
Going to production removes TestFlight friction, but it also makes the first impression more permanent.

---

## 🚦 LAUNCH MODE DEFINITIONS

### Development build
Used by the founder for testing.

### Quiet production release
The app is live on the App Store, but not broadly marketed.

Purpose:
- Remove TestFlight friction
- Give creators and users a real App Store link
- Test onboarding and save loop with real users
- Collect feedback
- Avoid “launch day” pressure

This is still treated like a beta internally.

### Public launch
The app is actively marketed through creator posts, social content, press, Product Hunt, paid marketing, or broad public announcements.

Nearr is **not ready for public launch** until Stage 0 acceptance is met and first-save reliability is strong.

---

## 🧲 COMPETITION RULE

Competition is market validation, not proof that Nearr will win.

Do not respond to competitors by adding every feature they have.

Competitors being broad means Nearr should get sharper:

- Albo saves everything.
- Mio saves travel/places.
- Map/list apps organize places.
- Nearr should save food spots and places from social media and get users to actually go.

Nearr’s early advantage must be:

1. Better food-specific positioning
2. Faster save-to-map flow
3. Better post-save focus
4. Nearby reminder/action loop
5. Creator attribution later

---

## 🧑‍🍳 FOOD-FIRST RULE

Until Stage 2 metrics are hit, Nearr should act like a food-first app in positioning, screenshots, examples, and creator outreach.

This does not mean the app cannot save hikes, hotels, bars, cafes, or other places.

It means the growth wedge should be food.

Reason:
Food content has the strongest combination of:
- creator supply
- user intent
- repeat behavior
- local action
- restaurant/business monetization potential

---

## 📣 CREATOR STRATEGY REALITY

Creator distribution is promising but not guaranteed.

Do not assume:
- 10% of a creator’s followers will download
- a large account will post for free
- creator interest equals repeatable growth

A more realistic early funnel:

- 100 creators contacted
- 20–30 reply
- 10–15 try it
- 3–5 like it
- 1–2 post
- 200–1,000 downloads
- 50–300 first saves
- 10–75 retained users

Creator strategy should start with:
- micro and mid-size food creators
- direct feedback requests
- permission before using creator content publicly
- “help followers remember the places you post” pitch

Future creator value:
- save counts
- directions taps
- follower intent
- creator maps
- restaurant attribution

Do not build creator dashboards until creator demand and user saving behavior are proven.

---

## 💸 MONETIZATION RULE

Regular users should not pay and should not see traditional ads.

Long-term monetization should come from:
- creators
- restaurants
- local businesses
- attribution
- promoted intent surfaces
- campaign reporting
- creator/business tools

Do not add a consumer paywall during early stages. It adds friction and weakens the user network before the core behavior is proven.

---

# 🔥 STAGE 0 — FOUNDATION / QUIET PRODUCTION

**Current status:** Active  
**Launch mode:** Development build → quiet production  
**Estimated valuation:** $0–$250K if metrics are real and retention is healthy  
**Valuation logic:** Prototype/early app value only. Not fundable at meaningful terms unless there is unusual user pull.

---

## 🎯 Goal

User can understand Nearr, save a real place, see it on the map, and know what to do next.

---

## 🧭 Product Experience

Nearr should feel understandable within 30 seconds.

A new user should know:

- Nearr saves places from social media
- The place goes onto a map
- Nearby reminders help later
- They can share/paste links to save
- After saving, the map opens to the place

Main feeling:

> “Oh, I get it. This saves restaurants and places I want to try.”

---

## 🎯 Stage 0 Positioning

Stage 0 should be food-first.

The public/App Store pitch should be:

> **Save food spots from social media. See them on your map. Remember them nearby.**

Avoid broad/investor language like:
- memory-to-action layer
- place-intent graph
- social evidence extraction
- AI-powered local intent

Those belong in strategy docs, not App Store copy.

---

## 📊 REQUIRED METRICS

### Distribution / Activation
- Downloads ≥ 30
- WAU ≥ 15
- WAU / downloads ≥ 40%

### Core Save Loop
- First-save attempt rate ≥ 50% of signed-in users
- First-save success rate ≥ 70%
- Avg saves per user ≥ 3
- Wrong saves ≤ 20%
- Post-save map focus success ≥ 90%

### Reliability
- Crash rate < 5%
- Share/paste flow does not hang indefinitely
- Auth callback works reliably

### Understanding
- Understanding ≥ 70%
- At least 7/10 users can explain Nearr after onboarding without help
- At least 7/10 users know how to save a place after seeing onboarding

---

## 🧱 FEATURES ALLOWED / UNLOCKED

### Pre-auth Education
- Public onboarding before sign-up
- App Store screenshots
- Tutorial videos for Instagram/TikTok/YouTube save flows
- Sign-in back button to onboarding

Drives:
- understanding
- sign-up conversion
- first-save attempt rate

---

### Save + Map Loop
- Save from link/share
- Manual paste
- Candidate confirmation
- Save success routes to focused map
- Original post/source URL saved
- Open original post
- Directions button

Drives:
- first-save success
- saves/user
- user trust

---

### Production Trust
- Feedback form
- Leave a review row
- Terms/Privacy links
- Hide dev/testing UI in production
- Hide runtime diagnostics in production
- Clean tab bar contrast
- No obvious debug copy

Drives:
- trust
- feedback collection
- production readiness

---

### Basic Reminder Setup
- Notification setup
- Location setup
- Nearby reminder explanation
- Test reminders in dev

Allowed, but Stage 0 does not require reminder habit loop to work.

Drives:
- future retention
- setup readiness

---

## ✅ STAGE 0 ACCEPTANCE

Nearr can move past Stage 0 only when:

- App is stable enough for quiet production.
- Pre-auth onboarding clearly explains the app.
- Sign-in works.
- Save from link/share works on real devices.
- Known-working Instagram/TikTok/YouTube examples save successfully.
- Save success opens the map to the saved place.
- Wrong saves remain under threshold.
- Runtime diagnostics/testing UI are hidden in production.
- Feedback path exists.
- App Store page communicates the food/place wedge clearly.

---

## 🚫 LOCKED IN STAGE 0

Do not build these as product investments yet:

- Social feed
- Public profiles
- Creator dashboards
- Restaurant dashboards
- Recommendations
- Group maps
- Visit/photo social layer
- Monetization
- Paid marketing
- Broad category expansion beyond places

---

# ⚡ STAGE 1 — CORE LOOP

**Estimated valuation:** $250K–$750K if metrics are real and retention is healthy  
**Valuation logic:** Early proof of value, but fragile without repeat usage and real reopen behavior.

---

## 🎯 Goal

User saves, remembers, and reopens.

---

## 🧭 Product Experience

Nearr should feel useful after a few saves.

Main feeling:

> “I’m glad I saved this.”

The user should be able to:
- reopen the app
- understand why they saved each place
- open the original post
- see context
- choose a saved spot again later

---

## 📊 REQUIRED METRICS

- Downloads ≥ 75
- WAU ≥ 25
- 3-day retention ≥ 25%
- Avg saves per user ≥ 4
- Reopen rate ≥ 40%
- Map success ≥ 95%
- Second-save rate ≥ 25%
- Post-save map focus success ≥ 95%

---

## 🧱 FEATURES ALLOWED / UNLOCKED

### Save → Recall Loop
- Better saved-place detail
- Source recall
- Original post preview/opening
- Notes
- Better empty states
- “Recently saved” list polish

Drives:
- reopen rate
- retention
- second saves

---

### Food-first Polish
- Stronger food examples
- App Store preview polish
- Known creator/video examples
- Copy focused on restaurants and food spots

Drives:
- conversion
- understanding
- creator relevance

---

### Feedback Loop
- In-app feedback
- Failed-save report path
- Private complaints before public bad reviews

Drives:
- bug discovery
- trust
- product learning

---

## 🚫 LOCKED IN STAGE 1

- Full notification-driven habit loop as a success claim
- Social
- Creator dashboards
- Restaurant monetization
- Recommendations

---

# 🚀 STAGE 2 — FRICTION REMOVAL

**Estimated valuation:** $750K–$2M if metrics are real and retention is healthy  
**Valuation logic:** Stronger if share-driven saving is clearly working, but still pre-habit and not yet a durable network.

---

## 🎯 Goal

Saving becomes effortless.

---

## 🧭 Product Experience

Saving should feel fast and natural.

Main feeling:

> “Saving to Nearr is effortless.”

---

## 📊 REQUIRED METRICS

- Downloads ≥ 200
- WAU ≥ 75
- Share saves ≥ 50%
- Save success ≥ 80%
- Time to save ≤ 5 seconds when evidence is strong
- Saves/user ≥ 5
- Wrong saves ≤ 15%

---

## 🧱 FEATURES ALLOWED / UNLOCKED

### Share Flow Hardening
- Faster share processing
- Better native share handling
- Better share favorites education
- Better loading/progress state

Drives:
- share saves
- save completion

---

### Extraction Stack
- Platform-specific evidence sources
- Tagged-location support when available
- Caption/description extraction
- Transcript/OCR fallback if practical
- Candidate ranking
- Low-confidence confirmation

Drives:
- save success
- wrong-save reduction

---

### Reliability
- Retry system
- Timeout handling
- Clear failed-save recovery
- Manual search fallback

Drives:
- trust
- save success

---

## 🚫 LOCKED IN STAGE 2

- Social feed
- Creator dashboards
- Paid acquisition at scale
- Broad category expansion

---

# 🔥 STAGE 3 — HABIT LOOP

**Estimated valuation:** $2M–$5M if metrics are real and retention is healthy  
**Valuation logic:** First stage where investor interest becomes more credible if user pull is obvious and users come back on their own.

---

## 🎯 Goal

Productize reminders and completion loop.

---

## 🧭 Product Experience

Nearr should bring users back without them manually remembering.

Main feeling:

> “Nearr reminded me at the right moment.”

---

## 📊 REQUIRED METRICS

- Downloads ≥ 500
- WAU ≥ 150
- WAU / downloads ≥ 30%
- 3-day retention ≥ 35%
- 7-day retention ≥ 20%
- % open without sharing ≥ 30%
- Action rate ≥ 10–15%
- Notification CTR ≥ 15%

---

## 🧱 FEATURES ALLOWED / UNLOCKED

### Notification-Driven Habit Loop
- “You’re near X”
- grouped nearby reminders
- real-device reminder reliability
- notification copy/timing
- tap notification → useful nearby opportunity screen

Drives:
- retention
- reopen behavior
- action rate

---

### Completion Loop
- Mark as visited
- Timestamp
- Optional photo
- Saved vs visited state

Drives:
- emotional attachment
- repeat engagement
- action tracking

---

## 🚫 LOCKED IN STAGE 3

- Social feed
- Public profiles
- Creator dashboards
- Restaurant dashboards

---

# 🌍 STAGE 4 — DECISION LAYER

**Estimated valuation:** $5M–$12M if metrics are real and retention is healthy  
**Valuation logic:** Nearr starts to look like a decision product, not just a save utility, if Weekly Active Decider behavior is real.

---

## 🎯 Goal

User uses Nearr to decide where to go.

---

## 🧭 Product Experience

Nearr shifts from “things I saved” to “what should I do?”

Main feeling:

> “Nearr helps me choose.”

---

## 📊 REQUIRED METRICS

- Downloads ≥ 2,000
- WAU ≥ 500
- Sessions/week ≥ 2
- Non-share sessions ≥ 40%
- Session time ≥ 60–90s
- Direction/action rate ≥ 15%
- Weekly Active Deciders tracked and growing

---

## 🧱 FEATURES ALLOWED / UNLOCKED

### Decision UI
- Nearby decision screen
- Filters
- Ranking
- Best saved spots around me
- Distance/time context

Drives:
- session time
- action rate
- WAD

---

### Action Layer
- Open directions
- Go here
- Start navigation
- Maybe reservation/order links later

Drives:
- Weekly Active Deciders

---

## NORTH STAR BEGINS

**WAD — Weekly Active Deciders**

Users who:
- open directions
- tap go
- start navigation
- make a saved-place decision

---

## 🚫 LOCKED IN STAGE 4

- Social feed
- Public sharing as a major investment
- Restaurant monetization unless inbound demand exists

---

# 🧩 STAGE 5 — FOOD NICHE DOMINATION

**Estimated valuation:** $10M–$25M if metrics are real and retention is healthy  
**Valuation logic:** Valuable if Nearr becomes strongly associated with saving food spots and shows repeat creator/user behavior.

---

## 🎯 Goal

Own the food-video-to-place-save wedge.

---

## 🧭 Product Experience

Nearr should feel like the default app for food places seen online.

Main feeling:

> “When I see a restaurant video, I save it to Nearr.”

---

## 📊 REQUIRED METRICS

- Downloads ≥ 10,000
- WAU ≥ 2,000
- Food saves remain majority of saves
- 1,000+ users with 3+ food saves
- Creator-sourced installs measurable
- At least 10 creators have tested Nearr
- At least 3 creators have shared or seriously considered sharing Nearr

---

## 🧱 FEATURES ALLOWED / UNLOCKED

### Creator-Facing Lightweight Tools
Only if creator demand exists.

- Creator attribution tracking
- Creator save counts
- Creator map preview
- Shareable creator map concept tests

Drives:
- creator acquisition
- creator retention
- distribution loop

---

### Food-Specific Product Polish
- Better restaurant detail
- cuisine/category filters
- best nearby food spots
- source creator context
- “places I’ve been meaning to try”

Drives:
- retention
- WAD
- saves/user

---

## 🚫 LOCKED IN STAGE 5

- Broad social feed
- Full restaurant ad marketplace
- Complex business dashboards
- Non-food expansion unless food retention remains strong

---

# 🧑‍🤝‍🧑 STAGE 6 — SOCIAL / CREATOR MAPS

**Estimated valuation:** $25M–$75M if metrics are real and retention is healthy  
**Valuation logic:** Social can re-rate the company quickly, but only if influence, viewing, and follow behavior are authentic rather than superficial.

---

## 🎯 Goal

People influence each other’s real-world place decisions.

---

## 🧭 Product Experience

Social should feel like useful influence, not a feed for its own sake.

Main feeling:

> “People I trust help me find places.”

---

## 📊 REQUIRED METRICS

- Downloads ≥ 50,000
- WAU ≥ 10,000
- Following ≥ 25%
- Social viewing ≥ 30%
- Creator-sourced activation is measurable
- Shared maps drive saves

---

## 🧱 FEATURES ALLOWED / UNLOCKED

### Profiles
- public maps
- creator maps
- saved-place collections

Drives:
- social engagement
- distribution

---

### Following
- friends
- influencers
- food creators

Drives:
- retention
- discovery

---

### Shared Maps
- creator map
- group planning
- trip maps

Drives:
- WAU
- saves/user

---

## 🚫 LOCKED IN STAGE 6

- Heavy feed investment unless profiles/maps are already working
- Fake social engagement
- Vanity follower features with no save/action behavior

---

# 🧠 STAGE 7 — INTELLIGENCE / ATTRIBUTION

**Estimated valuation:** $75M–$250M+ if metrics are real and retention is healthy  
**Valuation logic:** AI/data story only matters if recommendations and attribution consistently drive action.

---

## 🎯 Goal

Nearr predicts and proves real-world intent.

---

## 🧭 Product Experience

Nearr should feel predictive and useful.

Main feeling:

> “Nearr knows what I’d probably want to do.”

---

## 📊 REQUIRED METRICS

- Downloads ≥ 200,000
- WAU ≥ 50,000
- Recommendation CTR ≥ 20%
- Action rate ≥ 15%
- Creator attribution used by creators/businesses
- Restaurant/business interest is inbound or repeatable

---

## 🧱 FEATURES ALLOWED / UNLOCKED

### AI Recommendations
- Personalized suggestions
- “Go now” recommendations
- intent-aware ranking

Drives:
- WAD
- retention

---

### Intent Graph
- social post → place → save → reminder → directions/visit
- creator influence
- restaurant demand signals

Drives:
- business value
- acquisition interest

---

### Business / Restaurant Layer
Only if user and creator loops are already real.

- restaurant demand reports
- creator campaign attribution
- promoted map surfaces
- save-to-visit analytics

Drives:
- monetization
- strategic value

---

# 📈 CORE METRIC PROGRESSION

- Stage 0–2: **Saves**
- Stage 3: **Retention**
- Stage 4+: **WAD / Decisions**
- Stage 5+: **Food niche dominance**
- Stage 6+: **Creator/social distribution**
- Stage 7+: **Intent attribution**

---

# 💸 SPEND RULES

Expenses should scale with validated usage, not ambition.

Spending more than the normal range before hitting stage metrics is a warning sign unless there is a specific bottleneck.

## Stage 0 expected monthly spend
$50–$300/month

## Stage 1 expected monthly spend
$100–$500/month

## Stage 2 expected monthly spend
$250–$1,000/month

## Stage 3 expected monthly spend
$500–$2,500/month

## Stage 4 expected monthly spend
$1,500–$7,500/month

## Stage 5 expected monthly spend
$5,000–$20,000/month

## Stage 6 expected monthly spend
$15,000–$75,000/month

## Stage 7 expected monthly spend
$50,000+/month

Do not raise just to build features. Raise when money clearly accelerates a validated loop.

---

# 🌐 WEBSITE / LANDING PAGE GATE

The website supports trust and conversion. It does not prove product-market fit.

## Quiet production website requirements

- Landing page
- App Store link
- Privacy Policy
- Terms of Service
- Support/contact
- Account deletion instructions
- Short FAQ
- Screenshots or demo video

## Suggested headline

> Save food spots from social media. Remember them when you’re nearby.

## How it works

1. See a restaurant online
2. Share it to Nearr
3. Nearr finds the place
4. See it on your map
5. Get reminded nearby
6. Go try it

## Do not build yet

- web app
- dashboards
- blog
- SEO content farm
- fake testimonials
- restaurant pages
- creator analytics pages

---

# ⚖️ BUSINESS / LEGAL GATE SYSTEM

Quiet production should ideally happen with basic legal readiness.

Company formation is recommended before public launch if Nearr is intended to be venture-backed.

## Required before public launch

- Terms of Service
- Privacy Policy
- Support/contact
- Account deletion/contact process
- Data/privacy review for:
  - location
  - notifications
  - accounts
  - saved links
  - source URLs
  - diagnostics
  - feedback
- Permission copy that does not promise guaranteed reminder delivery
- Claims that do not promise guaranteed extraction accuracy
- No implication of affiliation with Instagram, TikTok, YouTube, restaurants, or creators

## Creator/content caution

Do not use creator videos in public onboarding or App Store screenshots without permission.

It is okay to use public examples internally for testing, but public marketing should either:
- use your own recorded content
- use permissioned creator content
- use generic/demo content

---

# 🏢 COMPANY FORMATION GATE

Form the company before:

- broad public launch
- revenue collection
- partnerships
- paid marketing at scale
- giving equity
- raising money

Recommended structure:
- Delaware C-Corp if pursuing venture path
- LLC only if intentionally staying small/cash-flow oriented

Founder basics:
- IP assignment
- contractor/advisor agreements
- cofounder equity paperwork if needed
- vesting if cofounders join
- 83(b) filing if founder stock is issued

---

# 🎯 EARLY SUCCESS DEFINITION

If Nearr cannot hit:

- 50 downloads
- 25 WAU
- 20 users with at least one save
- 10 users with at least three saves
- 5 users who reopen without being asked

Then Nearr has a product/positioning problem, not a scale problem.

---

# 🚨 FINAL RULES

1. Metrics unlock stages.
2. Deadlines do not unlock stages.
3. Built features do not unlock stages.
4. Spending does not unlock stages.
5. Competition validates the problem but does not validate Nearr.
6. Creator interest is not distribution until it produces activated users.
7. Do not broaden before the food/place loop works.
8. Do not monetize regular users early.
9. Do not copy competitor breadth.
10. Make one save feel magical before chasing scale.