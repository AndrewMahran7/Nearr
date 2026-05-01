Perfect — this is exactly how you should be structuring this.

I’m going to turn everything into a **clean, ordered sequence of Claude prompts** you can run one-by-one tomorrow. Each builds on the previous without overlap.

Also, I’m keeping your existing prompt (handle extraction) as **Step 2**, since it fits naturally after the core fixes.

---

# 🧠 MASTER PLAN (Order Matters)

1. Fix notification bugs (critical)
2. Handle @tag edge case (you already wrote this)
3. Add notification limits + actions (product layer)
4. Add AI-generated notes (growth/UX)
5. Final audit + polish (safety before beta)

---

# ✅ PROMPT 1 — FIX NOTIFICATION BUGS (RUN FIRST)

```text
You are working in the Nearr codebase.

Goal:
Fix notification bugs before beta.

IMPORTANT:
- LOG EVERY CHANGE YOU MAKE with file path + reason.
- Do not change product behavior yet (only correctness).
- Do not add new features yet.
- Fix root causes, not symptoms.

Tasks:

1. Fix repeated notification firing.
Notifications must ONLY trigger when user crosses:
outside radius → inside radius

Implement per-place state:
- wasInsideLastCheck
- isInsideNow

Trigger only when:
!wasInsideLastCheck && isInsideNow

2. Ensure proximity system is initialized only once.
Find all places where proximity/location tracking starts:
- prevent duplicate listeners/tasks
- make initialization idempotent

3. Fix notification not showing on device.

Check:
- permission status (log it)
- notification scheduling errors (try/catch + log)
- foreground handler configuration (must show alerts)

4. Add debug logs:
- NOTIFICATION_TRIGGERED
- NOTIFICATION_SKIPPED_ALREADY_INSIDE
- NOTIFICATION_PERMISSION_STATUS
- NOTIFICATION_SENT_SUCCESS
- NOTIFICATION_SEND_FAILED

5. Fix cooldown logic:
Ensure one place cannot fire multiple times immediately.

6. Run:
npx tsc --noEmit -p tsconfig.json

Output:
- Root cause of triple firing
- Root cause of notifications not appearing
- Files changed
- Logs added
- Manual test checklist

Remember:
LOG EVERY CHANGE.
Fix correctness only.
```

---

# ✅ PROMPT 2 — HANDLE @TAG EDGE CASE (YOUR EXISTING ONE)

Here’s **Prompt 2 — Handle @Tag Edge Case** exactly as you should run it:

---

```text
You are working in the Nearr codebase.

Goal:
Handle the edge case where an Instagram/TikTok video has no audio/transcript, but the creator tags the restaurant account.

IMPORTANT:
- LOG EVERY CHANGE YOU MAKE with file path + reason.
- Do not scrape Instagram profile pages yet.
- Do not add Instagram Graph API yet.
- Do not break existing metadata/transcript/Places flow.
- Fail open.

Tasks:

1. Search the share extraction pipeline:
   - lib/shareParser.ts
   - lib/placeExtractor.ts
   - lib/aiExtractPlace.ts
   - supabase/functions/process-share-link/index.ts

2. Add a tagged-handle extraction helper:
   - Extract @handles from title, description, and metadata text
   - Ignore obvious creator/account handles when possible
   - Prefer handles near food/place words or after phrases like “at”, “from”, “📍”, “location”, “restaurant”
   - Return candidates with:
     {
       handle: string,
       readableName: string,
       confidence: number,
       reason: string
     }

3. Convert handles into readable place queries:
   Examples:
   - @villastacoslosangeles -> "Villa's Tacos Los Angeles"
   - @lecoupe_friedchicken -> "Le Coupe Fried Chicken"
   - @some.restaurant.la -> "Some Restaurant LA"

4. In process-share-link:
   If:
   - transcript is missing or empty
   - AI/heuristic confidence is low
   - at least one tagged handle candidate exists

   Then:
   - try Google Places search using the handle-derived query
   - include existing location context if available
   - only auto-save if one strong candidate is found
   - otherwise show candidate picker as usual

5. Add logs:
   - HANDLE_CANDIDATES_EXTRACTED
   - HANDLE_QUERY_ATTEMPTED
   - HANDLE_QUERY_SUCCESS
   - HANDLE_QUERY_FAILED
   - HANDLE_FALLBACK_USED

6. Add test examples:
   - caption only has @restaurant
   - no audio/transcript
   - multiple handles where one is creator and one is restaurant
   - handle includes city suffix like LA/NYC
   - handle has underscores/dots

7. Run:
   npx tsc --noEmit -p tsconfig.json

Output:
- Files changed
- Flow after change
- Logs added
- Test cases
- Assumptions made

Remember:
LOG EVERY CHANGE.
Do not scrape Instagram pages yet.
Use tagged handles as search signals first.
```

---

Run this right after fixing notifications.


# ✅ PROMPT 3 — NOTIFICATION LIMITS + ACTIONS

```text
You are working in the Nearr codebase.

Goal:
Improve notification UX for beta.

IMPORTANT:
- LOG EVERY CHANGE YOU MAKE with file path + reason.
- Do not break notification delivery.
- Build on existing working system.

Tasks:

1. Add notification limit.

Database:
Add column to saved_places:
- notification_count integer default 0

Logic:
Only notify if:
notification_count < 3

Increment after successful notification.

2. Add notification tiers.

Notification 1:
"I'm going" | "Next time" | "Reduce radius"

Notification 2:
Same options

Notification 3:
"I'm going" | "Give me 3 more chances" | "Reduce radius"

3. Implement actions:

"I'm going":
- open directions (Google/Apple Maps)

"Next time":
- dismiss

"Reduce radius":
- open place settings

"Give me 3 more chances":
- reset notification_count to 0

4. Add logs:
- NOTIFICATION_COUNT_INCREMENTED
- NOTIFICATION_LIMIT_REACHED
- NOTIFICATION_RESET

5. Run:
npx tsc --noEmit -p tsconfig.json

Output:
- DB migration
- Updated notification logic
- Actions implemented
- Logs added

Remember:
LOG EVERY CHANGE.
```

---

# ✅ PROMPT 4 — AI AUTO NOTES

```text
You are working in the Nearr codebase.

Goal:
Add AI-generated notes for saved places.

IMPORTANT:
- LOG EVERY CHANGE YOU MAKE with file path + reason.
- Do not overwrite user-written notes.
- Keep notes short and useful.

Tasks:

1. In share save pipeline:
- supabase/functions/process-share-link/index.ts

2. Generate note from:
- title
- description
- transcript (if exists)
- extracted place/food context

3. Examples:
- "Saved for juicy burgers"
- "Saved for matcha and pastries"
- "Saved for date-night Italian"

4. Rules:
- max ~8 words
- must be specific
- must relate to food/experience
- if low confidence → do not generate

5. Save to:
saved_places.notes

ONLY if notes is empty.

6. Add logs:
- AI_NOTE_GENERATED
- AI_NOTE_SKIPPED_LOW_CONFIDENCE

7. Run:
npx tsc --noEmit -p tsconfig.json

Output:
- Where note is generated
- Examples from test cases
- Logs added

Remember:
LOG EVERY CHANGE.
```

---

# ✅ PROMPT 5 — FINAL BETA AUDIT

```text
You are working in the Nearr codebase.

Goal:
Final beta readiness audit.

IMPORTANT:
- LOG EVERY CHANGE YOU MAKE.
- Do not introduce new features.
- Only fix issues and inconsistencies.

Tasks:

1. Verify notification system:
- no duplicate firing
- respects outside → inside rule
- respects max 3 limit
- actions work

2. Verify share pipeline:
- metadata works
- transcription fails open
- @handle fallback works
- AI extraction works

3. Verify AI notes:
- generated correctly
- not overriding user input

4. Verify env variables:
- .env.example matches code
- no deprecated variables required
- transcription variables correct

5. Verify analytics:
Fix:
public.analytics_events missing

Add instruction if migration needed:
supabase db push

6. Reduce log spam:
- gate noisy logs behind __DEV__ or DEBUG flags

7. Run:
npx tsc --noEmit -p tsconfig.json

Output:
- Issues found
- Fixes applied
- Final beta checklist

Remember:
LOG EVERY CHANGE.
Do not break working features.
```

---

# 🧠 Final Thought

This is now a **clean execution pipeline**:

```text
Fix bugs → Handle edge cases → Improve UX → Add intelligence → Audit
```

No wasted Claude calls. No overlapping work. No regression risk.

---

If you want after this, I can help you design:

* the **exact notification copy (high-conversion wording)**
* or **viral loop mechanics** for Nearr

That’s where this becomes really dangerous (in a good way).
