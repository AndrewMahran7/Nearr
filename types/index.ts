// Normalized types matching the forward-only Supabase schema.

import type { CategorySource, NearrCategory } from '@/lib/placeCategory';

export type RadiusUnit = 'miles' | 'minutes';

export type SourceType = 'manual' | 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'snapchat' | 'link';

export type Profile = {
  id: string;
  email: string | null;
  /** @deprecated Physical schema compatibility only; the current client never reads this. */
  default_radius_value?: number;
  /** @deprecated Physical schema compatibility only; the current client never reads this. */
  default_radius_unit?: RadiusUnit;
  notifications_enabled: boolean;
  nearby_notifications_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null; // "HH:MM:SS"
  quiet_hours_end: string | null;
  terms_accepted_at: string | null;
  privacy_accepted_at: string | null;
  legal_version: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaceRow = {
  id: string;
  google_place_id: string | null;
  name: string;
  formatted_address: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  short_formatted_address?: string | null;
  google_primary_type?: string | null;
  google_types?: string[] | null;
  google_type_label?: string | null;
  containing_places?: unknown | null;
  business_status?: string | null;
  google_maps_url: string | null;
  created_at: string;
};

export type SavedPlace = {
  id: string;
  user_id: string;
  place_id: string;
  radius_value: number | null;
  radius_unit: RadiusUnit | null;
  notes: string | null;
  ai_note?: string | null;
  source_type: SourceType | null;
  source_url: string | null;
  notifications_enabled: boolean;
  last_notified_at: string | null;
  /** Number of proximity notifications sent for this place. Max 3. */
  notification_count: number;
  /**
   * Number of nearby-opportunity reminders the user has received. Mirrors
   * `notification_count` at the delivery boundary; gates auto-archive after
   * the third opportunity is declined.
   */
  reminder_opportunity_count: number;
  /** Set when archived (manually or auto after 3 declined opportunities). */
  archived_at: string | null;
  /** Set when the user marks the place visited from the opportunity screen. */
  visited_at: string | null;
  /** Set when archive happened because reminders were exhausted (3/3 declined). */
  reminders_exhausted_at: string | null;
  category?: NearrCategory | null;
  category_source?: CategorySource | null;
  category_confidence?: number | null;
  category_model_version?: string | null;
  category_user_overridden?: boolean;
  categorized_at?: string | null;
  created_at: string;
  updated_at: string;
};

/** A saved_places row joined with its place. Returned by feed queries. */
export type SavedPlaceWithPlace = SavedPlace & { place: PlaceRow };
