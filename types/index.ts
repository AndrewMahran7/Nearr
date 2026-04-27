// Normalized types matching supabase/migrations/20260426000001_init_schema.sql.

export type RadiusUnit = 'miles' | 'minutes';

export type SourceType = 'manual' | 'tiktok' | 'instagram' | 'link';

export type Profile = {
  id: string;
  email: string | null;
  default_radius_value: number;
  default_radius_unit: RadiusUnit;
  notifications_enabled: boolean;
  nearby_notifications_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null; // "HH:MM:SS"
  quiet_hours_end: string | null;
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
  source_type: SourceType | null;
  source_url: string | null;
  notifications_enabled: boolean;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A saved_places row joined with its place. Returned by feed queries. */
export type SavedPlaceWithPlace = SavedPlace & { place: PlaceRow };
