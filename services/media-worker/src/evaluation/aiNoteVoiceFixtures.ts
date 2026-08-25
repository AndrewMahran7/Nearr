import type { EvidenceItem } from '../types/evidence.js';

export type AiNoteVoiceFixture = {
  id: string;
  group: 'food' | 'water' | 'outdoors' | 'city_venue' | 'ambiguous';
  label: string;
  placeName: string;
  category: string;
  evidence: EvidenceItem[];
};

const frame = (value: string, timestampSeconds: number): EvidenceItem => ({
  source: 'frame', value, timestampSeconds,
});

export const AI_NOTE_VOICE_FIXTURES: AiNoteVoiceFixture[] = [
  { id: 'burger', group: 'food', label: 'Burger', placeName: 'Burger Counter', category: 'restaurant', evidence: [frame('double smashburger with crisp browned edges and melted cheese', 4), frame('hands lifting the same very tall smashburger from a tray', 7)] },
  { id: 'pizza', group: 'food', label: 'Pizza', placeName: 'Corner Slice', category: 'restaurant', evidence: [frame('wide pizza slice bending under bubbling cheese', 3), { source: 'speech', value: 'listen to that crust crack', timestampSeconds: 5 }] },
  { id: 'coffee-dessert', group: 'food', label: 'Coffee and dessert', placeName: 'Night Cafe', category: 'cafe', evidence: [frame('espresso poured over vanilla ice cream in a small glass', 8), frame('the affogato overflowing slightly onto its saucer', 10)] },
  { id: 'surfing', group: 'water', label: 'Surfing', placeName: 'North Break', category: 'beach', evidence: [frame('surfer dropping down the face of a very large curling wave', 12), frame('several large waves breaking hard close together', 15)] },
  { id: 'swimming-hole', group: 'water', label: 'Swimming hole', placeName: 'Granite Pool', category: 'lake', evidence: [frame('dark blue swimming hole shaded by tall granite walls', 6), frame('swimmer entering the dark water from a low rock', 9)] },
  { id: 'waterfall', group: 'water', label: 'Waterfall', placeName: 'Fern Falls', category: 'waterfall', evidence: [frame('narrow waterfall dropping into a bright clear pool', 11), frame('people standing tiny beside the tall waterfall', 14)] },
  { id: 'cliff-jump', group: 'water', label: 'Cliff jump', placeName: 'Blue Ledge', category: 'attraction', evidence: [frame('person hesitating at the edge of a high rock ledge over water', 5), frame('same person jumping from the high ledge into the water', 7)] },
  { id: 'hike', group: 'outdoors', label: 'Hike', placeName: 'Canyon Loop', category: 'hiking_trail', evidence: [frame('hikers climbing a long exposed staircase cut into the canyon', 18), { source: 'speech', value: 'we still have two thousand feet to climb', timestampSeconds: 19 }] },
  { id: 'mountain-viewpoint', group: 'outdoors', label: 'Mountain viewpoint', placeName: 'Cloud Ridge', category: 'scenic_spot', evidence: [frame('layered mountain ridges extending above a low cloud deck', 22), frame('small lookout platform facing the same mountain panorama', 25)] },
  { id: 'cave', group: 'outdoors', label: 'Cave', placeName: 'Echo Cavern', category: 'attraction', evidence: [frame('person squeezing sideways through a narrow cave passage', 9), frame('large underground chamber filled with jagged rock columns', 14)] },
  { id: 'beach', group: 'outdoors', label: 'Beach', placeName: 'Glass Cove', category: 'beach', evidence: [frame('empty crescent beach bordered by black volcanic cliffs', 3), frame('waves washing over smooth black pebbles on the same beach', 6)] },
  { id: 'rooftop', group: 'city_venue', label: 'Rooftop', placeName: 'The Roofline', category: 'bar', evidence: [frame('rooftop tables glowing under small lamps after sunset', 16), frame('city lights visible beyond the same rooftop patio', 19)] },
  { id: 'hotel', group: 'city_venue', label: 'Hotel', placeName: 'Harbor House', category: 'hotel', evidence: [frame('hotel room window opening directly onto a busy harbor view', 7), frame('bed positioned to face the same floor-to-ceiling harbor window', 10)] },
  { id: 'restaurant-interior', group: 'city_venue', label: 'Restaurant interior', placeName: 'Little Room', category: 'restaurant', evidence: [frame('tiny candlelit dining room with closely packed tables', 4), frame('open kitchen visible from nearly every table', 8)] },
  { id: 'architecture', group: 'city_venue', label: 'Unusual architecture', placeName: 'Spiral House', category: 'attraction', evidence: [frame('building exterior formed from stacked curved concrete terraces', 5), frame('spiral ramp continuing around the building interior', 13)] },
  { id: 'scenic-road', group: 'ambiguous', label: 'Scenic road', placeName: 'Coastal Highway', category: 'transportation', evidence: [frame('two-lane road curving along a steep ocean cliff', 6), frame('same empty road continuing beside the ocean', 9)] },
  { id: 'storefront', group: 'ambiguous', label: 'Ordinary storefront', placeName: 'Mori Market', category: 'shopping', evidence: [frame('small neighborhood storefront with two bicycles outside', 3), { source: 'visible_text', value: 'MORI MARKET', timestampSeconds: 3 }] },
  { id: 'broad-landscape', group: 'ambiguous', label: 'Broad landscape', placeName: 'Prairie Overlook', category: 'scenic_spot', evidence: [frame('broad grassy plain beneath a pale overcast sky', 4), frame('distant low hills across the same grassy plain', 8)] },
];
