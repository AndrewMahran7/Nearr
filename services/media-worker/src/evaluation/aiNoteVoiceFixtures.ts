import type { EvidenceItem } from '../types/evidence.js';

export type AiNoteVoiceFixtureGroup =
  | 'food'
  | 'outdoors'
  | 'hotel_stay'
  | 'architecture_interior'
  | 'beaches_water'
  | 'activity_action'
  | 'ordinary_low_interest'
  | 'miscellaneous';

export type AiNoteVoiceFixture = {
  id: string;
  group: AiNoteVoiceFixtureGroup;
  label: string;
  placeName: string;
  category: string;
  evidence: EvidenceItem[];
};

const frame = (value: string, timestampSeconds: number): EvidenceItem => ({
  source: 'frame', value, timestampSeconds,
});
const speech = (value: string, timestampSeconds: number): EvidenceItem => ({
  source: 'speech', value, timestampSeconds,
});
const visible = (value: string, timestampSeconds: number): EvidenceItem => ({
  source: 'visible_text', value, timestampSeconds,
});

/**
 * Deterministic evidence fixtures for the real configured-model benchmark.
 * These are observations, not desired-output examples: the prompt never sees a
 * phrase bank and the evaluator judges the model's own reaction.
 */
export const AI_NOTE_VOICE_FIXTURES: AiNoteVoiceFixture[] = [
  // Food (10)
  { id: 'food-pizza', group: 'food', label: 'Pizza', placeName: 'Corner Slice', category: 'restaurant', evidence: [frame('thin pizza slice with blistered crust and crisp pepperoni cups', 3), speech('listen to that crust crack', 5)] },
  { id: 'food-burger', group: 'food', label: 'Burger', placeName: 'Burger Counter', category: 'restaurant', evidence: [frame('double smashburger with deeply browned edges and melted cheese', 4), frame('hands lifting the tall smashburger from a tray', 7)] },
  { id: 'food-dessert', group: 'food', label: 'Dessert', placeName: 'Sugar Room', category: 'dessert', evidence: [frame('warm chocolate cake split open with a liquid center', 8), frame('vanilla ice cream melting against the warm cake', 10)] },
  { id: 'food-coffee', group: 'food', label: 'Coffee', placeName: 'Juniper Coffee', category: 'cafe', evidence: [frame('barista pouring a precise leaf pattern into a small latte', 6), speech('they roast the beans in the back room', 9)] },
  { id: 'food-restaurant-interior', group: 'food', label: 'Restaurant interior', placeName: 'Little Room', category: 'restaurant', evidence: [frame('tiny candlelit dining room with closely packed tables', 4), frame('open kitchen visible from nearly every table', 8)] },
  { id: 'food-cocktail', group: 'food', label: 'Cocktail', placeName: 'Copper Bar', category: 'bar', evidence: [frame('bartender smoking a rosemary sprig over an amber cocktail', 11), frame('smoke trapped beneath a glass dome over the cocktail', 13)] },
  { id: 'food-bakery', group: 'food', label: 'Bakery', placeName: 'Morning Oven', category: 'bakery', evidence: [frame('croissant pulled apart into many crisp flaky layers', 5), speech('the laminated dough takes three days', 7)] },
  { id: 'food-sushi', group: 'food', label: 'Sushi', placeName: 'Eight Seats', category: 'restaurant', evidence: [frame('chef brushing sauce onto one piece of tuna nigiri', 15), speech('the tuna was aged for twelve days', 16)] },
  { id: 'food-pasta', group: 'food', label: 'Pasta', placeName: 'Pasta Bench', category: 'restaurant', evidence: [frame('wide ribbons of pasta tossed in a wheel of cheese', 12), frame('pepper ground directly over the glossy pasta', 14)] },
  { id: 'food-steak', group: 'food', label: 'Steak', placeName: 'Oak Grill', category: 'restaurant', evidence: [frame('thick steak sliced to show a pink center and dark crust', 9), speech('they baste it with butter and thyme', 10)] },

  // Outdoors (10)
  { id: 'outdoors-hike', group: 'outdoors', label: 'Hike', placeName: 'Canyon Loop', category: 'hiking_trail', evidence: [frame('hikers climbing a long exposed staircase cut into the canyon', 18), speech('we still have 2,000 feet to climb', 19)] },
  { id: 'outdoors-viewpoint', group: 'outdoors', label: 'Mountain viewpoint', placeName: 'Cloud Ridge', category: 'scenic_spot', evidence: [frame('layered mountain ridges extending above a low cloud deck', 22), frame('small lookout platform facing the mountain panorama', 25)] },
  { id: 'outdoors-cave', group: 'outdoors', label: 'Cave', placeName: 'Echo Cavern', category: 'attraction', evidence: [frame('person squeezing sideways through a narrow cave passage', 9), frame('underground chamber filled with jagged rock columns', 14)] },
  { id: 'outdoors-forest', group: 'outdoors', label: 'Forest trail', placeName: 'Redwood Path', category: 'hiking_trail', evidence: [frame('boardwalk passing between enormous redwood trunks', 5), frame('sunlight reaching the trail in narrow beams', 8)] },
  { id: 'outdoors-desert', group: 'outdoors', label: 'Desert overlook', placeName: 'Mesa Rim', category: 'scenic_spot', evidence: [frame('red sandstone ledge above a maze of desert canyons', 7), frame('single narrow trail following the exposed rim', 10)] },
  { id: 'outdoors-waterfall-trail', group: 'outdoors', label: 'Waterfall trail', placeName: 'Fern Falls Trail', category: 'hiking_trail', evidence: [frame('muddy trail ending directly behind a narrow waterfall', 16), speech('the last mile has four stream crossings', 12)] },
  { id: 'outdoors-snow', group: 'outdoors', label: 'Snow walk', placeName: 'Pine Pass', category: 'hiking_trail', evidence: [frame('snow-covered path between tall pine trees', 4), frame('boots sinking deeply into fresh snow', 6)] },
  { id: 'outdoors-garden', group: 'outdoors', label: 'Botanical garden', placeName: 'Mesa Garden', category: 'park', evidence: [frame('arched walkway completely covered by purple flowers', 8), frame('small benches tucked beneath the flower canopy', 11)] },
  { id: 'outdoors-cliff-path', group: 'outdoors', label: 'Cliff path', placeName: 'Headland Walk', category: 'hiking_trail', evidence: [frame('narrow dirt path tracing a steep green ocean cliff', 13), frame('wooden steps descending around the cliff corner', 16)] },
  { id: 'outdoors-geyser', group: 'outdoors', label: 'Geyser', placeName: 'Steam Basin', category: 'park', evidence: [frame('geyser sending a tall column of water above a wooden boardwalk', 17), frame('steam drifting across the boardwalk immediately afterward', 20)] },

  // Hotel / stay (5)
  { id: 'stay-harbor-room', group: 'hotel_stay', label: 'Harbor hotel', placeName: 'Harbor House', category: 'hotel', evidence: [frame('hotel room window opening directly onto a busy harbor', 7), frame('bed positioned to face the floor-to-ceiling harbor window', 10)] },
  { id: 'stay-cabin', group: 'hotel_stay', label: 'Forest cabin', placeName: 'Cedar Cabin', category: 'hotel', evidence: [frame('small cabin bedroom with a wood stove beside the bed', 6), frame('glass wall facing dense cedar trees', 9)] },
  { id: 'stay-pool', group: 'hotel_stay', label: 'Hotel pool', placeName: 'Desert Palms', category: 'resort', evidence: [frame('long pool running between white hotel buildings and palm trees', 12), frame('shaded loungers built into shallow water', 15)] },
  { id: 'stay-bath', group: 'hotel_stay', label: 'Hotel bath', placeName: 'Stone Inn', category: 'hotel', evidence: [frame('deep stone bathtub beside a window overlooking mountains', 5), frame('bathroom wall sliding open toward the bedroom', 8)] },
  { id: 'stay-treehouse', group: 'hotel_stay', label: 'Treehouse stay', placeName: 'Canopy Rooms', category: 'hotel', evidence: [frame('suspended bedroom reached by a rope bridge among trees', 10), frame('round window looking directly into the tree canopy', 13)] },

  // Architecture / interior (5)
  { id: 'architecture-spiral', group: 'architecture_interior', label: 'Spiral building', placeName: 'Spiral House', category: 'attraction', evidence: [frame('building exterior formed from stacked curved concrete terraces', 5), frame('spiral ramp continuing around the building interior', 13)] },
  { id: 'architecture-library', group: 'architecture_interior', label: 'Library', placeName: 'Central Reading Room', category: 'education', evidence: [frame('circular reading room lined by three levels of books', 7), frame('single skylight centered above the reading tables', 10)] },
  { id: 'architecture-museum', group: 'architecture_interior', label: 'Museum interior', placeName: 'Light Museum', category: 'museum', evidence: [frame('white gallery crossed by a bright diagonal shaft of sunlight', 6), frame('visitors walking beneath a suspended mirrored sculpture', 9)] },
  { id: 'architecture-staircase', group: 'architecture_interior', label: 'Historic staircase', placeName: 'Old Exchange', category: 'attraction', evidence: [frame('ornate iron staircase curling through a tall tiled atrium', 4), frame('glass ceiling reflected in the polished tile floor', 8)] },
  { id: 'architecture-chapel', group: 'architecture_interior', label: 'Modern chapel', placeName: 'Pine Chapel', category: 'attraction', evidence: [frame('narrow wooden chapel framed by tall windows on both sides', 11), frame('trees visible through every wall behind the altar', 14)] },

  // Beaches / water (5)
  { id: 'water-surf', group: 'beaches_water', label: 'Surfing beach', placeName: 'North Break', category: 'beach', evidence: [frame('surfer dropping down the face of a very large curling wave', 12), frame('several large waves breaking hard close together', 15)] },
  { id: 'water-hole', group: 'beaches_water', label: 'Swimming hole', placeName: 'Granite Pool', category: 'lake', evidence: [frame('dark blue swimming hole shaded by tall granite walls', 6), frame('swimmer entering the water from a low rock', 9)] },
  { id: 'water-falls', group: 'beaches_water', label: 'Waterfall', placeName: 'Fern Falls', category: 'waterfall', evidence: [frame('narrow waterfall dropping into a bright clear pool', 11), frame('people standing tiny beside the tall waterfall', 14)] },
  { id: 'water-black-beach', group: 'beaches_water', label: 'Black beach', placeName: 'Glass Cove', category: 'beach', evidence: [frame('empty crescent beach bordered by black volcanic cliffs', 3), frame('waves washing over smooth black pebbles', 6)] },
  { id: 'water-cenote', group: 'beaches_water', label: 'Cenote', placeName: 'Round Well', category: 'attraction', evidence: [frame('circular limestone opening above deep blue water', 8), frame('wood ladder descending from the rock shelf into the water', 11)] },

  // Activity / action (5)
  { id: 'action-cliff-jump', group: 'activity_action', label: 'Cliff jump', placeName: 'Blue Ledge', category: 'attraction', evidence: [frame('person hesitating at the edge of a high rock ledge over water', 5), frame('same person jumping from the ledge into the water', 7)] },
  { id: 'action-pottery', group: 'activity_action', label: 'Pottery class', placeName: 'Clay Studio', category: 'entertainment', evidence: [frame('hands centering wet clay on a spinning pottery wheel', 8), frame('finished blue bowls lined up beside the wheel', 13)] },
  { id: 'action-kayak', group: 'activity_action', label: 'Kayaking', placeName: 'Marsh Landing', category: 'marina', evidence: [frame('two kayaks moving through a narrow tunnel of mangroves', 9), frame('paddles passing inches beneath low branches', 12)] },
  { id: 'action-dance', group: 'activity_action', label: 'Dance lesson', placeName: 'Step Hall', category: 'fitness', evidence: [frame('pairs practicing the same fast turn in a mirrored studio', 6), speech('beginners rotate partners every song', 8)] },
  { id: 'action-glass', group: 'activity_action', label: 'Glass blowing', placeName: 'Hot Shop', category: 'entertainment', evidence: [frame('person shaping glowing orange glass at the end of a pipe', 10), frame('finished glass cup cooling inside a kiln', 15)] },

  // Ordinary / low-interest scenes (5): omission is welcome.
  { id: 'ordinary-storefront', group: 'ordinary_low_interest', label: 'Storefront', placeName: 'Mori Market', category: 'shopping', evidence: [frame('small neighborhood storefront with two bicycles outside', 3), visible('MORI MARKET', 3)] },
  { id: 'ordinary-parking', group: 'ordinary_low_interest', label: 'Parking lot', placeName: 'West Plaza', category: 'shopping', evidence: [frame('mostly empty parking lot in front of a strip mall', 4)] },
  { id: 'ordinary-lobby', group: 'ordinary_low_interest', label: 'Office lobby', placeName: 'Market Center', category: 'other', evidence: [frame('plain office lobby with gray chairs and a reception desk', 5)] },
  { id: 'ordinary-road', group: 'ordinary_low_interest', label: 'Road', placeName: 'County Road', category: 'transportation', evidence: [frame('straight two-lane road crossing a flat grassy field', 6)] },
  { id: 'ordinary-hallway', group: 'ordinary_low_interest', label: 'Hallway', placeName: 'Civic Hall', category: 'other', evidence: [frame('beige hallway with closed doors and overhead lights', 4)] },

  // Miscellaneous (5)
  { id: 'misc-bookshop', group: 'miscellaneous', label: 'Bookshop', placeName: 'Paper Moon', category: 'shopping', evidence: [frame('floor-to-ceiling shelves reached by a rolling wooden ladder', 7), frame('narrow reading nook hidden between two shelves', 10)] },
  { id: 'misc-train', group: 'miscellaneous', label: 'Scenic train', placeName: 'Valley Railway', category: 'transportation', evidence: [frame('red train crossing a high stone bridge above a valley', 12), frame('open train window beside the same valley view', 15)] },
  { id: 'misc-market', group: 'miscellaneous', label: 'Night market', placeName: 'Lantern Market', category: 'shopping', evidence: [frame('narrow market lane covered by rows of red lanterns', 9), frame('vendors cooking over open grills along both sides', 13)] },
  { id: 'misc-records', group: 'miscellaneous', label: 'Record shop', placeName: 'Needle Drop', category: 'shopping', evidence: [frame('listening booth built into a wall of vinyl records', 5), visible('LISTEN BEFORE YOU BUY', 5)] },
  { id: 'misc-observatory', group: 'miscellaneous', label: 'Observatory', placeName: 'Hill Observatory', category: 'attraction', evidence: [frame('large telescope rotating beneath an open dome', 11), speech('public viewing starts after the sky gets dark', 14)] },
];
