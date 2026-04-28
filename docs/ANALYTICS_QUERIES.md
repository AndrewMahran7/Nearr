# Nearr Analytics Queries

All queries here run against `public.analytics_events` (see
`supabase/migrations/20260427000001_analytics_events.sql`). Paste them
directly into the Supabase **SQL Editor** — the editor uses the
`service_role` connection so it can `select` from a table that's RLS-locked
against client roles.

> **North Star: Weekly Active Deciders (WAD)**
>
> A *decider* is a user who triggered one of these in a given ISO week:
>
> - `open_in_maps_tapped`
> - `go_here_tapped`        *(future, when the dedicated "Go here" CTA ships)*
> - `directions_started`    *(future, when in-app directions ship)*
>
> **Fallback definition (today):** if the dedicated decision events don't
> exist yet, count `open_in_maps_tapped` only. The master query below uses
> the fallback automatically — no edit needed when the new events ship.

---

## 0. Master weekly summary

One query, one table. Each row is one ISO week. This is the most important
query in the file; everything below is a focused drill-down.

```sql
-- ---------------------------------------------------------------------------
-- WEEKLY GROWTH SUMMARY
-- ---------------------------------------------------------------------------
-- Returns one row per ISO week with all the headline numbers we care about.
-- Designed to be read top-to-bottom in the Supabase SQL Editor.
--
-- Definitions:
--   active_users               distinct user_id with ANY event that week
--   weekly_active_deciders     distinct user_id who triggered a decision
--                              event (open_in_maps_tapped is the V1 proxy;
--                              add go_here_tapped / directions_started to
--                              the IN list below once those events ship)
--   total_saves                count of save_success events
--   save_success_rate          save_success / save_started, percentage
--   share_save_percent         % of save_success where source_type != manual
--   avg_saves_per_active_user  total_saves / active_users
--   users_with_3_plus_saves    distinct users with >= 3 save_success
--   open_in_maps_taps          count of open_in_maps_tapped
--   map_opens                  count of map_opened
--   d3_retention               of users first seen this week, share with
--                              another event 1-3 days after first seen
--   d7_retention               same, 1-7 days after first seen
-- ---------------------------------------------------------------------------
with weeks as (
  select
    date_trunc('week', created_at) as week,
    user_id,
    event_name,
    properties,
    created_at
  from public.analytics_events
  where user_id is not null
),
first_seen as (
  -- Earliest event per user, used for the retention buckets below.
  select user_id, min(created_at) as first_at
  from public.analytics_events
  where user_id is not null
  group by user_id
),
cohort as (
  -- For each user, the week they were first seen and whether they came
  -- back in the d3 / d7 windows.
  select
    date_trunc('week', f.first_at)                   as cohort_week,
    f.user_id,
    bool_or(
      e.created_at >  f.first_at
      and e.created_at <= f.first_at + interval '3 days'
    ) as came_back_d3,
    bool_or(
      e.created_at >  f.first_at
      and e.created_at <= f.first_at + interval '7 days'
    ) as came_back_d7
  from first_seen f
  left join public.analytics_events e
    on e.user_id = f.user_id
   and e.created_at >  f.first_at
   and e.created_at <= f.first_at + interval '7 days'
  group by 1, 2
),
saves_per_user as (
  select
    date_trunc('week', created_at) as week,
    user_id,
    count(*) as saves
  from public.analytics_events
  where event_name = 'save_success'
  group by 1, 2
)
select
  w.week,

  count(distinct w.user_id)                                 as active_users,

  count(distinct w.user_id) filter (
    where w.event_name in (
      'open_in_maps_tapped'
      -- , 'go_here_tapped'        -- enable when shipped
      -- , 'directions_started'    -- enable when shipped
    )
  )                                                         as weekly_active_deciders,

  count(*) filter (where w.event_name = 'save_success')     as total_saves,

  round(
    100.0 * count(*) filter (where w.event_name = 'save_success')
      / nullif(count(*) filter (where w.event_name = 'save_started'), 0),
    1
  )                                                         as save_success_rate,

  round(
    100.0 * count(*) filter (
      where w.event_name = 'save_success'
        and (w.properties->>'source_type') is distinct from 'manual'
    )
      / nullif(count(*) filter (where w.event_name = 'save_success'), 0),
    1
  )                                                         as share_save_percent,

  round(
    1.0 * count(*) filter (where w.event_name = 'save_success')
      / nullif(count(distinct w.user_id), 0),
    2
  )                                                         as avg_saves_per_active_user,

  (
    select count(*)
    from saves_per_user s
    where s.week = w.week and s.saves >= 3
  )                                                         as users_with_3_plus_saves,

  count(*) filter (where w.event_name = 'open_in_maps_tapped') as open_in_maps_taps,
  count(*) filter (where w.event_name = 'map_opened')          as map_opens,

  round(
    100.0 * count(distinct c.user_id) filter (where c.came_back_d3)
      / nullif(count(distinct c.user_id), 0),
    1
  )                                                         as d3_retention,
  round(
    100.0 * count(distinct c.user_id) filter (where c.came_back_d7)
      / nullif(count(distinct c.user_id), 0),
    1
  )                                                         as d7_retention

from weeks w
left join cohort c on c.cohort_week = w.week
group by w.week
order by w.week desc;
```

---

## 1. WAU — Weekly Active Users

Distinct signed-in users per ISO week.

```sql
select
  date_trunc('week', created_at) as week,
  count(distinct user_id)        as wau
from public.analytics_events
where user_id is not null
group by 1
order by 1 desc;
```

## 2. WAD — Weekly Active Deciders (North Star)

```sql
select
  date_trunc('week', created_at) as week,
  count(distinct user_id)        as weekly_active_deciders
from public.analytics_events
where event_name in (
  'open_in_maps_tapped'
  -- , 'go_here_tapped'
  -- , 'directions_started'
)
and user_id is not null
group by 1
order by 1 desc;
```

## 3. Downloads / signups proxy

We don't have an install ping (no Apple/Play API hooked up), so the best
proxy is **first-ever `session_started` per user**. That's "first session
on a real Supabase account" — close enough to a signup curve for V1.

```sql
select
  date_trunc('week', first_session) as week,
  count(*)                          as new_users
from (
  select user_id, min(created_at) as first_session
  from public.analytics_events
  where event_name = 'session_started' and user_id is not null
  group by user_id
) s
group by 1
order by 1 desc;
```

If you want pre-signup activity too, swap to anonymous_id:

```sql
select
  date_trunc('week', first_seen) as week,
  count(*)                       as new_installs
from (
  select anonymous_id, min(created_at) as first_seen
  from public.analytics_events
  where anonymous_id is not null
  group by anonymous_id
) s
group by 1
order by 1 desc;
```

## 4. Save success rate

```sql
select
  date_trunc('week', created_at) as week,
  count(*) filter (where event_name = 'save_success')                  as successes,
  count(*) filter (where event_name = 'save_started')                  as attempts,
  round(
    100.0 * count(*) filter (where event_name = 'save_success')
      / nullif(count(*) filter (where event_name = 'save_started'), 0),
    1
  ) as save_success_rate
from public.analytics_events
where event_name in ('save_started', 'save_success')
group by 1
order by 1 desc;
```

## 5. Save failure rate (with top error codes)

```sql
-- Weekly failure rate
select
  date_trunc('week', created_at) as week,
  round(
    100.0 * count(*) filter (where event_name = 'save_failed')
      / nullif(count(*) filter (where event_name = 'save_started'), 0),
    1
  ) as save_failure_rate
from public.analytics_events
where event_name in ('save_started', 'save_failed')
group by 1
order by 1 desc;

-- Top failure reasons (last 30 days)
select
  properties->>'error_code' as error_code,
  count(*)                  as n
from public.analytics_events
where event_name = 'save_failed'
  and created_at >= now() - interval '30 days'
group by 1
order by n desc;
```

## 6. Share saves vs manual saves

```sql
select
  date_trunc('week', created_at) as week,
  count(*) filter (where (properties->>'source_type') is distinct from 'manual') as share_saves,
  count(*) filter (where (properties->>'source_type') = 'manual')                as manual_saves,
  round(
    100.0 * count(*) filter (where (properties->>'source_type') is distinct from 'manual')
      / nullif(count(*), 0),
    1
  ) as share_save_percent
from public.analytics_events
where event_name = 'save_success'
group by 1
order by 1 desc;
```

## 7. Saves per user

```sql
-- Weekly average
select
  date_trunc('week', created_at) as week,
  round(
    1.0 * count(*) / nullif(count(distinct user_id), 0),
    2
  ) as avg_saves_per_user
from public.analytics_events
where event_name = 'save_success' and user_id is not null
group by 1
order by 1 desc;

-- All-time saves per user (top 50)
select user_id, count(*) as saves
from public.analytics_events
where event_name = 'save_success' and user_id is not null
group by 1
order by saves desc
limit 50;
```

## 8. Users with 3+ saves (engagement threshold)

```sql
select
  date_trunc('week', created_at) as week,
  count(*) as users_with_3_plus_saves
from (
  select
    date_trunc('week', created_at) as created_at,
    user_id,
    count(*) as saves
  from public.analytics_events
  where event_name = 'save_success' and user_id is not null
  group by 1, 2
  having count(*) >= 3
) s
group by 1
order by 1 desc;
```

## 9. 3-day retention

Of users first seen on day D, what % had any event on D+1..D+3?

```sql
with first_seen as (
  select user_id, min(created_at)::date as first_day
  from public.analytics_events
  where user_id is not null
  group by user_id
),
returned as (
  select
    f.first_day,
    f.user_id,
    bool_or(
      e.created_at::date between f.first_day + 1 and f.first_day + 3
    ) as came_back
  from first_seen f
  left join public.analytics_events e on e.user_id = f.user_id
  group by 1, 2
)
select
  first_day                                                   as cohort_day,
  count(*)                                                    as cohort_size,
  count(*) filter (where came_back)                           as retained,
  round(100.0 * count(*) filter (where came_back) / count(*), 1) as d3_retention_pct
from returned
group by 1
order by 1 desc;
```

## 10. 7-day retention

```sql
with first_seen as (
  select user_id, min(created_at)::date as first_day
  from public.analytics_events
  where user_id is not null
  group by user_id
),
returned as (
  select
    f.first_day,
    f.user_id,
    bool_or(
      e.created_at::date between f.first_day + 1 and f.first_day + 7
    ) as came_back
  from first_seen f
  left join public.analytics_events e on e.user_id = f.user_id
  group by 1, 2
)
select
  first_day                                                   as cohort_day,
  count(*)                                                    as cohort_size,
  count(*) filter (where came_back)                           as retained,
  round(100.0 * count(*) filter (where came_back) / count(*), 1) as d7_retention_pct
from returned
group by 1
order by 1 desc;
```

## 11. Weekly funnel

session → save attempt → save success → map open → decision.

```sql
select
  date_trunc('week', created_at) as week,
  count(distinct user_id) filter (where event_name = 'session_started')        as step_1_session,
  count(distinct user_id) filter (where event_name = 'save_started')           as step_2_save_attempt,
  count(distinct user_id) filter (where event_name = 'save_success')           as step_3_save_success,
  count(distinct user_id) filter (where event_name = 'map_opened')             as step_4_map_open,
  count(distinct user_id) filter (
    where event_name in (
      'open_in_maps_tapped'
      -- , 'go_here_tapped'
      -- , 'directions_started'
    )
  ) as step_5_decision
from public.analytics_events
where user_id is not null
group by 1
order by 1 desc;
```

## 12. Top failed share sources (no PII)

We only log the `url_host` (e.g. `www.tiktok.com`) — never the full URL —
so this query stays safe to share.

```sql
select
  properties->>'url_host'   as host,
  properties->>'source_type' as source_type,
  properties->>'error_code'  as error_code,
  count(*)                   as n
from public.analytics_events
where event_name in ('share_parse_failed', 'save_failed')
  and created_at >= now() - interval '30 days'
group by 1, 2, 3
order by n desc
limit 50;
```

## 13. Wrong-save proxy (delete-after-save signal)

We don't log a dedicated correction event yet, but we can approximate
"user saved the wrong place and removed it" by joining `save_success` to
the `saved_places` row's deletion. Until a `place_removed` analytics
event ships, use this Supabase-native query against the live table:

```sql
-- Saves created and removed within 10 minutes (likely "wrong save").
-- Requires service_role read on saved_places — works in SQL Editor.
select
  user_id,
  place_id,
  created_at,
  -- saved_places doesn't store deleted_at; use the audit trail when added.
  -- For now: placeholder showing the intended shape. Replace `null` once
  -- a `place_removed` analytics event is added.
  null as removed_at
from public.saved_places
where created_at >= now() - interval '30 days'
order by created_at desc
limit 100;
```

When a `place_removed` event is added later, the real query becomes:

```sql
select
  s.properties->>'saved_place_id' as saved_place_id,
  min(s.created_at)               as saved_at,
  min(r.created_at)               as removed_at,
  extract(epoch from (min(r.created_at) - min(s.created_at))) / 60.0 as minutes_to_remove
from public.analytics_events s
join public.analytics_events r
  on r.event_name = 'place_removed'
 and r.properties->>'saved_place_id' = s.properties->>'saved_place_id'
where s.event_name = 'save_success'
  and s.created_at >= now() - interval '30 days'
group by 1
having extract(epoch from (min(r.created_at) - min(s.created_at))) / 60.0 < 10
order by saved_at desc;
```

## 14. Visited / completed places (when shipped)

The `place_marked_visited` event isn't wired yet (the feature is on the
roadmap — see `CHECKLIST.md`). Once the UI ships and starts emitting it,
this query gives the visit-completion rate per week:

```sql
select
  date_trunc('week', created_at) as week,
  count(*) as visits_marked,
  count(distinct user_id) as visitors
from public.analytics_events
where event_name = 'place_marked_visited' and user_id is not null
group by 1
order by 1 desc;
```

---

## How to add a new event

1. Pick a snake_case name (`thing_verbed`).
2. Call `void trackEvent('thing_verbed', { ...properties })` from the UI.
3. **Never** put PII / auth tokens / full personal URLs in `properties`.
   Use ids, short codes, hostnames.
4. Add a query here so the team knows what to ask of it.
