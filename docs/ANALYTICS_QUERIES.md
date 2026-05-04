# Nearr Analytics Queries

> Last updated: 2026-05-03
> Source of truth: `public.analytics_events` plus live product tables where noted

Nearr currently has lightweight product analytics through `public.analytics_events`.

## What is currently tracked

Examples confirmed in code:

- `session_started`
- `share_received`
- `share_parse_started`
- `share_parse_success`
- `share_parse_failed`
- `share_candidate_selected`
- `save_started`
- `save_success`
- `save_failed`
- `first_save_completed`
- `second_save_completed`
- `third_save_completed`
- `activation_progress_seen`
- `activation_cta_tapped`
- `activation_completed_3_saves`
- `map_opened`
- `place_marker_tapped`
- `open_in_maps_tapped`
- `place_detail_opened`
- `how_nearr_works_shown`
- `how_nearr_works_completed`
- `how_nearr_works_skipped`
- `opportunity_notification_opened`
- `opportunity_get_directions_tapped`
- `opportunity_maybe_next_time_tapped`
- `opportunity_visited_tapped`
- `opportunity_adjust_radius_tapped`
- `opportunity_archived_after_3`
- `place_marked_visited`
- `archived_filter_viewed`
- `visited_filter_viewed`
- `archived_place_restored`

What this means for the recent product work:

- Restaurant extraction v2 is shipping, but the analytics table does not currently expose a dedicated event for exact wrong-save confirmation, influencer-vs-restaurant classification quality, or address-first wins.
- Grouped nearby notifications are shipping, but there is not currently a dedicated grouped-notification analytics event in `analytics_events`.
- Opportunity / visited / archived analytics ARE live as of `20260503000001_opportunity_archive.sql`. Use the events listed above to track the post-notification flow.

## What is not currently tracked

- exact wrong-save confirmations as a dedicated event
- grouped nearby notifications as a dedicated analytics event
- crash rate
- user understanding / survey comprehension
- install count from App Store / Play Store APIs

Use the queries below accordingly.

## 1. Signups / downloads proxy

We do not have a true install event. Current best proxy is first `session_started` per user.

```sql
select
  date_trunc('week', min(created_at)) as week,
  count(distinct user_id) as new_users
from public.analytics_events
where event_name = 'session_started'
  and user_id is not null
group by user_id
order by week desc;
```

## 2. WAU

```sql
select
  date_trunc('week', created_at) as week,
  count(distinct user_id) as wau
from public.analytics_events
where user_id is not null
group by 1
order by 1 desc;
```

## 3. WAU / downloads proxy

```sql
with wau as (
  select
    date_trunc('week', created_at) as week,
    count(distinct user_id) as wau
  from public.analytics_events
  where user_id is not null
  group by 1
), new_users as (
  select
    date_trunc('week', min(created_at)) as week,
    count(distinct user_id) as new_users
  from public.analytics_events
  where event_name = 'session_started'
    and user_id is not null
  group by user_id
)
select
  wau.week,
  wau.wau,
  coalesce(new_users.new_users, 0) as new_users,
  round(100.0 * wau.wau / nullif(new_users.new_users, 0), 1) as wau_to_new_user_pct
from wau
left join new_users on new_users.week = wau.week
order by wau.week desc;
```

## 4. Average saves per user

```sql
select
  date_trunc('week', created_at) as week,
  round(count(*)::numeric / nullif(count(distinct user_id), 0), 2) as avg_saves_per_user
from public.analytics_events
where event_name = 'save_success'
  and user_id is not null
group by 1
order by 1 desc;
```

## 5. Save success rate

```sql
select
  date_trunc('week', created_at) as week,
  count(*) filter (where event_name = 'save_started') as save_attempts,
  count(*) filter (where event_name = 'save_success') as save_successes,
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

## 6. Activation: users who reached 3+ saves

Analytics-based milestone query:

```sql
select
  date_trunc('week', created_at) as week,
  count(distinct user_id) as users_completed_activation
from public.analytics_events
where event_name = 'activation_completed_3_saves'
  and user_id is not null
group by 1
order by 1 desc;
```

Live-table view of users with 3+ saved places right now:

```sql
select
  user_id,
  count(*) as saved_places_count
from public.saved_places
group by user_id
having count(*) >= 3
order by saved_places_count desc;
```

## 7. WAD / open maps

Current WAD proxy is `open_in_maps_tapped`.

```sql
select
  date_trunc('week', created_at) as week,
  count(distinct user_id) filter (where event_name = 'open_in_maps_tapped') as wad,
  count(*) filter (where event_name = 'open_in_maps_tapped') as open_in_maps_taps
from public.analytics_events
where user_id is not null
group by 1
order by 1 desc;
```

## 8. Saved places by user

Use the live table, not analytics, for exact current saved-place counts.

```sql
select
  user_id,
  count(*) as saved_places_count
from public.saved_places
group by user_id
order by saved_places_count desc;
```

## 9. Recent saves

Live-table query:

```sql
select
  sp.created_at,
  sp.user_id,
  sp.id as saved_place_id,
  sp.source_type,
  sp.source_url,
  p.name,
  p.formatted_address
from public.saved_places sp
join public.places p on p.id = sp.place_id
order by sp.created_at desc
limit 100;
```

Analytics-event query:

```sql
select
  created_at,
  user_id,
  properties->>'saved_place_id' as saved_place_id,
  properties->>'source_type' as source_type,
  properties->>'flow' as flow
from public.analytics_events
where event_name = 'save_success'
order by created_at desc
limit 100;
```

## 10. Save failures by reason

```sql
select
  properties->>'error_code' as error_code,
  count(*) as failures
from public.analytics_events
where event_name = 'save_failed'
group by 1
order by failures desc;
```

## 11. Activation card exposure / taps

```sql
select
  date_trunc('week', created_at) as week,
  count(*) filter (where event_name = 'activation_progress_seen') as activation_progress_seen,
  count(*) filter (where event_name = 'activation_cta_tapped') as activation_cta_tapped
from public.analytics_events
where event_name in ('activation_progress_seen', 'activation_cta_tapped')
group by 1
order by 1 desc;
```

## 12. Metrics not currently answerable from code alone

- Wrong saves: not directly tracked as a dedicated analytics event.
- Grouped-notification usage: not directly queryable from `analytics_events` today.
- Opportunity / visited / archive funnel: not queryable yet because the underlying feature and events are not live.
- Crash rate: not tracked.
- Understanding/comprehension: not tracked.

If those become important, add explicit events or external tooling before treating them as measurable metrics.
