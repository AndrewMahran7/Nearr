-- Expand Nearr's stable consumer taxonomy. Raw Google types remain evidence in
-- places.google_* columns; saved_places.category stores only this normalized set.

alter table public.saved_places
  drop constraint if exists saved_places_category_check,
  add constraint saved_places_category_check check (
    category is null or category in (
      'restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert',
      'hotel', 'resort',
      'hiking_trail', 'park', 'beach', 'waterfall', 'lake', 'marina', 'island', 'scenic_spot',
      'attraction', 'museum', 'shopping', 'entertainment', 'nightlife', 'sports',
      'fitness', 'wellness', 'transportation', 'education', 'service', 'other'
    )
  ),
  drop constraint if exists saved_places_category_source_check,
  add constraint saved_places_category_source_check check (
    category_source is null or category_source in (
      'google_primary_type', 'google_types', 'deterministic', 'ai', 'user', 'fallback'
    )
  );

comment on column public.saved_places.category is
  'Normalized Nearr category; never a raw Google Places type.';
comment on column public.saved_places.category_source is
  'Diagnostic origin: provider primary/supporting type, deterministic identity, structured media AI, legacy user override, or fallback.';
