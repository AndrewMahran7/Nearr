import type {
  EntityClassificationInput,
  VayrinEntityType,
} from '../../lib/vayrin/entitySemantics';

export type EntityFixture = EntityClassificationInput & {
  id: string;
  expected: VayrinEntityType;
};

/** Frozen semantic corpus. Keep additions representative: this is intended to
 * measure classes, not memorize production answers. */
export const ENTITY_FIXTURES: readonly EntityFixture[] = [
  { id: 'r07-person', text: 'Ken Stornes', contextText: '40.5m Døds world record Norway', expected: 'PERSON' },
  { id: 'person-athlete', text: 'Alex Honnold', contextText: 'athlete climber featuring', expected: 'PERSON' },
  { id: 'creator-name', text: 'Jamie Lee', source: 'creator_name', expected: 'PERSON' },
  { id: 'activity-dods', text: 'Døds', expected: 'ACTIVITY' },
  { id: 'activity-cliff-jumping', text: 'cliff jumping', expected: 'ACTIVITY' },
  { id: 'activity-hiking', text: 'hiking', expected: 'ACTIVITY' },
  { id: 'activity-surfing', text: 'surfing', expected: 'ACTIVITY' },
  { id: 'event-world-record', text: '40.5m Døds world record', expected: 'EVENT' },
  { id: 'event-festival', text: 'summer festival', expected: 'EVENT' },
  { id: 'r08-alias', text: 'Mokes', city: 'Kailua', country: 'Hawaii', contextText: 'volcanic ocean cliffs', expected: 'GEOGRAPHIC_ALIAS' },
  { id: 'alias-black-rock', text: 'Black Rock', contextText: 'natural volcanic ocean cliff', expected: 'GEOGRAPHIC_ALIAS' },
  { id: 'r05-okere', text: 'Okere Falls', city: 'Rotorua', country: 'New Zealand', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'r06-lake-havasu', text: 'Lake Havasu', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'admin-lake-havasu-city', text: 'Lake Havasu City', expected: 'CITY' },
  { id: 'r04-dorset', text: 'Dorset Quarry', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'gran-cenote', text: 'Gran Cenote', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'cenote-azul', text: 'Cenote Azul', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'multnomah-falls', text: 'Multnomah Falls', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'tamolitch-blue-pool', text: 'Tamolitch Blue Pool', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'jordan-pond', text: 'Jordan Pond', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'sunset-cliffs', text: 'Sunset Cliffs', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'moku-nui', text: 'Moku Nui', category: 'island', contextText: 'natural coastal island', expected: 'GEOGRAPHIC_ALIAS' },
  { id: 'stari-most', text: 'Stari Most', category: 'attraction', contextText: 'historic bridge landmark', expected: 'LANDMARK' },
  { id: 'the-narrows', text: 'The Narrows', contextText: 'hiking canyon', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'the-wave', text: 'The Wave', contextText: 'sandstone natural scenic area', expected: 'NAMED_NATURAL_FEATURE' },
  { id: 'generic-waterfall', text: 'waterfall', expected: 'GENERIC_PLACE_TYPE' },
  { id: 'in-n-out', text: 'In-N-Out', expected: 'BUSINESS_OR_VENUE' },
  { id: 'ricks-cafe', text: "Rick's Cafe", expected: 'BUSINESS_OR_VENUE' },
  { id: 'waterfall-cafe', text: 'Waterfall Cafe', expected: 'BUSINESS_OR_VENUE' },
  { id: 'the-cave-restaurant', text: 'The Cave', contextText: 'restaurant interior menu dining', expected: 'BUSINESS_OR_VENUE' },
  { id: 'hotel-staubbach', text: 'Hotel Staubbach', expected: 'BUSINESS_OR_VENUE' },
  { id: 'mcdonalds', text: "McDonald's", expected: 'BUSINESS_OR_VENUE' },
  { id: 'wendys', text: "Wendy's", expected: 'BUSINESS_OR_VENUE' },
  { id: 'kens-cafe', text: "Ken's Cafe", expected: 'BUSINESS_OR_VENUE' },
  { id: 'michael-jordan-steak-house', text: 'Michael Jordan Steak House', expected: 'BUSINESS_OR_VENUE' },
  { id: 'tonys-ambiguous', text: "Tony's", expected: 'UNKNOWN' },
  { id: 'country-norway', text: 'Norway', expected: 'COUNTRY' },
  { id: 'country-new-zealand', text: 'New Zealand', expected: 'COUNTRY' },
] as const;
